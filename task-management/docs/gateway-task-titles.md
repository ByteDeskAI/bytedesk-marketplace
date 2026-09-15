# Gateway task titles

Gateway can show the active task IDs for one terminal without reading its prompt
or inferring ownership from its working directory. Task Management remains the
source of task status and claims.

A claim or holder heartbeat records an optional `gateway` binding when the current
harness session matches the claimed session. The existing Gateway tab ID and tmux
session environment identify the intended terminal; a bounded tmux query records
the actual socket, server PID, session ID and creation time, pane ID and pane PID.
Missing or mismatched identity leaves the claim unbound. These values are
presentation provenance, not authorization to read or mutate another task.

`GET /api/gateway/active-tasks` returns `{version: 1, bindings: [...]}`. Each binding
contains `tabId`, `sessionName`, `tmux`, and naturally ordered `activeTaskIds`.
Only nonexpired claims with a harness session, a valid recorded binding, and a
current `in_progress` task appear. The existing task lifecycle releases claims on
done, block, park, and release. A claim made before start does not produce a title.
Existing unbound claims can gain a binding through a subsequent holder heartbeat.

The Gateway must validate the returned binding against the current terminal's
exact tmux incarnation before presenting IDs. An environment value or CWD match
alone does not establish that relationship. Multiple active tasks remain a list;
Gateway renders the first naturally ordered ID and a count, with all IDs in its
menu. No active task uses the provider name. Actor names remain separate metadata.

Task dashboard availability is separate from task status. A consumer may retain a
bounded last-known result while marking it stale, but only while the same exact
terminal binding still validates. Expiry or loss of that binding withdraws the
association; it never completes a task.

Regression: `node --test tests/unit/gateway-binding.test.mjs` from this plugin.
