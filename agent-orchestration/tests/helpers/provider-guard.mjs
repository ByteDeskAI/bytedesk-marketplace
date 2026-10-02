// Suite-level provider guard (TM-290). A temp `git init` repository is enrolled by default, so a
// test that reaches supervise, lead or startup can start a REAL claude/codex/… lead in a pane — on
// the operator's account and quota. This puts a shim for every catalog provider command first on
// PATH: a shim records who ran it, refuses with 127 (so a launcher treats the candidate as failed
// rather than waiting on it), and the run that loaded this file exits non-zero if any shim ran.
// A test that needs a provider uses a fake adapter command, never a catalog name.
//
// The runner process creates the shims; every test-file child inherits PATH and the log path, and
// only records its own file name so a hit names the test that caused it.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

export const PROVIDER_COMMANDS = ["claude", "codex", "grok", "kimi", "gemini", "copilot"];

/** Create the shim directory; returns { dir, log }. Exported so the guard's own test can drive it. */
export function installProviderShims(dir = mkdtempSync("/tmp/aot-prov-")) {
  const log = join(dir, "spawned.log");
  writeFileSync(log, "");
  for (const command of PROVIDER_COMMANDS) {
    // The log path is baked in: a launcher or sandbox may scrub the environment, not the script.
    const shim = join(dir, command);
    writeFileSync(shim, `#!/bin/sh
printf '%s\\t%s\\t%s\\n' "\${AO_TEST_FILE:-?}" "${command} $*" "$PWD" >> '${log}'
echo "${command}: a real provider CLI was spawned from a test (TM-290); use a fake adapter command" >&2
exit 127
`);
    chmodSync(shim, 0o755);
  }
  return { dir, log };
}

/** The recorded spawns, one `{ file, command, cwd }` per line. */
export function providerSpawns(log) {
  let text = "";
  try { text = readFileSync(log, "utf8"); } catch { return []; }
  return text.split("\n").filter(Boolean).map((line) => {
    const [file, command, cwd] = line.split("\t");
    return { file, command, cwd };
  });
}

if (!process.env.AO_TEST_PROVIDER_LOG) {
  const { dir, log } = installProviderShims();
  process.env.AO_TEST_PROVIDER_LOG = log;
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
  process.on("exit", () => {
    const spawns = providerSpawns(log);
    if (spawns.length > 0) {
      process.stderr.write(`\nTM-290 provider guard: ${spawns.length} real provider CLI spawn(s) from tests:\n`);
      for (const { file, command, cwd } of spawns) process.stderr.write(`  ${file}: ${command} (cwd ${cwd})\n`);
      process.exitCode = 1;
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });
}
if (process.argv[1]) process.env.AO_TEST_FILE = process.argv[1];
