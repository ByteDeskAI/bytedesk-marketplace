// A temp Git repository for tests, opted OUT of enrollment by default (TM-290). Any Git repository
// is enrolled by default, and an enrolled repository's supervisor starts a real lead provider on its
// first tick — so a bare `git init` in a test that reaches supervise, lead or startup can spend the
// operator's provider account. A test that needs an enrolled repository (a supervisor that ticks, an
// activation) passes `{ enrolled: true }`: it stays enrolled by default, but its lead provider is a
// command that does not exist, so the lead fails the way a missing CLI does and spends nothing.
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const GIT_ID = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];

/** A lead provider id that resolves to no adapter and no command: the generic adapter runs it and fails. */
export const NO_PROVIDER = "ao-test-no-provider";

/** Write `{ lead: { provider: NO_PROVIDER } }` to a config.json (a repo or the global layer). */
export async function noProviderLead(configFile) {
  await mkdir(dirname(configFile), { recursive: true });
  await writeFile(configFile, `${JSON.stringify({ lead: { provider: NO_PROVIDER } })}\n`);
}

/** Write the opt-out file `{ "enabled": false }` into an existing repository root. */
export async function optOutOfEnrollment(repo) {
  const dir = join(repo, ".bytedesk", "agent-orchestration");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), `${JSON.stringify({ enabled: false })}\n`);
}

/** `git init` `repo` (creating it): opted out of enrollment, or with `enrolled` left enrolled and given no provider. */
export async function initTempRepo(repo, { enrolled = false, branch = null, commit = false } = {}) {
  await mkdir(repo, { recursive: true });
  await execFile("git", ["init", "-q", ...(branch ? ["-b", branch] : []), repo]);
  if (enrolled) await noProviderLead(join(repo, ".bytedesk", "agent-orchestration", "config.json"));
  else await optOutOfEnrollment(repo);
  if (commit) await execFile("git", ["-C", repo, ...GIT_ID, "commit", "-q", "--allow-empty", "-m", "init"]);
  return repo;
}
