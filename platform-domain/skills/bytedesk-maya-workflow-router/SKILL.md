---
name: bytedesk-maya-workflow-router
description: >-
  Deterministic Maya Office-chat workflow routing validation. Use when Maya
  should select, ask for inputs, dispatch, or complete an Office workflow from a
  chat request; for workflow-router, /bytedesk/workflows/route,
  ChannelTriggerRouter, Office channel adapter, client-onboarding Drive
  workflow, pending input collection, route completion-wait, or "test via Maya
  in Office chat" tasks.
user-invokable: true
argument-hint: "[chat request or workflow slug]"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Prove Maya routes workflow-related chat through the deterministic router, not
through prompt hope. The golden path is: user asks -> router classifies or asks
for missing inputs -> Office adapter stores pending state -> route dispatches
workflow -> completion message includes the useful result/link -> non-workflow
chat falls back to normal conversation.

## Code Surfaces

- Omnigent harness router: `plugins/bytedesk-workflow-harness/src/intake/workflow-router.ts`
- Omnigent route: `POST /bytedesk/workflows/route`
- Catalog tool: `bytedesk_workflow_catalog`
- Office adapter:
  `src/ByteDesk.Office/Services/Communications/OmnigentOfficeChannelAdapter.cs`
- Pending state cache key shape:
  `workflow-route:pending:{ConversationId:N}`
- Completion wait: route waits for terminal snapshot and extracts web view link

## Validation Ladder

1. **Unit contract**
   - Router tests cover `ask`, `dispatch`, `pass`, pending input collection,
     and no-workflow fallback.
   - Office adapter tests prove `ask`/`dispatch` append agent replies and
     `pass` falls through to normal Omnigent chat.
2. **Runtime freshness**
   - Use `bytedesk-omnigent-operator` to prove the harness plugin is loaded.
   - Use `scripts/dev/workflow.mjs status` to prove Office/Web localDev mapping.
3. **Office chat path**
   - Send a real Office chat message to Maya.
   - For a missing-input request, verify Maya asks the missing question.
   - Reply with the missing value.
   - Verify the workflow dispatches exactly once and returns the completion
     message with the expected link/result.
4. **Cleanup**
   - Remove accidental external artifacts from failed retries, such as duplicate
     Drive test folders, before declaring the test complete.

## Expected Evidence

```markdown
Maya router smoke: PASS/FAIL
Request: <user message>
Router decisions: ask -> dispatch/pass
Pending state: <conversation key evidence>
Workflow run: <workflow id, run id, terminal status>
Completion: <message/link>
Fallback check: <non-workflow prompt passed through?>
Cleanup: <external artifacts removed or none created>
```

## Anti-patterns

- Do not rely only on Maya's system prompt for workflow selection.
- Do not call a lower-level harness route and claim Office-chat validation.
- Do not leave timeout-driven duplicate external artifacts behind.
- Do not claim success when the chat only prepared for Ryan to test manually.