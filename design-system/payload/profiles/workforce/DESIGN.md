# Workforce design profile

The product name is **Workforce**. Use **Workforce by ByteDesk** when a ByteDesk endorsement helps the reader. Workforce is a standalone product. This profile must not assume or import `bytedesk-platform` runtime, component, or release dependencies.

**Status:** v0.4 — approved constraints and prototype brief for redesigning public-entry flows, including sign-in, and the application shell. Production architecture remains unapproved until the designated reviewer selects a prototype.

These rules are tool- and provider-independent. Every human or automated contributor must follow the same source order, tokens, accessibility rules, protected contracts, and review gates.

This contract supersedes the v0.3 zero-visual-change and TBD clauses. It authorizes prototype exploration and a complete visual and shell-structure overhaul. Production UI remains unchanged until the designated reviewer selects both a public-entry direction and a shell direction. Final information architecture, persistence rules, exact shell widths, breakpoints, and winning variants remain pending.

## Purpose

Workforce is the control plane for an AI company. Its primary reader and user is a human operator who scans company state, finds work that needs attention, and takes governed action.

Every screen should answer, in this order:

1. What is happening?
2. Does it need me?
3. What can I do next?

The design direction is a **quiet command center**: calm, structured, information-rich, and operational. Useful density is welcome. Navigation noise, repeated headings, weak contrast, and decoration without meaning are not.

## Approved design brief

Scores use 0 for the least and 10 for the most.

- **Artifact:** responsive public-entry flows, including sign-in, and application-shell interfaces.
- **Audience:** operators managing one or more AI companies, plus first-time operators, invited members, and instance administrators.
- **Mode:** redesign overhaul. Introduce a stronger visual and navigation language while preserving the product, routes, data, and behavior contracts named below.
- **Visual language:** restrained operational control room with precise alignment, compact controls, and clear operational hierarchy.
- **Layout variation:** 6/10. Use controlled composition changes around a stable navigation and content spine.
- **Motion intensity:** 3/10. Motion explains feedback, state, and hierarchy; it does not decorate routine navigation.
- **Information density:** 8/10. Preserve useful operational detail and improve grouping, scanning, and progressive disclosure.
- **Decorative-asset use:** 3/10. Structure, type, data, and approved product identity carry the interface.
- **Brand adherence:** 7/10. Preserve approved identity, type, themes, status meanings, and voice while the shell architecture evolves.

These scores guide exploration. They are not literal token values or user-facing settings. High density does not permit essential microtext or undersized controls.

## Source and token contract

Read design authority in this order:

1. the shared ByteDesk foundation in `../../DESIGN.md`;
2. this Workforce profile;
3. the consumer repository's root `DESIGN.md` adapter.

The shared family values come from `../../tokens/css/bytedesk.css` and `../../tokens/tailwind/theme.css`. Workforce's single implementation token root remains `ui/src/index.css` in the consumer repository. It maps or vendors the exact reviewed family values and contains Workforce semantic, status, chart, agent-gradient, and domain tokens.

- Components and pages must not invent colors, spacing, radii, type sizes, shadows, or motion values.
- Do not use hex values, raw pixel values, arbitrary Tailwind bracket values, raw `font-size` declarations, or palette classes as shortcuts in redesigned components.
- If a required value is missing, review it before use. Add shared values to the ByteDesk design system first. Add only Workforce-specific semantic aliases to `ui/src/index.css`.
- Runtime-tunable theme values must not be baked into `@theme inline`.
- Run `corepack pnpm check:token-gates` in Workforce before handoff. Corepack uses the repository-pinned package-manager version consistently on Windows, macOS, and Linux.

### Workforce runtime-theme exception

Workforce implements the shared dark/light semantic contract through its existing
`generateTheme` boundary and may retain instance and company themes as governed
extensions. Tenant themes must not change the values or semantic roles of status,
chart, agent-gradient, interaction, or product-accent tokens, and must preserve exact
dark/light component geometry.

## Visual system

### Identity and color

- Use the cataloged Workforce product icon. There is no approved Workforce wordmark, alternate mark, illustration system, or custom navigation-icon set.
- Set `data-bd-product="workforce"` so `--bd-accent` resolves to `--bd-product-workforce`, the shared Workforce violet. Use it for product identity, not as a replacement for semantic interaction or status colors.
- Use `--bd-interactive-blue` for focus and interactive affordances.
- In the default Workforce theme, violet identifies the product and blue identifies interaction. Violet is not an action or status color, and liveness remains blue.
- An approved instance or company theme may replace default semantic action and focus roles, including `--primary` and `--ring`, only through `generateTheme`. Existing approved identity and radius inputs remain supported.
- Status, chart, and agent-gradient tokens remain stable across tenant themes.
- Status always includes a label, icon, pattern, or position. Color alone is never enough.
- ByteDesk orange is a family brand color, not a general Workforce action color.
- Do not create, redraw, recolor, or generate an identity-critical mark inside the consumer repository.

### Type

