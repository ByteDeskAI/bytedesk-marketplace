---
name: bytedesk-workflow-runtime-smoke
description: >-
  End-to-end runtime proof for ByteDesk Office workflow changes. Use for Office
  workflow catalog, workflow harness, workflow runner/debugger, workflow
  runtime tools, SignalR run events, typed ports, node-as-function, database
  workflow rows, bundled workflow seed, Omnigent /sources, and "is the workflow
  actually loaded/runnable?" validation. Produces current DB/API/runtime/browser
  evidence instead of static code assertions.
user-invokable: true
argument-hint: "[workflow slug/id or change description]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Prove the Office workflow system works through the real local runtime:
Platform Office DB/API -> Omnigent harness `/sources` -> run dispatch -> event
publisher/SignalR -> Web runner/debugger/browser.

## Smoke Ladder

Run only the levels relevant to the change, but do not skip a lower level when
the higher level fails.

1. **Local runtime freshness**
   ```bash
   workflow-runtime-smoke --workflow <slug-or-id>
   ```
   Or run the individual checks when you need more control:
   ```bash
   scripts/dev/workflow.mjs status
   microk8s kubectl -n bytedesk rollout status deployment/office --timeout=180s
   microk8s kubectl -n bytedesk rollout status deployment/web --timeout=180s
   microk8s kubectl -n bytedesk rollout status deployment/bytedesk-omnigent --timeout=300s
   ```
2. **Omnigent gateway and plugin**
   ```bash
   curl -fsS http://bytedesk-omnigent.localhost/healthz
   curl -fsS http://bytedesk-omnigent.localhost/readyz
   omnigent plugins inspect bytedesk-workflow-harness --runtime --json
   ```
3. **Workflow source registry**
   Check `/api/office/workflows/sources` from Office or the Omnigent route used
   by the harness. Record source count, graph/row count, and whether target
   workflow ids are present. If the gateway loads `/sources` only at startup,
   restart/reload Omnigent once after a fresh publish.
   For registry/catalog drift, run:
   ```bash
   workflow-registry-drift-proof --workflow <slug-or-id>
   ```
4. **Run dispatch**
   Start a deterministic workflow via the real gateway route or Office internal
   API. Prefer pure transform/tool workflows for smoke; avoid LLM-dependent
   paths unless the task is specifically agent behavior.
5. **Run evidence**
   Capture run id, final status, terminal snapshot, key node outputs, and any
   run events. For debugger work, prove the browser route renders the run.
6. **Browser proof for Web surfaces**
   Invoke `bytedesk-browser-test` against the changed route, usually
   `/office/workflows`, `/office/workflows/library/<id>`,
   `/office/workflows/library/<id>/edit`, or `/office/workflows/runs/<runId>`.

## Known Runtime Gotchas

- Omnigent uses a recreate/init startup pattern; wait several minutes for full
  rollout before treating early readiness failures as meaningful.
- A fresh workflow publish may require one gateway restart because the harness
  registry reads `/sources` at startup.
- If the browser shows stale workflow UI after a merge, run
  `scripts/dev/workflow.mjs sync-develop-runtime --roll web`.
- Workflow registry screens can show stale counts when generated DSL artifacts,
  Office API counts, Omnigent registry routes, Office cache, or browser runtime
  are out of sync. Prove each layer before changing UI code.
- Do not confuse a green unit test with runtime proof. For workflow changes,
  the proof is the loaded registry plus a real run/browser state.

## Report Format

```markdown
Workflow runtime smoke: PASS/FAIL
Runtime freshness: <develop/localDev/Omnigent evidence>
Registry: <source count, graph rows, target present?>
Run: <workflow id, run id, status, key outputs>
Browser: <route, screenshot path, errors empty?>
Follow-ups: <only non-blocking residuals>
```