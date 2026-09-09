# TM-134 — patch for `topology/cli.mjs` (integrator-owned)

`topology/cli.mjs` is integrator-owned this cycle, so this is the exact patch rather than an edit.
It is the whole CLI surface for TM-134: one verb, three lines of dispatch, because `roles.mjs`
exposes a single `roleCommand({ verb, ... })` entry point deliberately so this patch stays small.

Nothing else in `cli.mjs` changes. `lead …` and `reviewer …` keep working exactly as they do now —
`role` is a surface over them, not a replacement.

## 1. USAGE — one line, under "Standing repository services"

Insert after the existing `reviewer …` line (currently line 79):

```diff
   lead status|ensure|assign <agent>|detach|probes|ack <nonce>
   reviewer status|ensure|request|collect|eligible [--task TM-id --revision <sha> --author <id>]
+  role list|show <role>|status <role>|assign <role> [<agent>]|ensure <role> [<agent>]
+       |reassign <role> [<agent>] [--force]|detach <role> [<agent>] [--kill]|history <role>
+                                                lead, reviewer, worker, designer, image-gen
   prompt preview|refresh|watch|ack <agent> [--revision <hash> --nonce <nonce>]
```

## 2. The command — insert immediately after the `async lead({ … })` handler (currently ends line 339)

```js
  async role({ flags, positional }) {
    // One surface over lead.mjs and reviewer.mjs; roles.mjs does the dispatch, so this stays a
    // parameter map. `role status` prints registered/alive/responsive as three separate fields —
    // do not collapse them into one tick when rendering non-JSON output later.
    const { roleCommand } = await import('./lib/roles.mjs');
    return out(await roleCommand({
      ...context(flags),
      verb: positional[0] || 'list',
      role: positional[1],
      agentRef: positional[2] ?? (flags.agent && flags.agent !== true ? String(flags.agent) : null),
      session: flags.session && flags.session !== true ? String(flags.session) : null,
      notAgentIds: list(flags.author),
      runDir: flags.run && flags.run !== true ? absolutize(String(flags.run)) : null,
      force: flags.force === true,
      kill: flags.kill === true,
      limit: Number(flags.limit || 0),
      ackTimeoutMs: Number(flags['ack-timeout'] || 5000),
    }));
  },
```

No new imports: `out`, `list`, `absolutize` and `context` are already in scope, and `roles.mjs` is
imported lazily exactly the way `lead`, `reviewer`, `startup` and `supervise` already do it.

## Notes for the integrator

- `roleCommand` throws `TOPOLOGY_SUBCOMMAND_UNKNOWN` for an unknown verb and `TOPOLOGY_ROLE_REQUIRED`
  when a verb other than `list` is given no role, so no argument validation belongs here.
- `--kill` reaches `detachLead` / `detachReviewer` / the managed-role-session guard unchanged: it is
  still the only flag on any verb that ends a live session, and an externally-owned pane is still
  never killed.
- `role assign <role>` with **no** agent reference is meaningful for the non-singleton roles: it
  mints a new agent in that role via `createAgent`. For `lead` and `reviewer` the reference is
  required and the underlying `assignLead` / `assignReviewer` say so.
