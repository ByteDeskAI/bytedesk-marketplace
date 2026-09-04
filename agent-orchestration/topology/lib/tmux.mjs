// Thin tmux wrapper. Every call is argv-based; pane targets are always `session:window.pane` ids
// recorded at launch so later commands never guess by index.
import { fail, run } from "./util.mjs";

const TMUX = process.env.AO_TMUX_COMMAND || "tmux";

export async function tmux(args, options = {}) {
  const result = await run(TMUX, args, { allowFailure: true, timeoutMs: options.timeoutMs ?? 15_000 }).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
  if (result.code !== 0 && !options.allowFailure) {
    fail("TOPOLOGY_TMUX_FAILED", `tmux ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`, { args });
  }
  return result;
}

export async function tmuxVersion() {
  const result = await tmux(["-V"], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function hasSession(session) {
  const result = await tmux(["has-session", "-t", `=${session}`], { allowFailure: true });
  return result.code === 0;
}

export async function newSession(session, { cwd, windowName = "main" }) {
  await tmux(["new-session", "-d", "-s", session, "-n", windowName, "-c", cwd, "-x", "220", "-y", "60"]);
  return paneId(`${session}:${windowName}`);
}

export async function newWindow(session, windowName, cwd) {
  await tmux(["new-window", "-t", session, "-n", windowName, "-c", cwd]);
  return paneId(`${session}:${windowName}`);
}

export async function splitPane(target, { cwd, horizontal = false }) {
  const result = await tmux(["split-window", horizontal ? "-h" : "-v", "-t", target, "-c", cwd, "-P", "-F", "#{pane_id}"]);
  return result.stdout.trim();
}

export async function selectLayout(target, layout) {
  await tmux(["select-layout", "-t", target, layout]);
}

export async function paneId(target) {
  const result = await tmux(["display-message", "-p", "-t", target, "#{pane_id}"]);
  return result.stdout.trim();
}

export async function setPaneTitle(pane, title) {
  await tmux(["select-pane", "-t", pane, "-T", title], { allowFailure: true });
}

/** Type text into a pane. Literal mode (-l) avoids tmux key-name interpretation of the message. */
export async function sendText(pane, text, submitKeys = ["Enter"]) {
  await tmux(["send-keys", "-t", pane, "-l", "--", text]);
  for (const key of submitKeys) {
    await tmux(["send-keys", "-t", pane, key]);
  }
}

export async function sendKeys(pane, keys) {
  await tmux(["send-keys", "-t", pane, ...keys]);
}

export async function capture(pane, lines = 60) {
  const result = await tmux(["capture-pane", "-p", "-t", pane, "-S", `-${lines}`], { allowFailure: true });
  return result.code === 0 ? result.stdout : "";
}

export async function paneAlive(pane) {
  const result = await tmux(["display-message", "-p", "-t", pane, "#{pane_dead}"], { allowFailure: true });
  if (result.code !== 0) return false;
  return result.stdout.trim() !== "1";
}

export async function listPanes(session) {
  // tmux rewrites control characters in format output as "_", so use a visible separator.
  const SEP = "|";
  const result = await tmux(["list-panes", "-s", "-t", `=${session}`, "-F", ["#{pane_id}", "#{window_name}", "#{pane_title}", "#{pane_current_command}", "#{pane_dead}"].join(SEP)], { allowFailure: true });
  if (result.code !== 0) return [];
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, window, title, command, dead] = line.split(SEP);
      return { id, window, title, command, alive: dead !== "1" };
    });
}

export async function killSession(session) {
  await tmux(["kill-session", "-t", `=${session}`], { allowFailure: true });
}

export async function selectPane(pane) {
  await tmux(["select-pane", "-t", pane], { allowFailure: true });
}

export function attachCommand(session) {
  return `${TMUX} attach -t ${session}`;
}
