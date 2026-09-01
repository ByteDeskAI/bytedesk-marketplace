# Design - ByteDesk Designer Studio

Canonical design profile for the ByteDesk Designer Studio desktop application. Read
after the [shared foundation](../../DESIGN.md). The consumer repository's root
`DESIGN.md` may contain implementation mappings and explicit local exceptions only.

## Product stance

**Creative north star: The Review Bench.** Designer Studio is the desktop workbench
where a person directs specialist agents through discovery, identity, direction,
surface, translation, review, and publication. It must make generated work easy to
inspect without making agent activity look more authoritative than the design source,
review evidence, or the person deciding what ships.

The interface is calm around the work and exact about provenance. The active artifact,
its run-relative path, governing authority revision, agent activity, validation gates,
and review findings remain distinguishable at a glance. The studio never turns design
work into a decorative AI dashboard or implies that an unreviewed output is approved.

Product direction lives in [`PRODUCT.md`](PRODUCT.md).

## Token and runtime contract

- Consume the managed family tokens at `.context/design-system/tokens/`.
- The WebView imports `tokens/css/bytedesk.css` and `tokens/tailwind/theme.css`; Rust
  consumes the generated native adapter at the application theme boundary. Components
  do not restate token values.
- Apply `data-bd-product="designer-studio"`, `data-bd-theme="dark|light"`, and
  `data-bd-richness="soft|balanced|rich"` to the WebView root.
- Designer Studio inherits `product.platform`. Its orange identity accent marks
  product-level selection and decisive handoff; family interaction blue still carries
  focus and live interaction, and semantic colors retain their status meanings.
- Run the design-system sync check and authority doctor before treating the managed
  profile as current.

## Visual language

### Material and composition

Designer Studio inherits Black Glass + Optical Layering as a focused three-column
workbench: project and run context, the active conversation/work surface, and an
inspectable evidence rail. The central work stays on the primary shell plane. Artifact
lightboxes, previews, menus, permission decisions, and review details use raised or
overlay levels because they represent real hierarchy.

The shell is dense but not cramped. Hairlines, alignment, typography, and whitespace
separate ordinary regions; do not wrap every message, output, or finding in another
glass card. The active artifact is the visual center of gravity. Agent chrome and
operational metadata recede until they require action.

### Product personality

- **Accent:** inherited platform orange, used sparingly for product identity, approved
  handoff, and high-value selection. It does not replace interaction blue or status.
- **Signature icon metaphor:** an inspection aperture over a layered surface - a frame
  that makes authorship, comparison, and review visible. Avoid magic wands, sparkles,
  generic chat bubbles, and robot heads.
- **Density:** compact editorial tooling. Controls and rails are efficient; long briefs,
  critique, and rationale retain readable line length and rhythm.
- **Surface calibration:** one materially elevated workbench with inset evidence wells
  and bounded overlays. Generated artifacts may carry their own visual language inside
  the viewer without leaking that language into Studio chrome.
- **Motion temperament:** measured and evidentiary. Short transitions explain stage
  progress, artifact arrival, comparison, preview opening, and finding resolution.
  Nothing pulses or glows merely because an agent is connected.
- **Voice:** direct, calm, and accountable. Name the action, source, state, failure, and
  next decision. Avoid theatrical claims about intelligence or creativity.
- **Domain motif:** layers converging through an inspection aperture - source,
  generated surface, critique, revision, and approval aligned around one selected work.

IBM Plex Sans carries briefs, conversation, critique, and explanations. IBM Plex Mono
carries paths, SHAs, stage identifiers, agent/provider names, timestamps, validation
output, and compact state. Mono is evidence, not decoration.

### Themes and richness

Dark and light preserve the same geometry, information, state, and hierarchy.
`balanced` is the default. `soft` reduces atmospheric contrast for long review sessions;
`rich` deepens the canvas and shell separation for presentation. Richness never changes
artifact color, review severity, focus visibility, or whether evidence is shown.

## Information topology

- Solution, project, run, and governing authority are persistent context, not transient
  chat content.
- The main thread combines direction and progress while keeping tool calls and
  permission requests explicitly typed.
- Outputs, findings, agents, authority, and tool activity are sibling evidence views.
  None may silently replace or reinterpret another.
