# Cutover ↔ capability hooks

After a **successful** cutover command (exit 0), record it against the capability store so ops
work is not lost to chat memory. The store is the task store — `tm cap`, not a markdown registry.

## After feature cutover PASS → ask `/commit`

When the cutover completed **feature / implementation** work (post-task auto-cutover or
operator `/cutover` after a product change):

1. **Ask** the operator to run `/commit` (or “commit and push” / land the changes).
2. **Do not** auto-run the commit skill or invent a land without agreement.
3. Skip the ask only if `git status` is clean / already pushed, or the user already
   ordered commit in the same turn.

This is a standing agent rule (`AGENTS.md`, cutover skill safety gate). Ops-only cutover
with no repo changes does not need the prompt.

## Always (light)

Attach the evidence path to whatever capability the cutover shipped, then ship it:

```bash
# Prefer the idempotent scanner (CAP-0038) after postflight PASS:
scripts/attach-cutover-evidence.sh --dry-run CAP-00NN   # planned tm evidence lines
scripts/attach-cutover-evidence.sh CAP-00NN             # attaches PASS postflight paths

# Or manual single path:
tm evidence CAP-00NN _uptime_evidence/<file>
tm cap ship CAP-00NN
```

Skill-bundled copy (when not in monorepo root):

```bash
"$SKILL_DIR/scripts/attach-cutover-evidence.sh" --dry-run CAP-00NN
"$SKILL_DIR/scripts/attach-cutover-evidence.sh" CAP-00NN
```

`attach-cutover-evidence.sh` scans `_uptime_evidence/postflight-*.txt` for `PASS` lines
(optionally `--include-preflight` / `--include-stage`), defaults open **CAP-0026** /
**CAP-0035** plus any CLI CAP ids, skips already-attached paths, never opens
`control.env` or `config.json`. If `tm` is missing it prints the manual commands.

`tm cap ship` refuses without evidence, which is the whole gate — a capability is never shipped
on assertion. The gateway's own runner still writes `cutover.last-pass.json` and the
`_uptime_evidence/` files; those paths are what you attach.

If the cutover shipped nothing on the backlog, no capability changes. `tm log` already has the
event trail — do not invent a card to have something to close.

## CAP-0026 (postflight first-class)

When the mode was `postflight`, or any restart/deploy that printed `postflight PASS`:

- If CAP-0026 is still open and `scripts/deploy-safe.sh` has a `postflight)` case, ship it.
- Evidence: `scripts/deploy-safe.sh` (the `postflight` verb) and `_uptime_evidence/postflight-*.txt`
  — the path only, never the contents, which can carry secrets.
- After PASS, run `scripts/attach-cutover-evidence.sh` (or the skill-bundled copy). It auto-targets
  open CAP-0026/CAP-0035 and any extra CAP ids you pass; use `--dry-run` first if unsure.

## New friction → propose, do not auto-implement

If cutover failed for a **product** reason (not an operator cancel), draft a capability with
`tm cap new` (see the `enhance-propose` skill). Check `tm cap list` first — a near-duplicate under
a new title is how this backlog rots.

| Failure class | Capability seed |
|---------------|-----------------|
| Remote probe flaky after healthy local | Tunnel/postflight probe hardening |
| Stage UNCHANGED confuses operators | Clearer stage.result messaging in SPA Home |
| Tabs lost after restart | Regression on CAP-0021 |
| SPA dead iframe after reconnect | Regression on CAP-0032 / CAP-0023 |
| Shadow verify false negative | Shadow timeout / port conflict capability |

Write a research pack under `.bytedesk/task-management/research/YYYY-MM-DD-cutover-<slug>.md`
only if the failure is genuinely novel.

## /enhance integration

When capture or research runs:

- Confirm `scripts/deploy-safe.sh` modes, including `postflight`.
- The ops row in `product-state.md` should read preflight → stage → restart-cutover → postflight → deploy.
- Prefer ops capabilities that improve cutover reliability over re-documenting the script.

## Evidence hygiene

- Prefer **path + command + exit code** over pasting full remote HTML.
- Never paste `control.env`, cookies, or session tokens into a capability card.
- Evidence directories may be gitignored — the path is still valid for an operator on the box.
