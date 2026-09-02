# Proposed task-management profile amendment — bounded goal planning

Status: proposal only. This file does not override the managed design-system profile. Canonical wording must land in `ByteDeskAI/design-system` first and then arrive through the managed payload.

## PRODUCT.md

### 1. Replace the final paragraph under `## Product purpose`

Current:

> It is not an issue tracker for a company, not a replacement for Jira, and not a chat surface. It shows the store; it does not have opinions the store does not have.

Proposed replacement:

> It is not an issue tracker for a company, not a replacement for Jira, and not a general chat surface. Plans may host a bounded goal-planning interaction whose only purpose is to clarify one repository-scoped outcome, inspect repository evidence through an operator-selected trusted coding agent, and prepare governed task-management mutations for human approval. That interaction cannot answer unrelated requests, make code changes, or bypass store gates; the existing repo-path and pasted-document import remains available. The store remains the truth: questions, streamed activity, and proposals are transient planning state, not board state, until an approved write succeeds.

Rationale: this changes the narrowest sentence that currently bans the desired flow, preserves the anti-chat stance, and makes the truth boundary explicit.

### 2. Add product promise 6 under `## Product promises`

> 6. Bounded planning uses the dashboard’s AG-UI connection to a backend bridge; the bridge drives the operator-selected trusted coding agent through ACP and supplies the governed task-management skills/tools to that ACP session. Task management has no dependency on a provider-specific agent SDK, including the Claude Agent SDK.

### 3. Add this journey under `## Primary journeys`

> - Turn one repository goal into a governed plan: choose a healthy ACP coding agent, answer only unresolved product decisions, inspect streamed reads and proposed skill actions, approve the mutation set, and open the resulting epic or task; use manual import when agent planning is unavailable or unnecessary.

### 4. Append this sentence to `## Success criteria`

> In the goal planner, an operator can identify the selected coding agent and capability health, distinguish questions from permissions, inspect every proposed board mutation before it runs, and reach the unchanged manual import path at every blocking state.

## DESIGN.md

### 1. Add after the second paragraph of `## Product stance`

> **Bounded planning is a workflow, not a product genre.** The Plans screen may enter a named goal-planner workspace for one repository-scoped outcome. Its interaction vocabulary is outcome intake, structured decisions, attachments, agent/tool activity, proposal cards, permission, refusal and import result—not an open-ended transcript. The workspace ends when the goal is imported, rejected, cancelled or saved as a draft; it does not become a persistent general conversation destination.

### 2. Add after the `Layout.` paragraph in `## Visual language`

> **Goal-planner composition.** Keep the standard rail, command bar and Plans route. The central canvas carries the bounded goal, structured questions and mutation proposal; the lifted right inspector names the selected coding agent, ACP/capability health and AG-UI event trace. On tablet the inspector is a slide-over; on phone it is a full-screen sheet opened by an explicit Trace control. The existing Plans inbox and manual Import goal action remain reachable from the page header.

### 3. Add after the `Voice.` paragraph in `## Visual language`

> **Planning voice.** Agent text is routed into a named structured slot—question context, evidence summary, proposal consequence, refusal or result—and never rendered as alternating speech bubbles. Questions ask only for unresolved human decisions and cite the repository fact that made the decision necessary. Permission copy names the exact mutation, scope, consequence and persistence; it is never phrased as conversational assent.

### 4. Add these bullets to `## Component and composition rules`

> - The planner-agent control always names the operator-selected coding agent, ACP connection state, governed task-management capability health and write-permission mode before a run can start. Missing required skills are blocking. A Claude Code option, when configured, is an ACP agent; the dashboard and bridge do not depend on the Claude Agent SDK.
> - Goal intake is a single bounded outcome plus optional reviewed attachments. After submission, the composer does not remain an unrestricted general prompt box; continued input is tied to a structured elicitation, proposal revision or cancellation.
> - ACP elicitation and ACP permission are different components. Elicitation renders as a numbered decision form. Permission renders as an elevated confirmation over the exact proposed action card and preserves the agent-offered option id.
> - Governed board mutations render as inspectable approval cards with tool/skill name, complete arguments, affected entities, dependency order, consequence, validation state and permission scope. Conversational prose is not a substitute for this preview.
> - Read-only tool calls remain visible in the event trace. Private chain-of-thought is never shown; use coarse step and tool lifecycle labels instead.
> - A planning run cannot execute a board mutation until the corresponding proposal is visible and the operator has made the required permission decision. A store refusal is shown verbatim at that action and no partial sibling result is implied.
> - Manual repo-path and pasted-document import remains present in empty, offline, unavailable-agent, refusal and success recovery paths and continues through the existing store functions and gates.

### 5. Extend the gated mockup sentence

Current sentence ends with:

> ... **Sessions**, **Health**, **Settings**.

Proposed replacement for the full sentence:

> Gated HTML mockups, each at 390, 1024 and 1440 widths, in dark and light parity, with keyboard focus visible, reduced motion, and empty / loading / offline / refused / destructive states: **Board**, **Backlog**, **Task**, **Epic**, **Graph**, **Timeline**, **Sessions**, **Health**, **Settings** and **Goal planner**. Goal planner additionally covers questioning, attachment transfer, selected-agent/capability health, AG-UI streaming and tool calls, proposed skill actions, ACP permission confirmation, validation refusal, import success and unavailable-agent states.

### 6. Add these bullets to `## Accessibility`

> - A structured question announces its ordinal, decision label, evidence and selected option. On resolution, focus moves to the next unresolved question or the Continue action.
> - A permission request moves focus to the confirmation heading; rejection/approval returns focus to the originating proposal card. Tool progress is announced politely at step boundaries, not for every streamed token.
> - Agent health, connection, permission and mutation status always use word plus dot/glyph. Attachment state includes the file name and whether it is session context or board evidence.

### 7. Extend `## Bans`

Append:

> It also does not use general-purpose chat history, speech bubbles, an always-open unrestricted prompt composer, simulated chain-of-thought, provider-specific SDK chrome, or approval controls detached from the exact mutation they authorize.

## Intentionally unchanged

- “The Claim Board” remains the creative north star.
- Store truth, verbatim refusals, completeness gates, manual import, status vocabulary, shell anatomy, density, theme parity and the single claimed-card edge-light all remain authoritative.
- No new product accent, logo, message-avatar system, or chat route is introduced.
