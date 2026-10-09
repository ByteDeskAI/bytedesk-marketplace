// Environment diagnosis and setup guidance. Read-only: it never installs anything itself; the
// setup-agent-orchestration skill runs the commands it suggests after the operator agrees.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { platform, release } from "node:os";
import { detectAdapter } from "./providers.mjs";
import { socketPathProblem, tmuxVersion } from "./tmux.mjs";
import { exists, run } from "./util.mjs";
import { canonicalRepoId, repoKey, repoSlug } from "./repoid.mjs";
import { REVIEW_SUBMIT_SERVER } from "./reviewer.mjs";

async function hasCommand(name) {
  const which = process.platform === "win32" ? "where" : "which";
  const result = await run(which, [name], { allowFailure: true, timeoutMs: 5000 }).catch(() => ({ code: 1 }));
  return result.code === 0;
}

export async function detectOs() {
  const os = platform();
  const info = { platform: os, release: release(), wsl: false, package_manager: null };
  if (os === "linux") {
    const version = await readFile("/proc/version", "utf8").catch(() => "");
    info.wsl = /microsoft/i.test(version);
    for (const manager of ["apt-get", "dnf", "pacman", "zypper", "apk"]) {
      if (await hasCommand(manager)) {
        info.package_manager = manager;
        break;
      }
    }
  } else if (os === "darwin") {
    info.package_manager = (await hasCommand("brew")) ? "brew" : null;
  } else if (os === "win32") {
    info.package_manager = (await hasCommand("winget")) ? "winget" : null;
    info.msys2 = await exists("C:\\msys64\\usr\\bin\\tmux.exe");
  }
  return info;
}

export function tmuxInstallPlan(osInfo) {
  switch (osInfo.platform) {
    case "linux": {
      const commands = {
        "apt-get": "sudo apt-get update && sudo apt-get install -y tmux",
        dnf: "sudo dnf install -y tmux",
        pacman: "sudo pacman -S --noconfirm tmux",
        zypper: "sudo zypper install -y tmux",
        apk: "sudo apk add tmux",
      };
      return { command: commands[osInfo.package_manager] ?? null, note: osInfo.package_manager ? null : "No known package manager found; install tmux from your distribution." };
    }
    case "darwin":
      return { command: osInfo.package_manager === "brew" ? "brew install tmux" : null, note: osInfo.package_manager ? null : "Install Homebrew (https://brew.sh) first, then `brew install tmux`." };
    case "win32":
      return {
        command: null,
        note: "tmux does not run natively on Windows. Recommended: WSL2 (`wsl --install`), then run ao-topology and every agent CLI inside the distribution. Alternative: MSYS2 (`pacman -S tmux`) with agent CLIs installed in that environment.",
      };
    default:
      return { command: null, note: `Unknown platform ${osInfo.platform}; install tmux manually.` };
  }
}


/**
 * TM-155. WILL A GOVERNED RUN COME UP HERE, OR WILL IT MEET A MODAL NOBODY IS WATCHING?
 *
 * Claude Code asks "Is this a project you created or one you trust?" the first time it opens a
 * directory, and the highlighted answer is `❯ No, exit`. The orchestration layer handles that
 * correctly — TM-111's guard means it never presses Enter at an attention screen — so the failure is
 * silent by design: `lead ensure` reports "Provider is not accepting startup instructions; session
 * preserved" and the pane sits there until a human looks at it.
 *
 * Measured during the EP-018 demo: in a repository Claude had never been trusted in, this stopped
 * every governed launch. In a TRUSTED repository the agents' own subdirectories inherited that trust
 * and came straight up — so the gate is per project root, once, not per agent directory.
 *
 * Reported rather than faulted, and only for the CLIs that actually ask: a repo nobody intends to
 * orchestrate in is not broken for never having been trusted.
 */
