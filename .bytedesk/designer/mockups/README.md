# ByteDesk Task Management — governed goal-planner mockup

Status: **exploration; not approved and not production source**
Date: 2026-09-02
Scope: Task Management `/plans` goal-planning extension

This package develops a bounded planning workspace inside the existing Plans information architecture. It keeps the manual repo-path/paste import, makes the operator-selected ACP coding agent and capability health visible, streams read/tool activity through AG-UI, and turns every proposed board mutation into an inspectable approval card. It is deliberately not a general chat surface.

## Authority and implementation read

Design authority was applied in this order:

1. `.context/design-system/DESIGN.md`
2. `.context/design-system/profiles/task-management/{PRODUCT,DESIGN}.md`
3. repository-local `DESIGN.md` — absent in this worktree, so no local exception was applied

The vendored payload copies at `design-system/payload/profiles/task-management/{PRODUCT,DESIGN}.md` were read and verified byte-identical to the managed `.context` copies (PRODUCT SHA-256 `3195557613a138311ffb6e7afef5f6f3a3059f8e1235a6f25f264db1ed5ef252`; DESIGN SHA-256 `0143a043cc3474f0748ab50fdd19f40b654efe9c54adb6c115857a6ecfc4af98`).

The current implementation read comprised `Plans.tsx`, `ImportGoal.tsx`, `PlanPreview.tsx`, their plan/detail/token styles, and the surrounding rail → command bar → canvas → inspector shell. The mockup therefore preserves:

- Plans as a secondary Task Management route, not a new top-level chat product;
- the captured-plan inbox and preview affordance;
- manual import from a repo-relative path or pasted goal doc, with active-epic selection;
- the store’s own verbatim refusal and result language;
- the standard rail, command bar, canvas, right inspector, phone bottom navigation, status vocabulary, density, and light/dark parity.

`bytedesk.tokens.css` is an exact local copy of the managed family CSS so the standalone artifact loads only files in this directory. `planner.tokens.css` contains the mockup’s `--gp-*` semantic aliases; component CSS consumes those roles.

## Chosen direction

Three native image-generated probes explored the profile motif—one identical claimed plate among resting plates—without rasterizing UI:

| Direction | Composition idea | Decision |
|---|---|---|
| Claim Ledger | Orthographic field with one centrally lifted plate | Clear motif, but too hero-centric for a planning workflow |
| Decision Rail | Two ordered lanes meeting at a permission seam | Strong handoff metaphor, but implies a linear pipeline |
| Inspection Bay | Ordered plate field with one matching plate extracted into a quiet margin | **Chosen**: maps directly to canvas + lifted inspector and inspect-before-approve behavior |

The developed HTML carries Inspection Bay structurally: the planning canvas remains flat and ordered; the bridge/agent trace occupies a lifted inspection margin; within a mutation set exactly one focused proposal carries the blue claimed edge-light. Status colors never replace words.

## Image-generation provenance

- Tool: native Codex `image_gen.imagegen` built-in tool, one call per direction.
- Mode: generate; use-case taxonomy `stylized-concept`.
- Model: not exposed by the built-in tool.
- Outputs: three 1672 × 941 PNGs, preserved without local raster generation or edits.
- Prompts and per-output metadata: `prompts/01-claim-ledger.md`, `prompts/02-decision-rail.md`, `prompts/03-inspection-bay.md`, and `prompts/generation-manifest.json`.
- Constraints: no logos, words, controls, metrics, functional icons, fake data, or rasterized UI; exactly one lit object; generated pixels are exploration and never a color/token source.

The four `chosen-direction-*.png` files are Playwright review captures of `goal-planner.html`, not image-generated UI. This pairing follows the foundation rule: generated raster explores material/composition; the real HTML/CSS artifact defines the interface. Capture provenance and hashes are in `capture-manifest.json`.

## AG-UI / ACP interaction model

```text
Dashboard goal-planner UI
  │  AG-UI RunAgent input + typed event stream
  ▼
Backend bridge
  │  validates bounded scope, correlates runs, redacts, normalizes,
  │  holds permission responders, and exposes health
  ▼
Operator-selected trusted coding agent over ACP
  │  governed task-management skills/tools supplied to this session
  ▼
Existing Task Management store functions and gates
```

