import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = [".deps.json", ".dll", ".exe", ".runtimeconfig.json"]
  .map((suffix) => join(root, "dist", "windows-native", `AgentOrchestration.Windows${suffix}`));

if (process.platform !== "win32" && process.env.AGENT_ORCHESTRATION_FORCE_WINDOWS_BUILD !== "1") {
  await Promise.all(artifacts.map((path) => access(path)));
  process.stdout.write("Using the committed Windows native helper artifacts on this non-Windows host.\n");
  process.exit(0);
}
const child = spawn("dotnet", [
  "publish",
  join(root, "native", "windows", "AgentOrchestration.Windows.csproj"),
  "-c", "Release",
  "-o", join(root, "dist", "windows-native"),
  "--no-self-contained",
], { cwd: root, stdio: "inherit", windowsHide: true, shell: false });

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode !== 0) process.exit(exitCode ?? 1);