async function claudeTrust(consumer, home) {
  if (!consumer) return null;
  const path = join(home, ".claude.json");
  let config = null;
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { known: false, trusted: null, reason: `no readable ${path}` };
  }
  // TRUST IS KEYED ON THE GIT COMMON DIRECTORY — the same identity the rest of this plugin already
  // uses for leads and slots, so every linked worktree of a repository shares one answer. This is
  // the THIRD position this check has held, and the first with an experiment behind it rather than
  // an argument. An exact-path lookup was wrong (a worktree of a trusted repo read as untrusted);
  // walking arbitrary ancestors was also wrong, in the more dangerous direction — it reported
  // "trusted" from a distant accepted ancestor and the demo then stopped at the modal the check
  // exists to predict.
  //
  // Five live cases, each run as an interactive pane and observed (TM-169):
  //
  //   cwd                                      common dir      entry?   modal
  //   agent dir in an untrusted repo           that repo       none     YES
  //   agent dir in a trusted repo              that repo       true     no
  //   fresh git repo under a TRUSTED ancestor  itself          none     YES   <- kills ancestor-walk
  //   fresh deep subdir of a trusted repo      that repo       true     no    <- kills exact-path
  //   linked worktree, own path never trusted  the main repo   true     no    <- kills toplevel too
  //
  // The third case is the one that matters: an accepted ancestor does NOT cover a repository nested
  // under it. The fifth is why the key is the COMMON dir and not the worktree toplevel.
  const projects = config?.projects ?? {};
  const identity = await canonicalRepoId(consumer).catch(() => null);
  if (identity?.kind === "git-common-dir") {
    // The entry is keyed by the working directory, so step off the `.git` the common dir names.
    const key = dirname(identity.git_common_dir);
    const entry = projects[key];
    if (entry) return { known: true, trusted: entry.hasTrustDialogAccepted === true, path, matched: key };
    return { known: false, trusted: false, path, matched: key };
  }
  // No repository identity at all — not a git tree. There is no better key than the path itself, so
  // keep the ancestor walk here rather than inventing a second rule for a case with no repository
  // to key on. This is the same two-branch shape canonicalRepoId itself has, and it is deliberately
  // NOT the answer for a git tree: the dangerous case is a repository nested under an accepted
  // ancestor, and that one takes the branch above and is reported.
  for (let dir = resolve(consumer); ; dir = dirname(dir)) {
    const entry = projects[dir];
    if (entry) return { known: true, trusted: entry.hasTrustDialogAccepted === true, path, matched: dir };
    const parent = dirname(dir);
    if (parent === dir) break;
  }
  return { known: false, trusted: false, path };
}

/**
 * TM-520 (audit-mcp T7). DID THE LAUNCH FLAGS ACTUALLY LOAD THE ROLE'S TOOLS?
 *
 * A role's MCP servers are child processes of its `claude` process, so `ps --ppid` is the ground
 * truth. Two reviewers ran for days on the argv from before TM-365 (`--safe-mode`, no
 * `--mcp-config`): no review_submit tool, no verdict channel, and nothing said so (TM-488).
 *
 * Expected = the servers the role REQUIRES (the reviewer's ao-review) plus every server its own
 * argv declares with --mcp-config. Under --strict-mcp-config with nothing declared the answer is
 * "none" — said explicitly, so an empty list is never mistaken for a check that did not run.
 * Without --strict-mcp-config the session loads user/project servers this check cannot predict.
 */
export const ROLE_REQUIRED_MCP = { reviewer: [REVIEW_SUBMIT_SERVER] };

export function mcpServersFromArgv(argv) {
  const servers = {};
  argv.forEach((arg, i) => {
    if (arg !== "--mcp-config" || argv[i + 1] === undefined) return;
    const value = argv[i + 1];
    let text = value;
    if (!value.trimStart().startsWith("{")) {
      try { text = readFileSync(value, "utf8"); } catch { return; }
    }
    try { Object.assign(servers, JSON.parse(text).mcpServers ?? {}); } catch { /* unreadable config: its servers stay undeclared and show as missing if required */ }
  });
  return servers;
}

const serverRunsIn = (spec, child) => child.includes(spec.args?.length ? spec.args.at(-1) : spec.command);