- Use IBM Plex Sans for interface text.
- Use IBM Plex Mono for IDs, costs, token counts, timestamps, logs, and other machine values.
- Use the approved Plex-compensated type ladder already present in Workforce.
- Use named text styles. Do not create page-specific sizes.
- Improve legibility through contrast, line height, hierarchy, and line length before making every element larger.

### Spacing and density

- Use a 4px base and an 8px primary rhythm.
- Route spacing through a small token scale and semantic aliases for inset, stack, cluster, section, and page spacing.
- Use one gap value for a vertical group. Do not combine sibling margins with a parent gap.
- Dense screens must earn their density with useful information, clear grouping, and predictable alignment.
- Sparse states should not inherit heavy chrome merely to fill space.

### Radius and elevation

- Keep the shared radius ladder: 4px, 6px, 8px, 12px, 16px, and full. The 8px value is the anchor.
- Preserve the existing tenant radius input as a profile-scoped runtime exception. It may retune local semantic component radii through `generateTheme`; it does not create or change shared family tokens.
- Keep static surfaces mostly flat.
- Use no more than three named elevation levels.
- Use shadow only to explain elevation, such as an overlay, floating panel, drag state, or carefully reviewed interactive lift.
- Keep borders quieter than content and focus indicators stronger than borders.

### Motion

- Use the shared 150ms, 250ms, and 400ms duration tokens with `--bd-ease-out-expo`.
- Prefer 150–250ms for ordinary shell feedback. Reserve 400ms for a larger transition that remains interruptible.
- Animate transform and opacity when possible. Avoid navigation-time layout shifts.
- Honor reduced motion; the shared duration tokens resolve to zero when the user requests it.

## Component and content rules

- Use one component per job. Extend a shared component with a reviewed variant before creating a parallel version.
- Use **task** in user-facing copy, not issue or ticket. Keep existing issue names in code, routes, and canonical API identifiers until a separately reviewed migration changes them.
- Buttons name the action, such as **Approve hire**, not **Submit**.
- Errors explain what happened and what the user can do next without exposing sensitive information.
- Empty states explain the useful first action.
- Put human-readable intent and outcomes before raw logs or transcripts.

## Application-shell contract

The final shell architecture will be selected through prototypes. Regardless of the winning composition, the shipped shell must:

- keep one stable global structure across primary routes;
- keep **Create task** globally available;
- make attention counts visible without requiring hover;
- show the active company and its state, the current top-level area, and the current page;
- use one page-header pattern and one top-level heading;
- let workflow pages and spatial views, such as boards, use the full remaining canvas;
- use at most one optional details panel rather than creating another permanent navigation column;
- define desktop and mobile navigation from one typed registry that filters destinations by permission and feature availability;
- derive agent, project, and plugin destinations from registered product data rather than a hardcoded list;
- preserve existing routes during the first implementation;
- give unfamiliar icons visible labels or reliable accessible names; tooltips do not replace labels;
- avoid route-controlled collapse or resize changes that override the user's shell preferences.

Global navigation, contextual navigation, and content remain distinct information roles. A literal rail is not required; only the Layered command rail candidate uses one. Every prototype must use the same functional destinations, content, and state coverage so the comparison tests architecture rather than missing features.

The first shell prototype round must compare three distinct models:

1. **Layered command rail:** labeled global rail, contextual navigation, fluid canvas, and optional details panel.
2. **Adaptive sidebar:** one user-controlled sidebar with grouped, progressively disclosed destinations.
3. **Canvas-first command bar:** persistent top command bar with contextual navigation opened on demand.

These are exploration directions, not approved production architecture. The designated reviewer selects a direction after reviewing the working variants.

## Public-entry contract

Sign-in, sign-up, OAuth consent and error, board claim, command-line authentication, invite acceptance, bootstrap pending, no-company-access, loading, and error states use one public-entry shell. The content panel may change; product and instance identity remain stable.

- Use clear, persistent field labels and correct autocomplete values.
- Primary form actions must have a target at least 44 by 44 CSS pixels.
- Support password managers, password visibility, detectable Caps Lock state, inline validation, and an error summary.
- Allow paste into authentication fields. Do not require an unsupported memory, transcription, or cognitive test.
- Keep the entered email after a failed sign-in.
- Prevent duplicate submission and show specific progress, such as **Signing in…**.
- Use one safe invalid-credentials message that does not reveal whether an account exists.
- Show **Create account** only when the unauthenticated server response explicitly says registration is allowed.
- Return the user to the requested route after sign-in, including Model Context Protocol authorization continuations.
- Before company selection, use the instance theme. Use a company theme only when the server has validated company context for that public request.
- Apply the server-selected theme before the page first renders. Do not reuse a previously selected company's theme on an unrelated public route.
- Local-trusted mode continues to bypass human login.
- On narrow or short screens, supporting identity content must not precede, displace, or obscure the authentication task.

The first public-entry prototype round must compare three distinct models:

1. **Focused panel:** one strong, centered authentication panel with minimal supporting copy.
2. **Two-region identity:** restrained product-identity region beside the authentication panel.
3. **Contextual public gateway:** compact identity frame with a route-specific panel for sign-in, invitation, consent, claim, and other public workflows.

