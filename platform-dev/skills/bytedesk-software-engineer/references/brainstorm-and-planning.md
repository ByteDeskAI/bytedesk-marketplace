# Brainstorm & Planning Reference

Detailed steps for the `start` command's two paths. Keep this file open while running either phase.

---

## Planning Phase — `start {BDP-N}` (Epic has a Discovery doc)

### Step 1 — Pull context

Fetch the Jira Epic with `mcp__atlassian__getJiraIssue`. Then search Confluence for the Discovery doc:

```
CQL: title = "{BDP-N} Discovery" AND space.key = "BDP"
```

Use `mcp__atlassian__searchConfluenceUsingCql`. If found, fetch the full page with `mcp__atlassian__getConfluencePage` using the page `id`.

If no Discovery doc exists, tell the user and proceed as a description-based start.

Transition the Epic to **In Progress** before the hardening session.

### Step 2 — Harden the plan (iterative)

Present your read of the Discovery doc: what you understand about the problem, what the proposed approach is, and what's still ambiguous.

Then drive a focused hardening session. The Discovery doc captures intent — hardening converts it into an implementation spec. Push on:

- **Endpoint names and shapes** — exact request/response types, HTTP methods, route paths
- **Domain model** — new entities or columns, FK relationships, enum values
- **Consumer design** — which commands/events, idempotency strategy
- **Frontend scope** — which pages/components are new vs. modified, which hooks are needed
- **TDD sequence** — ordered RED-GREEN cycles; name the first failing test explicitly
- **Integration points** — which services are called, what realtime topics if any
- **Migration impact** — does this affect existing data rows?

Keep iterating until the user says done.

### Step 3 — Write and upload the Plan

Produce the feature brief (template below). Then:

1. Find the "Plans" folder in Confluence space `491524`:
   ```
   CQL: title = "Plans" AND space.key = "BDP"
   ```
   Take the first result's `id` as the parent page.

2. Create a Confluence page named `{BDP-N} Plan` under Plans using `mcp__atlassian__createConfluencePage`.

3. Add a Jira comment on the Epic with the Confluence URL.

Tell the user: "Plan uploaded. Run `/bytedesk-architect review {BDP-N}` to get it reviewed before implementation."

---

## Brainstorm Phase — `start <description>` (new feature, no existing Epic)

### Step 1 — Gather context

If the user provided a Jira ticket number, fetch the issue first — it may already answer most scope questions. Search Confluence for any design notes on the area.

If starting from scratch, use `AskUserQuestion` to resolve any of these that aren't clear from the description:

| Question | Why it matters |
|---|---|
| What can a user DO after this ships that they can't do now? | Defines the outside-in acceptance test |
| Which service(s) does this touch? (sales/tools/ai/gateway/web) | Scopes the code research |
| Does it need new DB tables or columns? | Triggers migration planning |
| Is any operation long-running (>2s)? | Signals Tool Action Pattern needed |
| Does any data need to update live? | Signals ByteDesk.Realtime/SignalR wiring needed |
| Is there a similar existing feature to pattern-match against? | Guides code search |

Infer what you can from the description — only ask what's genuinely unclear.

### Step 2 — Research the codebase

```bash
# Find similar patterns in the target service area
grep -rn "<keyword>" src --include="*.cs" -l | head -10

# Check existing pages and components for the domain
find src/ByteDesk.Web/src/app/\(app\) -name "page.tsx" | sort
find src/ByteDesk.Web/src/components/<domain> -name "*.tsx" 2>/dev/null | sort

# Check for relevant ADRs
ls docs/architecture/adr/ | grep -i <keyword>

# Search Jira for related or completed work
# JQL: project = BDP AND text ~ "<keyword>" ORDER BY updated DESC
```

Understanding what already exists prevents duplicating patterns and reveals integration points early.

### Step 3 — Write the feature brief

Produce a concise brief that makes the implementation plan concrete:

```
## Feature: <name>

**Acceptance test:** <one sentence — what a user can do; this is the integration test target>

**Backend scope:**
- New: <service methods, endpoints, consumers — name them>
- Modified: <existing files that change>
- Schema: <new tables/columns, or "none">
- Async: <Tool Action Pattern needed? reason>

**Frontend scope:**
- New: <routes/pages/components — name them>
- Modified: <existing components/hooks that change>
- Realtime: <live updates needed? which data/topics?>

**TDD sequence** (ordered RED-GREEN cycles for backend):
1. `{ClassName}Tests` → `{Method}_Should{Behavior}_{WhenCondition}`
2. ...

**First failing test:**
`tests/ByteDesk.{Service}.Tests/Unit/{ClassName}Tests.cs`
→ `{Method}_ShouldBehavior_WhenCondition`

**Hidden complexity / open questions:**
- <anything that seemed simple but has surprising depth>
- <anything that needs user decision before proceeding>
```

The hidden complexity section matters — flag things like: "adding a column requires migration + data backfill + updated DTOs + frontend type changes" or "this crosses service boundaries, needs `inter-service.md` review."

### Step 4 — Get sign-off, then kick off

Share the feature brief. If the user confirms (or refines it), call `/bytedesk-feature-start <description>` — that handles Jira lookup/create → transition In Progress → branch → TDD scaffold → kickoff summary.

If the brief reveals more scope than expected (multiple services, schema changes, realtime wiring, and full-stack UI), suggest splitting into Jira subtasks before starting.

After `/bytedesk-feature-start` completes, add the feature brief as a Jira comment so it's preserved alongside the ticket.