The browser never launches an agent, holds ACP credentials, or calls ACP directly. The bridge is the ACP client. It can drive Codex, Kimi Code, Claude Code through an ACP adapter, or another configured trusted coding agent; Task Management does not depend on the Claude Agent SDK.

The UI does not treat all agent output as chat:

- ACP elicitation becomes a numbered, evidence-backed decision form.
- Read and tool lifecycle updates become AG-UI run/step/tool events in the trace.
- Agent text is routed into a named bounded slot such as question context, evidence summary, proposal consequence, refusal, or result.
- ACP permission becomes a focused confirmation over the exact mutation set.
- Store writes become cards containing tool/skill, complete parameters, affected entities, dependency order, consequence, validation, and permission scope.
- Private chain-of-thought is not rendered.

See `state-matrix.md` for the complete event and permission mapping, including cancellation, unknown ACP update variants, offline behavior, and manual import.

## Interactive mockup

Open `goal-planner.html` directly in a browser. It has no external runtime, font, image, or network dependency.

Prototype controls at the top select every required scenario. `[` and `]` cycle scenarios when focus is not in a field. The theme button switches dark/light. Query parameters support deterministic review:

```text
goal-planner.html?state=proposed&theme=dark
goal-planner.html?state=streaming&theme=light
goal-planner.html?state=questioning&theme=dark&capture=1
```

`capture=1` hides only the prototype control bar. Product geometry and behavior are unchanged.

Implemented demonstrations:

- **Empty:** bounded outcome intake and manual-import escape hatch.
- **Questioning:** structured choices with repository evidence; decisions remain the operator’s.
- **Attachment upload:** clickable file input and drag/drop, reviewed file list, “session context · not board evidence” distinction.
- **Agent selection / health:** selectable trusted ACP agent, connection/capability/write-policy health, blocking absence of general-chat capability.
- **AG-UI streaming / tool calls:** run, step, read tool, governed skill, queued validation, cancellation and event trace.
- **Proposed skill actions:** five mutations grouped into inspectable tool cards with arguments and consequences.
- **Confirmation:** native modal, ACP permission id, allow-once consequence, review checkbox and focus containment.
- **Validation failure:** exact store-style refusal, no implied partial success, revise/retry paths.
- **Import success:** linked epic/task result list and recorded goal path.
- **Offline:** local draft retention, no fabricated permission, replay distinction, retry/manual path.
- **Unavailable agent:** ACP initialization failure, switch-agent and manual-import recovery.
- **Manual import:** unchanged path/paste modes and active-epic selector, reachable from the persistent page header and recovery states.

The prototype fixture ids and timestamps demonstrate layout/state only; they are not product metrics or claims about a live board.

## Accessibility

- WCAG 2.2 AA is the implementation target; dark and light use the same semantic token roles and identical geometry.
- Native buttons, selects, inputs, textareas, file input and dialogs are keyboard operable. Visible `:focus-visible` treatment uses the family focus token.
- Scenario changes, attachment results, health checks, import results and navigation simulations announce through a polite live region.
- Status is always dot plus word. Agent connection, skill health, permission, proposal, refusal and import state are never color-only.
- The confirmation uses a native `<dialog>`, a labelled heading, a consequence sentence, an explicit review checkbox, and returns the user to a review state on cancel.
- The right trace heading can receive programmatic focus. On phone, Trace is an explicit full-screen sheet with close/focus return.
- `prefers-reduced-motion: reduce` removes transitions and informational pulse shadows without removing state.
- Touch controls use the family 44px target below 720px. Long paths/ids wrap; no horizontal page scrolling is required.
- This design pass includes structural/interaction checks, not a complete screen-reader, contrast, 200% zoom, or assistive-technology certification; those remain adoption gates.

## Responsive and theme behavior

| Width | Layout |
|---|---|
| 1440 | Compact icon rail, command bar, full planning canvas, 344px lifted bridge inspector. Dark/light captures use identical bounding geometry. |
| 1024 | Compact rail, flexible canvas, 304px inspector; agent health wraps below the selector and dense proposal/detail grids simplify. |
| 390 | Full-width canvas, five-item bottom navigation, 44px controls, stacked decisions/actions; bridge trace becomes a full-screen sheet. Manual import and confirmation become full-screen native dialogs. |