export function verifyRoleMcp({ role, agentId = null, pid, argv, children, consumer = null }) {
  const servers = mcpServersFromArgv(argv);
  const safeMode = argv.includes("--safe-mode");
  const strict = argv.includes("--strict-mcp-config");
  const expectedNames = [...new Set([...(ROLE_REQUIRED_MCP[role] ?? []), ...Object.keys(servers)])];
  const base = { role, agent_id: agentId, pid, children: children.length };
  if (!expectedNames.length) {
    return strict
      ? { ...base, expected: "none", present: [], missing: [], ok: true, note: children.length ? `expected none; ${children.length} other child process(es) run` : "expected none, none running" }
      : { ...base, expected: "ambient", present: [], missing: [], ok: true, note: "no --strict-mcp-config: user and project MCP servers load, so the expected set is not known here" };
  }
  const present = [], missing = [];
  for (const name of expectedNames) {
    const spec = servers[name];
    if (spec && !safeMode && children.some((child) => serverRunsIn(spec, child))) { present.push(name); continue; }
    missing.push({
      name,
      reason: safeMode ? "launched with --safe-mode, which turns off every MCP server (argv from before TM-365)"
        : !spec ? "the launch argv has no --mcp-config declaring it"
          : "declared in --mcp-config, but no child process runs it",
    });
  }
  const result = { ...base, expected: expectedNames, present, missing, ok: missing.length === 0 };
  if (missing.length && agentId) {
    result.fix = {
      command: `ao-topology agent restart ${agentId} --mode handoff${consumer ? ` --consumer ${consumer}` : ""}`,
      note: "A forced relaunch is required: `reviewer ensure` / `lead ensure` reattach a live session with its old argv instead of relaunching it (TM-488).",
    };
  }
  return result;
}

/** The live argv and MCP-capable children of one pid, or null when the process is gone. */
export async function readProcess(pid) {
  const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => null);
  if (!cmdline) return null;
  const result = await run("ps", ["-o", "args=", "--ppid", String(pid)], { allowFailure: true, timeoutMs: 5000 }).catch(() => ({ stdout: "" }));
  // Bash tool shells are children too; they are never MCP servers, and counting them would make a
  // lead that "expects none" look polluted.
  const children = String(result.stdout ?? "").split("\n").map((line) => line.trim()).filter((line) => line && !/^\/bin\/(ba|z)?sh -c /.test(line));
  return { argv: cmdline.split("\0").filter(Boolean), children };
}

/** The registered lead and reviewer of `consumer`, each checked against its live process. */
export async function roleMcpReport({ consumer, env = process.env, home, procs = readProcess }) {
  const [{ readLeadRegistration }, { readReviewerRecord }] = await Promise.all([import("./lead.mjs"), import("./reviewer.mjs")]);
  const records = [
    ["lead", (await readLeadRegistration({ consumer, env, home }).catch(() => null))?.record],
    ["reviewer", await readReviewerRecord(consumer, env, home).catch(() => null)],
  ];
  const report = [];
  for (const [role, record] of records) report.push(await roleMcpFor({ role, record, consumer, procs, env, home }));
  return report.filter(Boolean);
}

export async function roleMcpFor({ role, record, consumer = null, procs = readProcess, env = process.env, home = undefined }) {
  const pid = record?.binding?.panePid;
  if (!pid) return null;
  const proc = await procs(pid);
  if (!proc) return { role, agent_id: record.agent_id ?? null, pid, live: false, ok: true, note: "not running; nothing to verify" };
  const result = { live: true, ...verifyRoleMcp({ role, agentId: record.agent_id ?? null, pid, argv: proc.argv, children: proc.children, consumer }) };
  // TM-525: a reviewer without review_submit can never answer its pending requests, and `agent restart`
  // refuses while any is uncollected, so the fix is withdraw, then restart, then request again.
  if (role === "reviewer" && result.fix && consumer) {
    const { pendingReviewRequests } = await import("./reviewer.mjs");
    const pending = await pendingReviewRequests(consumer, env, home).catch(() => []);
    if (pending.length) {
      const at = ` --consumer ${consumer}`;
      result.fix.pending = pending.map((r) => ({ task: r.task, revision: r.revision, nonce: r.nonce }));
      result.fix.sequence = [
        ...pending.map((r) => `ao-topology reviewer withdraw --task ${r.task} --revision ${r.revision} --reason "reviewer cannot submit (TM-520)"${at}`),
        result.fix.command,
        ...pending.map((r) => `ao-topology reviewer request --task ${r.task} --revision ${r.revision} --author <id>${at}`),
      ];
      result.fix.note += ` ${pending.length} review request(s) are pending, which this reviewer cannot answer and which hold the restart off: the lead withdraws them, restarts, then requests the same revisions again (TM-525).`;
    }
  }
  return result;
}

