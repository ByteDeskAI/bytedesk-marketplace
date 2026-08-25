using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ByteDesk.AgentOrchestration.Windows;

internal sealed record SandboxConfig(
    string ProfileName,
    string WorkingDirectory,
    string[] ReadablePaths,
    string[] WritablePaths,
    string[] ProtectedPaths,
    bool AllowInternet,
    ulong MemoryBytes = 8589934592,
    uint ProcessLimit = 512,
    uint RuntimeMilliseconds = 28800000
);

internal static class Program
{
    private const uint JobObjectAllAccess = 0x1F001F;
    private const uint JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitActiveProcess = 0x00000008;
    private const uint JobObjectLimitJobMemory = 0x00000200;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint CreateSuspended = 0x00000004;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const int StartupInfoUseStdHandles = 0x00000100;
    private const int ProcThreadAttributeSecurityCapabilities = 0x00020009;
    private const uint SeGroupEnabled = 0x00000004;
    private const int StdInputHandle = -10;
    private const int StdOutputHandle = -11;
    private const int StdErrorHandle = -12;
    private const uint HandleFlagInherit = 0x00000001;

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("The native helper runs only on Windows.");
            if (args.Length == 0) throw new ArgumentException("A helper command is required.");
            return args[0] switch
            {
                "doctor" => Doctor(),
                "exists" => Exists(RequireOption(args, "--job")),
                "contains" => Contains(RequireOption(args, "--job"), int.Parse(RequireOption(args, "--pid"))),
                "terminate" => Terminate(RequireOption(args, "--job")),
                "supervise" => await Supervise(args),
                "run" => await RunBounded(args),
                "sandbox" => Sandbox(args),
                _ => throw new ArgumentException($"Unknown helper command: {args[0]}")
            };
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new { code = "AO_WINDOWS_HELPER", message = error.Message, nativeError = error is Win32Exception win32 ? win32.NativeErrorCode : 0 }));
            return 1;
        }
    }

    private static int Doctor()
    {
        var jobName = $"Local\\ByteDesk-Agent-Orchestration-Doctor-{Guid.NewGuid():N}";
        using var job = CreateConfiguredJob(jobName, 256 * 1024 * 1024, 8);
        var profileName = $"ByteDesk.AO.Doctor.{Guid.NewGuid():N}";
        IntPtr sid = IntPtr.Zero;
        var appContainer = false;
        var appContainerResult = 0;
        try
        {
            appContainerResult = CreateAppContainerProfile(profileName, "ByteDesk orchestration doctor", "Temporary capability probe", IntPtr.Zero, 0, out sid);
            appContainer = appContainerResult == 0;
        }
        finally
        {
            if (sid != IntPtr.Zero) FreeSid(sid);
            DeleteAppContainerProfile(profileName);
        }
        WriteJson(new { jobObjects = !job.IsInvalid, appContainer, appContainerResult, architecture = RuntimeInformation.OSArchitecture.ToString(), os = RuntimeInformation.OSDescription });
        return appContainer ? 0 : 1;
    }

    private static int Exists(string jobName)
    {
        using var job = OpenJobObject(JobObjectAllAccess, false, ValidateJobName(jobName));
        WriteJson(new { exists = !job.IsInvalid });
        return 0;
    }

    private static int Contains(string jobName, int pid)
    {
        using var job = OpenRequiredJob(jobName);
        using var process = Process.GetProcessById(pid);
        if (!IsProcessInJob(process.Handle, job.DangerousGetHandle(), out var contains)) ThrowLastWin32("Could not inspect Job Object membership");
        WriteJson(new { contains });
        return contains ? 0 : 2;
    }

    private static int Terminate(string jobName)
    {
        using var job = OpenJobObject(JobObjectAllAccess, false, ValidateJobName(jobName));
        if (job.IsInvalid)
        {
            WriteJson(new { terminated = true, alreadyStopped = true });
            return 0;
        }
        if (!TerminateJobObject(job, 143)) ThrowLastWin32("Could not terminate the Job Object");
        WriteJson(new { terminated = true, alreadyStopped = false });
        return 0;
    }

    private static async Task<int> Supervise(string[] args)
    {
        var jobName = ValidateJobName(RequireOption(args, "--job"));
        var command = CommandAfterSeparator(args);
        var stdoutPath = RequireOption(args, "--stdout");
        var stderrPath = RequireOption(args, "--stderr");
        Directory.CreateDirectory(Path.GetDirectoryName(stdoutPath)!);
        using var job = CreateConfiguredJob(jobName, ParseUlongOption(args, "--memory-bytes", 8589934592), ParseUintOption(args, "--process-limit", 512));
        using var child = StartManagedProcess(command, redirect: true);
        if (!AssignProcessToJobObject(job, child.Handle)) ThrowLastWin32("Could not assign the worker to its Job Object");
        await using var stdout = new FileStream(stdoutPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        await using var stderr = new FileStream(stderrPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        var stdoutCopy = child.StandardOutput.BaseStream.CopyToAsync(stdout);
        var stderrCopy = child.StandardError.BaseStream.CopyToAsync(stderr);
        var timeout = ParseUintOption(args, "--runtime-ms", 28800000);
        using var timeoutSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(timeout));
        try { await child.WaitForExitAsync(timeoutSource.Token); }
        catch (OperationCanceledException) { TerminateJobObject(job, 124); }
        await Task.WhenAll(stdoutCopy, stderrCopy);
        return child.HasExited ? child.ExitCode : 124;
    }

    private static async Task<int> RunBounded(string[] args)
    {
        var jobName = ValidateJobName(RequireOption(args, "--job"));
        var command = CommandAfterSeparator(args);
        using var job = CreateConfiguredJob(jobName, ParseUlongOption(args, "--memory-bytes", 2147483648), ParseUintOption(args, "--process-limit", 128));
        using var child = StartManagedProcess(command, redirect: true);
        if (!AssignProcessToJobObject(job, child.Handle)) ThrowLastWin32("Could not assign the probe to its Job Object");
        var stdoutTask = child.StandardOutput.ReadToEndAsync();
        var stderrTask = child.StandardError.ReadToEndAsync();
        var timeout = ParseUintOption(args, "--runtime-ms", 10000);
        using var timeoutSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(timeout));
        try { await child.WaitForExitAsync(timeoutSource.Token); }
        catch (OperationCanceledException) { TerminateJobObject(job, 124); }
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (!string.IsNullOrWhiteSpace(stderr)) Console.Error.Write(stderr);
        if (!string.IsNullOrWhiteSpace(stdout)) Console.Out.Write(stdout);
        return child.HasExited ? child.ExitCode : 124;
    }

    private static int Sandbox(string[] args)
    {
        var config = JsonSerializer.Deserialize<SandboxConfig>(File.ReadAllText(RequireOption(args, "--config")), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("The AppContainer configuration is invalid.");
        var command = CommandAfterSeparator(args);
        return RunAppContainer(config, command);
    }

    private static int RunAppContainer(SandboxConfig config, string[] command)
    {
        var profileName = ValidateProfileName(config.ProfileName);
        IntPtr appContainerSid = IntPtr.Zero;
        IntPtr capabilitySid = IntPtr.Zero;
        IntPtr capabilities = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr environmentBlock = IntPtr.Zero;
        var grantedPaths = new List<string>();
        SafeJobHandle? job = null;
        PROCESS_INFORMATION process = default;
        try
        {
            var profileResult = CreateAppContainerProfile(profileName, "ByteDesk provider sandbox", "Ephemeral provider execution boundary", IntPtr.Zero, 0, out appContainerSid);
            if (profileResult != 0 && profileResult != unchecked((int)0x800700B7)) ThrowHResult(profileResult, "Could not create the AppContainer profile");
            if (appContainerSid == IntPtr.Zero)
            {
                var deriveResult = DeriveAppContainerSidFromAppContainerName(profileName, out appContainerSid);
                if (deriveResult != 0) ThrowHResult(deriveResult, "Could not derive the AppContainer SID");
            }
            var sidText = SidToString(appContainerSid);
            foreach (var path in config.ReadablePaths.Distinct(StringComparer.OrdinalIgnoreCase)) { GrantPath(path, sidText, writable: false); grantedPaths.Add(path); }
            foreach (var path in config.WritablePaths.Distinct(StringComparer.OrdinalIgnoreCase)) { GrantPath(path, sidText, writable: true); grantedPaths.Add(path); }
            foreach (var path in config.ProtectedPaths.Distinct(StringComparer.OrdinalIgnoreCase)) { DenyPathWrites(path, sidText); grantedPaths.Add(path); }

            var securityCapabilities = new SECURITY_CAPABILITIES { AppContainerSid = appContainerSid };
            if (config.AllowInternet)
            {
                if (!ConvertStringSidToSid("S-1-15-3-1", out capabilitySid)) ThrowLastWin32("Could not create the internetClient capability SID");
                var capability = new SID_AND_ATTRIBUTES { Sid = capabilitySid, Attributes = SeGroupEnabled };
                capabilities = Marshal.AllocHGlobal(Marshal.SizeOf<SID_AND_ATTRIBUTES>());
                Marshal.StructureToPtr(capability, capabilities, false);
                securityCapabilities.Capabilities = capabilities;
                securityCapabilities.CapabilityCount = 1;
            }

            nuint attributeSize = 0;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            attributeList = Marshal.AllocHGlobal((int)attributeSize);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize)) ThrowLastWin32("Could not initialize the AppContainer attribute list");
            var securityPointer = Marshal.AllocHGlobal(Marshal.SizeOf<SECURITY_CAPABILITIES>());
            try
            {
                Marshal.StructureToPtr(securityCapabilities, securityPointer, false);
                if (!UpdateProcThreadAttribute(attributeList, 0, (IntPtr)ProcThreadAttributeSecurityCapabilities, securityPointer, (nuint)Marshal.SizeOf<SECURITY_CAPABILITIES>(), IntPtr.Zero, IntPtr.Zero)) ThrowLastWin32("Could not configure AppContainer process attributes");
                var startup = new STARTUPINFOEX
                {
                    StartupInfo = new STARTUPINFO
                    {
                        cb = Marshal.SizeOf<STARTUPINFOEX>(),
                        dwFlags = StartupInfoUseStdHandles,
                        hStdInput = GetStdHandle(StdInputHandle),
                        hStdOutput = GetStdHandle(StdOutputHandle),
                        hStdError = GetStdHandle(StdErrorHandle),
                    },
                    lpAttributeList = attributeList,
                };
                SetHandleInformation(startup.StartupInfo.hStdInput, HandleFlagInherit, HandleFlagInherit);
                SetHandleInformation(startup.StartupInfo.hStdOutput, HandleFlagInherit, HandleFlagInherit);
                SetHandleInformation(startup.StartupInfo.hStdError, HandleFlagInherit, HandleFlagInherit);
                var commandLine = new StringBuilder(string.Join(" ", command.Select(QuoteWindowsArgument)));
                environmentBlock = CreateEnvironmentBlock(config.WorkingDirectory);
                if (!CreateProcess(command[0], commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | ExtendedStartupInfoPresent | CreateUnicodeEnvironment, environmentBlock, config.WorkingDirectory, ref startup, out process)) ThrowLastWin32($"Could not launch the provider in AppContainer (application={command[0]}, cwd={config.WorkingDirectory})");
            }
            finally { Marshal.FreeHGlobal(securityPointer); }

            job = CreateConfiguredJob($"Local\\ByteDesk-Agent-Orchestration-Sandbox-{Guid.NewGuid():N}", config.MemoryBytes, config.ProcessLimit);
            if (!AssignProcessToJobObject(job, process.hProcess)) ThrowLastWin32("Could not assign the AppContainer provider to its Job Object");
            ResumeThread(process.hThread);
            var wait = WaitForSingleObject(process.hProcess, config.RuntimeMilliseconds);
            if (wait == 0x00000102) TerminateJobObject(job, 124);
            if (!GetExitCodeProcess(process.hProcess, out var exitCode)) ThrowLastWin32("Could not read the provider exit code");
            return unchecked((int)exitCode);
        }
        finally
        {
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            job?.Dispose();
            if (attributeList != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
            if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
            if (capabilitySid != IntPtr.Zero) LocalFree(capabilitySid);
            if (appContainerSid != IntPtr.Zero) FreeSid(appContainerSid);
            foreach (var path in grantedPaths.Distinct(StringComparer.OrdinalIgnoreCase)) RevokePath(path, profileName);
            DeleteAppContainerProfile(profileName);
        }
    }

    private static Process StartManagedProcess(string[] command, bool redirect)
    {
        if (command.Length == 0) throw new ArgumentException("A child command is required.");
        var start = new ProcessStartInfo(command[0]) { UseShellExecute = false, RedirectStandardOutput = redirect, RedirectStandardError = redirect, CreateNoWindow = true };
        foreach (var argument in command.Skip(1)) start.ArgumentList.Add(argument);
        return Process.Start(start) ?? throw new InvalidOperationException("The child process did not start.");
    }

    private static IntPtr CreateEnvironmentBlock(string workingDirectory)
    {
        var entries = Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Key is string && entry.Value is string)
            .Select(entry => $"{entry.Key}={entry.Value}")
            .ToList();
        var root = Path.GetPathRoot(workingDirectory);
        if (!string.IsNullOrEmpty(root) && root.Length >= 2 && root[1] == ':') entries.Add($"={char.ToUpperInvariant(root[0])}:={workingDirectory}");
        entries.Sort(StringComparer.OrdinalIgnoreCase);
        return Marshal.StringToHGlobalUni(string.Join('\0', entries) + "\0\0");
    }

    private static SafeJobHandle CreateConfiguredJob(string name, ulong memoryBytes, uint processLimit)
    {
        var job = CreateJobObject(IntPtr.Zero, ValidateJobName(name));
        if (job.IsInvalid) ThrowLastWin32("Could not create the Job Object");
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose | JobObjectLimitActiveProcess | JobObjectLimitJobMemory;
        limits.BasicLimitInformation.ActiveProcessLimit = processLimit;
        limits.JobMemoryLimit = (UIntPtr)memoryBytes;
        var length = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        var pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)length)) ThrowLastWin32("Could not configure Job Object limits");
        }
        finally { Marshal.FreeHGlobal(pointer); }
        return job;
    }

    private static SafeJobHandle OpenRequiredJob(string name)
    {
        var job = OpenJobObject(JobObjectAllAccess, false, ValidateJobName(name));
        if (job.IsInvalid) ThrowLastWin32("The Job Object does not exist");
        return job;
    }

    private static void GrantPath(string path, string sid, bool writable)
    {
        if (!Path.IsPathFullyQualified(path) || (!File.Exists(path) && !Directory.Exists(path))) throw new InvalidOperationException($"AppContainer path is not an existing absolute path: {path}");
        var permission = writable ? "(OI)(CI)M" : "(OI)(CI)RX";
        if (File.Exists(path)) permission = writable ? "M" : "RX";
        RunIcacls(path, "/grant", $"*{sid}:{permission}");
    }

    private static void RevokePath(string path, string profileName)
    {
        if (!File.Exists(path) && !Directory.Exists(path)) return;
        if (DeriveAppContainerSidFromAppContainerName(profileName, out var sid) != 0) return;
        try { RunIcacls(path, "/remove", $"*{SidToString(sid)}", throwOnFailure: false); }
        finally { FreeSid(sid); }
    }

    private static void DenyPathWrites(string path, string sid)
    {
        if (!File.Exists(path)) throw new InvalidOperationException($"Protected AppContainer file does not exist: {path}");
        RunIcacls(path, "/deny", $"*{sid}:(W,D)");
    }

    private static void RunIcacls(string path, string operation, string rule, bool throwOnFailure = true)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "icacls.exe")) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        start.ArgumentList.Add(path);
        start.ArgumentList.Add(operation);
        start.ArgumentList.Add(rule);
        start.ArgumentList.Add("/Q");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("icacls did not start.");
        process.WaitForExit();
        if (throwOnFailure && process.ExitCode != 0) throw new InvalidOperationException($"icacls rejected the AppContainer access rule: {process.StandardError.ReadToEnd()}");
    }

    private static string[] CommandAfterSeparator(string[] args)
    {
        var index = Array.IndexOf(args, "--");
        if (index < 0 || index == args.Length - 1) throw new ArgumentException("A child command must follow --.");
        return args[(index + 1)..];
    }

    private static string RequireOption(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        if (index < 0 || index + 1 >= args.Length) throw new ArgumentException($"{name} is required.");
        return args[index + 1];
    }

    private static uint ParseUintOption(string[] args, string name, uint fallback) => uint.TryParse(Optional(args, name), out var value) ? value : fallback;
    private static ulong ParseUlongOption(string[] args, string name, ulong fallback) => ulong.TryParse(Optional(args, name), out var value) ? value : fallback;
    private static string? Optional(string[] args, string name) { var index = Array.IndexOf(args, name); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
    private static string ValidateJobName(string value) => value.StartsWith("Local\\ByteDesk-Agent-Orchestration-", StringComparison.Ordinal) && value.All(ch => char.IsLetterOrDigit(ch) || ch is '\\' or '-') ? value : throw new ArgumentException("The Job Object name is outside the ByteDesk namespace.");
    private static string ValidateProfileName(string value) => value.StartsWith("ByteDesk.AO.", StringComparison.Ordinal) && value.Length <= 64 && value.All(ch => char.IsLetterOrDigit(ch) || ch is '.' or '-') ? value : throw new ArgumentException("The AppContainer profile name is outside the ByteDesk namespace.");
    private static string QuoteWindowsArgument(string value) => value.Length > 0 && !value.Any(char.IsWhiteSpace) && !value.Contains('"') ? value : $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";
    private static string SidToString(IntPtr sid) { if (!ConvertSidToStringSid(sid, out var text)) ThrowLastWin32("Could not format an AppContainer SID"); try { return Marshal.PtrToStringUni(text)!; } finally { LocalFree(text); } }
    private static void WriteJson(object value) => Console.Out.WriteLine(JsonSerializer.Serialize(value));
    private static void ThrowLastWin32(string message) => throw new Win32Exception(Marshal.GetLastWin32Error(), message);
    private static void ThrowHResult(int result, string message) => throw new Win32Exception(result & 0xFFFF, message);

    [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO { public int cb; public string? lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }

    private sealed class SafeJobHandle : SafeHandle
    {
        public SafeJobHandle() : base(IntPtr.Zero, true) { }
        public override bool IsInvalid => handle == IntPtr.Zero || handle == new IntPtr(-1);
        protected override bool ReleaseHandle() => CloseHandle(handle);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeJobHandle CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeJobHandle OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(SafeJobHandle job, uint informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(SafeJobHandle job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, nuint size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll")] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSidToSid(string text, out IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
}
