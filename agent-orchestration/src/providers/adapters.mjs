import os from "node:os";
import { join } from "node:path";

const WINDOWS_EXECUTABLE_ROOTS = Object.freeze([
  process.env.ProgramFiles,
  process.env["ProgramFiles(x86)"],
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
  process.env.APPDATA && join(process.env.APPDATA, "npm"),
  join(os.homedir(), ".local", "bin"),
].filter(Boolean));
const SYSTEM_EXECUTABLE_ROOTS = Object.freeze(process.platform === "win32" ? WINDOWS_EXECUTABLE_ROOTS : ["/usr/bin", "/usr/local/bin"]);

/**
 * Trusted transport descriptors. They are deliberately separate from routing
 * metadata: callers may select a provider ID, but never supply commands.
 * Adding an ACP-native provider is a descriptor/catalog/policy change; the
 * orchestration engine remains provider-neutral.
 */
export const PROVIDER_ADAPTERS = Object.freeze({
  claude: Object.freeze({
    providerId: "claude",
    agentTarget: "claude",
    executable: "claude",
    executableRoots: Object.freeze([...SYSTEM_EXECUTABLE_ROOTS, join(os.homedir(), ".claude"), join(os.homedir(), ".local", "share", "claude")]),
    executableEnv: "CLAUDE_CODE_EXECUTABLE",
    bridgeLauncher: "claude-agent-acp",
    args: Object.freeze([]),
    effortTransport: "config-option",
    credentialEnv: Object.freeze([]),
    sandboxHome: Object.freeze({
      env: "CLAUDE_CONFIG_DIR",
      sourceDir: ".claude",
      bootstrapFiles: Object.freeze([".credentials.json"]),
    }),
  }),
  codex: Object.freeze({
    providerId: "codex",
    agentTarget: "codex",
    executable: "codex",
    executableRoots: Object.freeze([...SYSTEM_EXECUTABLE_ROOTS, join(os.homedir(), ".codex"), join(os.homedir(), ".cache", "codex-runtimes"), join(os.homedir(), ".volta", "tools", "image")]),
    candidateResolvers: Object.freeze([
      Object.freeze({ executable: join(os.homedir(), ".volta", "bin", "volta"), args: Object.freeze(["which", "codex"]) }),
    ]),
    executableEnv: "CODEX_PATH",
    bridgeLauncher: "codex-acp",
    args: Object.freeze([]),
    sandboxHome: Object.freeze({ env: "CODEX_HOME", sourceDir: ".codex", bootstrapFiles: Object.freeze(["auth.json"]) }),
    effortTransport: "model-id-suffix",
    credentialEnv: Object.freeze([]),
  }),
  "grok-build": Object.freeze({
    providerId: "grok-build",
    agentTarget: "grok-build",
    executable: "grok",
    executableRoots: Object.freeze([...SYSTEM_EXECUTABLE_ROOTS, join(os.homedir(), ".grok", "downloads")]),
    executableEnv: null,
    bridgeLauncher: null,
    args: Object.freeze(["agent", "--always-approve", "stdio"]),
    effortTransport: "runtime-probe",
    credentialEnv: Object.freeze([]),
    sandboxHome: Object.freeze({
      env: "GROK_HOME",
      sourceDir: ".grok",
      bootstrapFiles: Object.freeze(["auth.json"]),
    }),
  }),
  kimi: Object.freeze({
    providerId: "kimi",
    agentTarget: "kimi",
    executable: "kimi",
    executableRoots: Object.freeze([
      ...SYSTEM_EXECUTABLE_ROOTS,
      join(os.homedir(), ".kimi-code", "bin"),
      join(os.homedir(), ".local", "share", "uv", "tools", "kimi-cli"),
      join(os.homedir(), ".local", "share", "pipx", "venvs", "kimi-cli"),
    ]),
    executableEnv: null,
    bridgeLauncher: null,
    args: Object.freeze(["acp"]),
    effortTransport: "runtime-probe",
    credentialEnv: Object.freeze([]),
    sandboxHome: Object.freeze({
      env: "KIMI_HOME",
      sourceDir: ".kimi",
      bootstrapFiles: Object.freeze(["auth.json", "credentials.json", "credentials/kimi-code.json"]),
    }),
  }),
});

export function getProviderAdapter(providerId) {
  return PROVIDER_ADAPTERS[providerId] ?? null;
}