export async function doctor({ adapters, workflowDirs, skillDirs, roleDirs, providerDirs, consumer, env, home, procs = readProcess }) {
  const osInfo = await detectOs();
  const tmux = await tmuxVersion();
  const node = process.version;
  const providers = [];
  for (const adapter of adapters.values()) {
    if (adapter.id === "generic") continue;
    providers.push(await detectAdapter(adapter));
  }
  const dirs = {};
  for (const [label, list] of Object.entries({ workflows: workflowDirs, skills: skillDirs, roles: roleDirs, providers: providerDirs })) {
    dirs[label] = [];
    for (const dir of list) dirs[label].push({ dir, exists: await exists(dir) });
  }
  const problems = [];
  if (!tmux) problems.push({ code: "TMUX_MISSING", message: "tmux is not installed or not on PATH.", fix: tmuxInstallPlan(osInfo) });
  if (osInfo.platform === "win32" && !osInfo.wsl) problems.push({ code: "WINDOWS_HOST", message: "Running on native Windows; tmux sessions must be created inside WSL2 or MSYS2.", fix: tmuxInstallPlan(osInfo) });
  const readyProviders = providers.filter((provider) => provider.ready);
  if (readyProviders.length === 0) problems.push({ code: "NO_PROVIDERS", message: "No known agent CLI was found on PATH. Install at least one, or use cli: <command> with the generic adapter." });
  // Is a supervisor alive for this repository, and how old is its last tick? Without one, the
  // Presence v1 heartbeat stops and every consumer reads this repo as permanently stale — the
  // failure that has no other symptom on this machine, which is exactly why doctor asks.
  // A repo that never started one is reported, not faulted: not every checkout wants a supervisor.
  let supervision = null;
  if (consumer) {
    try {
      const { supervisionStatus } = await import("./supervision.mjs");
      supervision = await supervisionStatus({ consumer, env, home });
      const stallMs = Math.max(60_000, supervision.reconcile_min_ms * 4);
      if (supervision.state === "ownership-record-mismatch") {
        problems.push({ code: "SUPERVISOR_OWNERSHIP_MISMATCH", message: `The live repository supervisor is pid ${supervision.owner?.pid}, but process.json names pid ${supervision.pid}; the lock owner is authoritative. Recorded source: ${supervision.source_entrypoint ?? 'unknown'}.`, fix: { note: `Do not kill or delete the live lock. Inspect ${supervision.record_path} and the lock owner before recovery.` } });
      } else if (supervision.state === "running-without-lock") {
        problems.push({ code: "SUPERVISOR_UNFENCED", message: `Process record pid ${supervision.pid} is alive but does not own the repository supervision lock.`, fix: { note: "Treat the lock owner as authoritative; stop only after verifying its exact process identity." } });
      } else if (supervision.state === "died-before-first-tick") {
        // Distinct from "down" on purpose: this one never worked, so the remedy is to read the
        // startup crash rather than to wonder what killed a healthy daemon hours later.
        problems.push({ code: "SUPERVISOR_NEVER_TICKED", message: `The repository supervisor (pid ${supervision.pid}) died during startup and never completed a tick, so presence for this repo was never published.`, fix: { note: `The reason is at the end of ${supervision.log}` } });
      } else if (supervision.state === "orphaned") {
        problems.push({ code: "SUPERVISOR_ORPHANED", message: `A supervisor record names ${supervision.consumer}, which no longer exists — a removed worktree leaves a record no restart can reclaim.`, fix: { command: `rm ${supervision.record_path}`, note: "Debris only; nothing is running. Delete the record and its .log sibling." } });
      } else if (supervision.state === "down") {
        problems.push({ code: "SUPERVISOR_DOWN", message: `The repository supervisor (pid ${supervision.pid}) is gone after ${supervision.restarts} restart(s); presence for this repo is no longer being republished.`, fix: { command: "ao-topology supervise", note: `Last words, if any: ${supervision.log}` } });
      } else if (supervision.state !== "never-started" && supervision.tick_age_ms !== null && supervision.tick_age_ms > stallMs) {
        problems.push({ code: "SUPERVISOR_STALLED", message: `The supervisor process is alive but its last reconcile tick was ${Math.round(supervision.tick_age_ms / 1000)}s ago (floor ${supervision.reconcile_min_ms}ms).`, fix: { note: `Inspect ${supervision.log}` } });
      }
    } catch (error) {
      supervision = { state: "unknown", error: error.message };
    }
  }
  // TM-167: what the supervisor last did about this repository's lead. A dead externally owned lead
  // needs a human, so it is a problem with the command that reassigns it; a failing recovery shows
  // its action, last error, attempts and next retry. A healthy or never-attempted lead says nothing.
  let leadRecovery = null;
  if (consumer) {
    try {
      const { leadRecoveryStatus } = await import("./lead-recovery.mjs");
      leadRecovery = await leadRecoveryStatus({ consumer, env, home });
      if (leadRecovery.alert) {
        problems.push({ code: "LEAD_DEAD_EXTERNAL", message: leadRecovery.alert.message, fix: { command: leadRecovery.alert.command, note: `Or hand the repository to a managed lead: ${leadRecovery.alert.alternatives?.[0] ?? "ao-topology lead detach, then lead ensure"}` } });
      } else if (leadRecovery.last_error) {
        problems.push({ code: "LEAD_RECOVERY_FAILING", message: `Lead recovery (${leadRecovery.action}) has failed ${leadRecovery.attempts} time(s): ${leadRecovery.last_error}`, fix: { note: `Next automatic retry at ${leadRecovery.next_retry_at ?? "the next reconcile"}; state in ${leadRecovery.state_path}` } });
      }
    } catch (error) {
      leadRecovery = { error: error.message };
    }
  }
  // TM-276 / ADR-0031: which NATS this host is on and why, and an unreachable configured one.
  const { describeTransport } = await import("./orch-transport.mjs");
  const transport = await describeTransport(env ?? process.env, home).catch((error) => ({ error: error.message }));
  const outage = transport?.outage && !transport.outage.recovered_at ? transport.outage : null;
  if (outage?.conflict) problems.push({ code: "NATS_PORT_CONFLICT", message: outage.error, fix: { note: `Stop the process holding port ${outage.conflict.port}, or set a different nats.port in the ao user config and run \`agent-orchestration services ensure\`. ao never moves the port on its own (ADR-0032).` } });
  else if (outage) problems.push({ code: "NATS_CONFIGURED_UNREACHABLE", message: `The configured NATS ${outage.url} (${outage.source}) has been unreachable since ${outage.since}: ${outage.error}. ao is working on ${transport.source} ${transport.url}; other machines on ${outage.url} cannot see this host.`, fix: { note: `Fix the server at ${outage.url}, or remove ${outage.source} from this host's environment. Once nothing on this host has fallen back from it for an hour (AO_NATS_OUTAGE_RETIRE_MS), the outage is retired and this check clears. Each repository supervisor mails its registered lead once per outage and once when it recovers or is retired.` } });
  // TM-155: the first-run trust gate, and the socket-path limit. Both are conditions an operator
  // meets as a stalled pane or a raw tmux error, and both are knowable before anything is launched.
  const trust = await claudeTrust(consumer, home);
  if (trust && trust.trusted !== true && readyProviders.some((provider) => provider.id === "claude")) {
    problems.push({
      code: "CLAUDE_FOLDER_UNTRUSTED",
      message: `Claude Code has never been trusted in ${consumer}, so the first agent session here will stop at its folder-trust question ("❯ No, exit" is the highlighted answer). Nothing types at that screen — by design — so a governed launch will refuse with no visible reason.`,
      fix: { command: `cd ${consumer} && claude`, note: 'Answer "Yes, I trust this folder" once, then Ctrl-C. Agent subdirectories inherit it; this is a per-repository question, not a per-agent one.' },
    });
  }
  const socket = socketPathProblem(env);
  if (socket) problems.push(socket);
  // TM-371: which readable repository the `orch.<key>` NATS subjects belong to.
  const repoId = consumer ? await canonicalRepoId(consumer).catch(() => null) : null;
  const repository = repoId ? { slug: repoSlug(repoId.id), key: repoKey(repoId.id), subjects: `orch.${repoKey(repoId.id)}.>` } : null;
  // TM-520: each live role's MCP children against what the role expects.
  const roleMcp = consumer ? await roleMcpReport({ consumer, env, home, procs }).catch((error) => [{ error: error.message }]) : [];
  for (const entry of roleMcp) {
    if (entry.ok !== false) continue;
    const what = entry.missing.length ? `lacks MCP server(s) ${entry.missing.map((m) => `${m.name} (${m.reason})`).join(", ")}` : entry.note;
    problems.push({ code: "ROLE_MCP_MISSING", message: `Live ${entry.role} ${entry.agent_id} (pid ${entry.pid}) ${what}.`, fix: entry.fix ?? null });
  }
  return { ok: problems.length === 0, os: osInfo, tmux: tmux ?? null, node, providers, dirs, supervision, lead_recovery: leadRecovery, transport, repository, trust, role_mcp: roleMcp, problems };
}
