# TM-134 — patch for `topology/cli.mjs` (integrator-owned)

**Based on `main` @ `ebc92e3`** (`agent-orchestration/topology/cli.mjs`, 1024 lines), not on the
`f3f21e7` copy in this worktree. Re-verified against the merged file after TM-127 landed: the
`commands` map, `out`, `list`, `absolutize` and `context` are all unchanged, and the new
`ensureSupervision(ctx)` helper (line 243) is used below.

`topology/cli.mjs` is integrator-owned this cycle, so this is the exact patch rather than an edit.
It is the whole CLI surface for TM-134: one verb, because `roles.mjs` exposes a single
`roleCommand({ verb, ... })` entry point deliberately so this patch stays small.

Nothing else in `cli.mjs` changes. `lead …` and `reviewer …` keep working exactly as they do now —
`role` is a surface over them, not a replacement.

## 1. USAGE — under "Standing repository services"

Insert after the existing `reviewer …` line (**line 79** on `main`), before the `prompt …` line:

```diff
   lead status|ensure|assign <agent>|detach|probes|ack <nonce>
   reviewer status|ensure|request|collect|eligible [--task TM-id --revision <sha> --author <id>]
+  role list|show <role>|status <role>|assign <role> [<agent>]|ensure <role> [<agent>]
+       |reassign <role> [<agent>] [--force]|detach <role> [<agent>] [--kill]|history <role>
+                                                lead, reviewer, worker, designer, image-gen
   prompt preview|refresh|watch|ack <agent> [--revision <hash> --nonce <nonce>]
```

## 2. The command — insert after the `async lead({ … })` handler

On `main` that handler closes at **line 367** (`  },`) and `async prompt({ flags, positional }) {`
begins at line 368. Insert between them:

```js
  async role({ flags, positional }) {
    // One surface over lead.mjs and reviewer.mjs; roles.mjs does the dispatch, so this stays a
    // parameter map. `role status` prints registered/alive/responsive as three separate fields —
    // do not collapse them into one tick when rendering non-JSON output later.
    const ctx = context(flags);
    const { roleCommand } = await import('./lib/roles.mjs');
    const verb = positional[0] || 'list';
    const result = await roleCommand({
      ...ctx,
      verb,
      role: positional[1],
      agentRef: positional[2] ?? (flags.agent && flags.agent !== true ? String(flags.agent) : null),
      session: flags.session && flags.session !== true ? String(flags.session) : null,
      notAgentIds: list(flags.author),
      runDir: flags.run && flags.run !== true ? absolutize(String(flags.run)) : null,
      force: flags.force === true,
      kill: flags.kill === true,
      limit: Number(flags.limit || 0),
      ackTimeoutMs: Number(flags['ack-timeout'] || 5000),
    });
    // A verb that leaves the repo with a standing holder starts supervision, exactly as
    // `lead ensure` and `lead assign` do — two surfaces onto the same operation must not differ on
    // whether presence gets published afterwards. Read-only verbs and `detach` do not.
    return out(['assign', 'ensure', 'reassign'].includes(verb)
      ? { ...result, supervision: await ensureSupervision(ctx) }
      : result);
  },
```

No new imports: `out`, `list`, `absolutize`, `context` and `ensureSupervision` are all already in
scope, and `roles.mjs` is imported lazily exactly the way `lead`, `reviewer`, `startup` and
`supervise` already do it.

## Notes for the integrator

- **On `ensureSupervision` vs `startRepositorySupervision`.** The `lead` handler still calls
  `startRepositorySupervision` directly (lines 356 and 361), so a supervision failure makes
  `lead ensure` / `lead assign` throw, while every verb touched by `d79db04` uses the non-fatal
  `ensureSupervision`. I used the non-fatal helper — it is the house style for verbs added after
  that commit, and "a repo with no supervisor publishes stale presence, which is a degraded repo,
  not a failed command" applies to `role assign lead` for exactly the same reason it applies to
  `session open`. That leaves `lead …` and `role … lead` differing on *failure* handling only, never
  on whether supervision is started. Reconciling the two `lead` call sites is a separate change and
  not mine to make.
- `roleCommand` throws `TOPOLOGY_SUBCOMMAND_UNKNOWN` for an unknown verb and `TOPOLOGY_ROLE_REQUIRED`
  when a verb other than `list` is given no role, so no argument validation belongs here.
- `--kill` reaches `detachLead` / `detachReviewer` / the managed-role-session guard unchanged: it is
  still the only flag on any verb that ends a live session, and an externally-owned pane is still
  never killed.
- `role assign <role>` with **no** agent reference is meaningful for the non-singleton roles: it
  mints a new agent in that role via `createAgent`. For `lead` and `reviewer` the reference is
  required and the underlying `assignLead` / `assignReviewer` say so.
