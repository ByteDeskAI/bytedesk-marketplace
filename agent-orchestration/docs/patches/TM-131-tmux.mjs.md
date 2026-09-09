# TM-131 — patch for `topology/lib/tmux.mjs` (integrator-owned)

**One line.** Add `pane_title` to `listServerPanes`' field list and to the row it returns.

## Why

The census decides "is this agent working" from a spinner. The pane **title** already carries that
spinner for codex, kimi and grok — measured live on 2026-09-09, a working codex pane's title reads
`⠹ bytedesk-remote-gateway` and an idle one reads `bytedesk-remote-gateway` — and the supervisor is
*already* making exactly one `list-panes -a` call per tick. Adding one tab-separated column to that
call gives the busy check for every pane on the server at **zero extra tmux calls**. Without it the
census has to `capture-pane` every agent every tick, which is one tmux client fork per agent per
second — the cost this whole layer exists to avoid.

## Safety

Additive. `presence.mjs`'s `validBinding` checks six **named** fields (`serverKey`, `sessionId`,
`paneId`, `serverPid`, `sessionCreated`, `panePid`) and ignores extras, so an extra property on the
row changes nothing for presence, and no wire output moves. Presence v1 stays frozen.

## The change

```diff
 /** Enumerate exact pane incarnations on the selected server, independent of session names. */
 export async function listServerPanes({ tmuxServer, env = process.env } = {}) {
-  const fields = ["socket_path", "pid", "session_id", "session_created", "pane_id", "pane_pid", "session_name", "pane_current_command", "pane_current_path", "pane_dead"];
+  // `pane_title` is here for the liveness census (TM-131): codex, kimi and grok animate a braille
+  // spinner in the pane title, so one extra column on the listing the supervisor already takes
+  // answers "is this agent working" for every pane on the server without a single extra tmux call.
+  const fields = ["socket_path", "pid", "session_id", "session_created", "pane_id", "pane_pid", "session_name", "pane_current_command", "pane_current_path", "pane_dead", "pane_title"];
   const result = await tmux(["-u", "list-panes", "-a", "-F", fields.map((key) => `#{${key}}`).join("\t")], { tmuxServer, env, allowFailure: true });
   if (result.code !== 0) {
     if (/no server running|error connecting.*No such file|failed to connect.*No such file/.test(result.stderr)) return [];
     fail("TOPOLOGY_TMUX_OBSERVATION_FAILED", "Cannot enumerate tmux panes; liveness is unknown.");
   }
   return result.stdout.split("\n").filter(Boolean).map((line) => {
-    const [serverKey, serverPid, sessionId, sessionCreated, paneId, panePid, sessionName, command, cwd, dead] = line.split("\t");
-    return { serverKey, serverPid: Number(serverPid), sessionId, sessionCreated: Number(sessionCreated), paneId, panePid: Number(panePid), sessionName, command, cwd, alive: dead === "0" };
+    const [serverKey, serverPid, sessionId, sessionCreated, paneId, panePid, sessionName, command, cwd, dead, title] = line.split("\t");
+    return { serverKey, serverPid: Number(serverPid), sessionId, sessionCreated: Number(sessionCreated), paneId, panePid: Number(panePid), sessionName, command, cwd, alive: dead === "0", title: title ?? "" };
   });
 }
```

Keep `pane_title` **last** in the list. A title is the one field that can contain almost anything;
appending it means a pathological title cannot shift the column index of any field that matters, and
`split("\t")` truncating a title (tmux rewrites control characters, but a literal tab would still
split) degrades to a short title rather than to a corrupt binding.