- Artifact identity is its run-relative path. Basenames are labels only and may collide.
- Preview is a rendering surface for generated HTML, not an approval signal.
- Review happens before publication. A publish action names the reviewed input and
  exposes any unresolved gate.

## Components and states

- Project and run navigation exposes selection, recency, and governing authority without
  conflating them.
- Stage controls present the real ordered arc and distinguish optional, available,
  running, completed, failed, and blocked states.
- Conversation messages distinguish person, agent, reasoning summary, tool call,
  permission request, failure, and durable completion without relying on color alone.
- Artifact cards and thumbnails show the run-relative identity on demand, preserve
  direction/attempt metadata, and open a bounded viewer rather than navigating away.
- Compare mode labels both sides, preserves independent artifact identity, and makes the
  selected side explicit.
- The findings view groups blocking, should-fix, and note severity; it shows gate results,
  review-round trend, linked artifact, rationale, and resolution state.
- The authority view names path, immutable revision, connection state, audit warnings,
  validation result, and any proposed operation before mutation.
- The tool ledger preserves input/output evidence, failure, review state, and file diff.
  Truncation is disclosed.
- Permission prompts state the exact requested action and scope, keep deny available,
  and return focus predictably after resolution.

Design and test empty solution, no projects, no runs, no outputs, no findings, loading,
agent unavailable, authority absent, authority drift, stale managed context, permission
pending, tool failure, preview failure, review blocked, partial stage completion, and
publish failure before polish.

## Responsive behavior

The desktop workbench preserves the active conversation and selected artifact first.
At narrower widths, evidence rails collapse into explicit tabs or overlays before their
content becomes clipped. Long paths, commands, and validation messages wrap or scroll in
their own region. At 200% text, primary actions, permission decisions, stage state, and
review severity remain visible and operable.

## Motion and microinteraction

- New durable outputs may enter with a short opacity/translation transition; streaming
  text does not cause layout theatrics.
- Stage progress and review-round changes animate only when motion clarifies causality.
- Hover and focus strengthen perimeter and top-light. Whole panels do not tilt, chase the
  pointer, or bloom continuously.
- Reduced motion removes spatial travel, animated bloom, and auto-scrolling while
  preserving focus movement, live regions, and state transitions.

## Approval gate

Browser-visible acceptance covers the shell, project/run selection, conversation and
tool states, stage controls, artifact output, lightbox, compare mode, preview, findings,
authority operations, permission prompts, and publication review. Each critical path is
checked in dark and light, all richness modes, keyboard-only operation, reduced motion,
200% text, and representative narrow and wide desktop sizes.

Approval evidence identifies the profile revision, active product scope, fixture/run,
browser surface, and unresolved findings. A screenshot without those inputs is visual
evidence, not approval.

## Accessibility

- Meet WCAG 2.2 AA in both themes and every richness mode.
- Solution selection, project/run navigation, stage execution, permission decisions,
  output inspection, comparison, preview, findings, authority checks, and publication
  review are keyboard operable.
- Focus returns to the invoking control after menus, lightboxes, previews, and permission
  prompts close.
- Streaming activity announces durable transitions rather than every token or tool log
  line. Progress exposes a name, value or indeterminate state, and final result.
- Severity, connection, stage, reviewed, selected, and publishable states use text or
  iconography in addition to color.
- Generated artifacts remain isolated from Studio chrome and cannot reduce application
  contrast or focus visibility.

## Explicit exceptions

- Designer Studio uses an information-dense desktop workbench rather than a conventional
  page or tray-scale shelf.
- Generated artifacts may intentionally use a different product profile inside their
  isolated viewer or preview; Studio chrome always remains scoped to `designer-studio`.

## Bans

No generic AI chat clone, prompt-only interface, floating glass-card grid, KPI dashboard,
fake terminal, decorative agent topology, invented approval, hidden authority drift,
basename-only artifact identity, color-only review severity, or publication before
review. Do not borrow Toolbox identity, density rationale, command-shelf metaphor, or
product accent.

## Generated art

The family contract is [`DESIGN.md` section 10](../../DESIGN.md). Designer Studio's
product motif is **several quiet layers aligned by one precise inspection aperture**.
The aperture is the single lit element; surrounding layers remain matte and subdued.
Use the inherited platform accent as a contained edge-light, never a full background.
The composition must communicate selection and review without drawing literal UI,
controls, copy, metrics, logos, or agent avatars.