Do not imply access to customer data before sign-in. Do not fabricate dashboard metrics or controls as decoration.

## Responsive and accessibility contract

The shipped public-entry flows and shell must meet WCAG 2.2 AA.

- Every destination and action works with a keyboard.
- Focus is visible, restored after overlays close, and never hidden behind a panel.
- Drawers and sheets trap focus, close with Escape, and make background content inert.
- Navigation landmarks have unique accessible names. Current page and expanded state are exposed programmatically.
- Use targets at least 44 by 44 CSS pixels for primary and touch actions. Any smaller target must be at least 24 by 24 CSS pixels or have enough spacing to meet WCAG 2.2 Success Criterion 2.5.8.
- Text and essential boundaries meet required contrast.
- Normal text must meet 4.5:1 contrast and large text 3:1. Essential controls, input boundaries, icons, focus indicators, and state indicators must meet 3:1 against adjacent colors. A quiet border may be lower contrast only when it conveys no required boundary or state.
- Operational state never depends on color alone.
- The interface reflows at 200% zoom and remains usable at 400% zoom, except for inherently spatial content that also provides an equivalent list or table.
- Mobile layouts respect safe areas, virtual keyboards, screen-reader order, and translated labels.
- Controls translated off-screen must not remain in the tab order.
- At each breakpoint, expose only one navigation implementation to focus and assistive technology.
- On mobile, use five area items: Home, Attention, Work, Team, and More. Keep **Create task** visible outside More and one action away.
- Every drag-based resize or reorder action must also have keyboard and click or tap controls that do not require dragging.
- Authentication must support password managers and paste without blocking accessible authentication tools.

Test these viewport sizes in CSS pixels:

- 1,248 by 838;
- 1,280 by 720;
- 1,440 by 900;
- 1,024 by 768;
- 390 by 844;
- 360 by 640;
- 320-pixel reflow.

Also test 200% and 400% zoom, one representative long translated label, WCAG text-spacing overrides, autofill, safe areas, and virtual-keyboard visibility.

Review the default theme in light and dark modes and one valid customer theme near the supported contrast limits in light and dark modes.

## Protected contracts

The public-entry and shell redesigns must not change any item below unless a separate reviewed task explicitly authorizes it:

- company-prefixed routes, deep links, or requested-route return;
- sign-in, conditional sign-up, invitation, OAuth, claim, command-line authentication, bootstrap, denied-access, local-trusted, or MCP continuation behavior;
- company switching, permissions, feature gates, or canonical API identifiers;
- the server-selected theme applied before the first render, public branding, white-label behavior, or the approved theme generator;
- status meanings, chart meanings, or agent-gradient identities;
- plugin routes, launcher behavior, and the destinations currently exposed through legacy route sidebars; their current layout is not protected;
- skip links, main-content focus, keyboard shortcuts, navigation scroll memory, or useful user-controlled panel state;
- analytics hooks, test selectors, accessibility semantics, or persistent-state keys;
- current page content beyond the shell frame unless a later reviewed task explicitly includes it.

Two reviewed prerequisites may extend these contracts without authorizing unrelated redesign: a public response may expose only whether registration is allowed, and profile navigation must use the canonical API identifier rather than an invented display-name or email slug.

## Prototype and asset workflow

- Load `.agents/skills/web-design-engineer/SKILL.md`, `.agents/skills/prototype/SKILL.md`, and `.agents/skills/prototype/PICKER.md` from the exact reviewed design-system revision. Do not rely on automatic discovery.
- Run public-entry and shell exploration separately. Each run contains three genuinely different, working variants behind the standard picker.
- Keep prototypes isolated from production imports. Do not change production UI until the user chooses a variant.
- Build interface structure, controls, copy, navigation, states, and functional icons in React, HTML, and CSS with Workforce tokens. A generated screenshot is not implementation source.
- Generated raster art may explore an abstract login visual, moodboard, identity board, or non-critical texture after a direction needs it. It must not contain logos, product copy, fake controls, invented metrics, functional icons, or rasterized shell UI.
- Keep generated drafts and prompts in the design worktree with tool, model, date, references, and ownership.
- Land approved production assets in `ByteDeskAI/design-system` with catalog provenance and checksums before Workforce adopts them.
- Add motion only after the static direction is approved. Review motion and reduced-motion behavior before handoff.

## Enforcement

Before a production handoff in Workforce, run the smallest relevant checks first, then the full release checks when the change is ready:

```sh
corepack pnpm check:token-gates
corepack pnpm typecheck
corepack pnpm test:run
corepack pnpm build
```

Use Storybook and targeted browser suites for the routes and states affected by the selected design. Record intentional visual changes; do not hide them inside a mechanical refactor.

Historical token-audit decisions and prior art remain in `ByteDeskAI/design-system` under `artifacts/workforce/design-system/`. They explain how the current token and type systems were reached; this v0.4 profile supersedes their earlier no-redesign scope.