Light and dark change only semantic colors, material/shadow and highlight values. State, information architecture, component visibility, ordering, spacing and behavior remain the same. Dark uses balanced family richness; light ignores richness.

## Exact file index

| File | Role |
|---|---|
| `_capability-probe.png` | Pre-existing capability probe; preserved byte-for-byte (SHA-256 `1c36bb944ad4c1e3a44f6797e5da023bc4f01c3d697dfacd23a710dd542e059a`) |
| `README.md` | Package rationale, provenance, architecture, accessibility, responsive behavior and index |
| `bytedesk.tokens.css` | Exact local copy of managed ByteDesk CSS tokens for standalone use |
| `planner.tokens.css` | Goal-planner semantic roles mapped to family tokens |
| `goal-planner.html` | Standalone interactive artifact and semantic shell/dialog markup |
| `goal-planner.css` | Responsive component/layout styling using `--gp-*` roles |
| `goal-planner.js` | Scenario state machine and accessible interactions |
| `direction-01-claim-ledger.png` | Native image-generated direction probe 1 |
| `direction-02-decision-rail.png` | Native image-generated direction probe 2 |
| `direction-03-inspection-bay.png` | Native image-generated chosen direction probe |
| `chosen-direction-1440-dark.png` | 1440 × 1000 dark proposed-mutations HTML capture |
| `chosen-direction-1440-light.png` | 1440 × 1000 light proposed-mutations parity capture |
| `chosen-direction-1024.png` | 1024 × 900 dark streaming/tool-call HTML capture |
| `chosen-direction-390-mobile.png` | 390 × 844 dark questioning mobile HTML capture |
| `capture-manifest.json` | Browser capture version, viewport/state/theme and SHA-256 metadata |
| `profile-amendment.md` | Precise proposed PRODUCT/DESIGN language for bounded planning |
| `state-matrix.md` | ACP/permission → bridge → AG-UI → visible-state contract |
| `prompts/01-claim-ledger.md` | Verbatim native image prompt and metadata |
| `prompts/02-decision-rail.md` | Verbatim native image prompt and metadata |
| `prompts/03-inspection-bay.md` | Verbatim native image prompt and metadata |
| `prompts/generation-manifest.json` | Generated-output dimensions, selection and checksums |

## Verification performed

- JavaScript syntax: `node --check goal-planner.js` — passed.
- Automated headless interaction pass: all 11 scenarios rendered; empty → decisions → attachment → streaming → proposal → permission → success passed; manual path/paste import passed; mobile trace open/close passed; dark/light planner-layout bounding geometry matched; browser console/page errors: 0.
- Playwright captures produced and visually inspected at 1440 dark, 1440 light, 1024 and 390.
- PNG dimensions and all generated/captured SHA-256 hashes recorded in the two manifests.
- Every `--bd-*` reference in `planner.tokens.css` resolves in local `bytedesk.tokens.css`.
- No literal hex/rgb/hsl/oklch color appears in `goal-planner.css` or `planner.tokens.css`; foundation values remain in the copied canonical token file.
- HTML references only local CSS/JS and inline Lucide-compatible paths; no external resources.
- Managed PRODUCT/DESIGN payload copies were byte-identical to `.context` authority.
- Git status review showed all new files under `.bytedesk/designer/mockups/**`; `_capability-probe.png` retained its original checksum.

## Unresolved risks

- ACP v2 is evolving and its update stream is not inherently AG-UI-run-scoped. The bridge needs a pinned/negotiated schema, explicit correlation, forward-compatible unknown-update handling, and versioned runtime validation for the proposed `tm.*` custom events.
- The exact trusted-agent registry, process supervision, authentication and ACP adapter commands are architecture work, not defined by this mockup. No Claude Agent SDK dependency is permitted.
- “Allow always” / “reject always” ACP options need policy ownership and a stronger persistence confirmation before exposure; the mockup intentionally defaults to allow-once.
- Full WCAG contrast, 200% zoom, screen-reader and mobile assistive-technology audits remain required before adoption.
- IBM Plex fonts are named by the token system but not bundled; the standalone file uses the canonical system fallbacks when Plex is unavailable.
- Image-generation model identity is unavailable from the native tool and is recorded as such rather than guessed.
