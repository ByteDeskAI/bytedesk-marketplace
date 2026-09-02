/**
 * task-management hooks for Pi (@earendil-works/pi-coding-agent).
 *
 * Pi's hook surface is not shell commands — it is in-process TypeScript extensions
 * (its docs/extensions.md; the CLI predates the rename, so its CHANGELOG still says
 * "hooks"). Install by copying this file to one of Pi's auto-discovered locations:
 *
 *   ~/.pi/agent/extensions/tm-hooks.ts     (every project)
 *   .pi/extensions/tm-hooks.ts             (this project only; needs project trust)
 *
 * or load once with `pi -e ./tm-hooks.ts`. `/reload` picks up edits.
 *
 * What is wired, and what is not — all measured on pi 0.82.0 (TM-081):
 *
 *   - session_start  → tm-hook session-start   (restore board context, refresh launchers)
 *   - tool_result    → tm-hook post-bash / post-edit for bash + edit/write
 *                      (commit→task linking and touches tracking, payload re-shaped to
 *                      the Claude wire those entrypoints already read)
 *   - agent_settled  → tm-hook stop            (the Stop gate; Pi cannot block a settled
 *                      agent, so a block surfaces as a warning notification)
 *   - session_shutdown → tm-hook session-end   (parks anything left in_progress — the
 *                      deterministic half of the Stop gate for Pi)
 *
 *   - NOT wired: pre-task-create / post-task. Pi ships no native task/todo tool
 *     (dist/core/tools is read/bash/edit/write/grep/find/ls; the todo list and
 *     plan-mode in its CHANGELOG are example extensions, not shipped tools), so there
 *     is nothing to gate or mirror. Tasks reach the store through the MCP tm_* tools
 *     instead — pi-mcp-adapter reads a Claude-shaped ~/.pi/agent/mcp.json.
 *
 * Session identity: extensions run inside pi, where PI_SESSION_ID is NOT set — pi
 * exports it only to bash-tool subprocesses. So every payload carries
 * ctx.sessionManager.getSessionId() as `session_id`, and bin/tm adopts it as
 * TM_SESSION_ID (payload wins over environment — the Codex path).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import * as path from "node:path";

/** The committed project launcher; `tm init` writes it. Node-executed so no +x or shell is needed. */
const HOOK = path.join(".bytedesk", "task-management", "bin", "tm-hook");

interface TmResult {
  decision?: string;
  reason?: string;
}

/** Fire one tm-hook event; always resolves, never throws into the session. */
function tmHook(
  event: string,
  payload: Record<string, unknown>,
  cwd: string,
): Promise<TmResult | null> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [HOOK, event],
      { cwd, timeout: 10_000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null); // a hook's stdout that is not JSON is not a decision
        }
      },
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

/** tool_result content blocks → one text blob, the shape linkGit reads as tool_response.stdout. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" ? String((c as { text?: string }).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  const base = (ctx: { cwd: string; sessionManager: { getSessionId(): string } }) => ({
    session_id: ctx.sessionManager.getSessionId(),
    cwd: ctx.cwd,
  });

  pi.on("session_start", async (_event, ctx) => {
    await tmHook("session-start", base(ctx), ctx.cwd);
  });

  pi.on("tool_result", async (event, ctx) => {
    const payload = { ...base(ctx), hook_event_name: "PostToolUse" };
    if (event.toolName === "bash") {
      await tmHook(
        "post-bash",
        { ...payload, tool_name: "Bash", tool_input: event.input, tool_response: { stdout: textOf(event.content) } },
        ctx.cwd,
      );
    } else if (event.toolName === "edit" || event.toolName === "write") {
      // Pi names the field `path`; the store's touches tracker reads Claude's `file_path`.
      await tmHook(
        "post-edit",
        {
          ...payload,
          tool_name: event.toolName === "edit" ? "Edit" : "Write",
          tool_input: { ...(event.input as Record<string, unknown>), file_path: (event.input as { path?: string })?.path },
        },
        ctx.cwd,
      );
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const r = await tmHook("stop", base(ctx), ctx.cwd);
    if (r?.decision === "block" && r.reason && ctx.hasUI) {
      // Pi has no blockable stop event — the gate's reason lands as a warning, and
      // session_shutdown below still parks abandoned in_progress work deterministically.
      ctx.ui.notify(`task-management: ${r.reason}`, "warning");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await tmHook("session-end", base(ctx), ctx.cwd);
  });
}
