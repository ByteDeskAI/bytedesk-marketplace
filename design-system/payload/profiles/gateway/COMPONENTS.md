# Gateway cross-platform component contract

This document defines the minimum anatomy, states, sizes, and behavior of Gateway
components. It is renderer-neutral: React, Tauri/WebView, Slint, egui, or another native
toolkit may implement the component, but the contract remains the same.

Use canonical tokens from `tokens/bytedesk.tokens.json`. Component-local adapters may
rename tokens; they may not restate visual literals.

## 1. Shared state model

Every interactive component supports the states that apply to it:

| State | Required treatment |
|---|---|
| Rest | normal border, surface, label, and icon |
| Hover | tonal change only; no layout shift |
| Pressed | immediate pressed feedback; at most 1 logical unit translation |
| Focus-visible | 2-unit focus ring using `color.interactive.focus`; never removed |
| Selected | accent/desk treatment plus a non-color indicator |
| Disabled | no activation; `opacity.disabled`; reason available when useful |
| Busy | retains label; adds progress; prevents duplicate execution |
| Invalid | danger text and border with a specific correction |
| Stale | warning state plus age |
| Disconnected | explicit word and reconnect/retry affordance where possible |

Focus and selected are independent. A selected row may also be focused.

## 2. Size vocabulary

| Size | Height | Typical use |
|---|---:|---|
| Compact | 28 | dense pointer console |
| Default | 32 | forms and mixed layouts |
| Touch | 44 | coarse pointer and compact PWA |

Icons use 14, 16, 20, or 24 units. Use a 16-unit icon in a compact/default control and a
20-unit icon in a touch control unless the icon is the product mark.

## 3. Button

### Anatomy

- optional leading icon;
- label;
- optional trailing shortcut, count, or disclosure;
- busy indicator replaces neither the label nor consequence.

### Variants

- **Primary** — one primary action per decision region.
- **Secondary** — normal commands.
- **Ghost** — low-priority chrome actions.
- **Danger** — destructive action or confirm step only.
- **Brand** — Store entitlement/purchase or ByteDesk brand moment; never normal console
  navigation.
- **Icon** — requires accessible name and tooltip unless the surrounding label makes the
  purpose unambiguous.

### Behavior

- Primary text uses `color.accent.fg`, not pure white.
- Destructive actions enter an inline confirm state that repeats the resource and
  consequence.
- Busy buttons do not resize.
- Repeated actions expose completion or failure outside hover.

## 4. Field, select, and text area

### Anatomy

- persistent label;
- optional description;
- control well;
- optional prefix/suffix;
- validation or help line.

Placeholder text is an example, not a label. Machine values, paths, IDs, tokens, and
commands use the mono family. Secret fields reveal only through an explicit action and
retain a visible **Shown once** or **Sensitive** label when applicable.

Validation mirrors server rules and never replaces them. Errors state what is wrong and
how to correct it.

## 5. Checkbox, radio, switch, and segmented control

- Checkbox: independent boolean selection.
- Radio: one selection in a visible set.
- Switch: immediate setting with a clear on/off consequence.
- Segmented control: compact view or mode choice; not a substitute for primary
  navigation.

The text label is clickable/tappable. Indeterminate checkboxes have a distinct glyph and
accessible state.

## 6. Tabs

Tabs represent peer views of the same context. They support arrow-key movement,
Home/End, and visible selected state.

- Persistent terminal or project tabs may scroll horizontally.
- Close, pin, attention, recording, and dirty indicators occupy stable positions.
- A selected tab and its associated pane update together.
- Closing an active tab selects the nearest viable tab predictably.
- A tab does not become a generic action menu; use a menu trigger beside it.

## 7. Navigation item

An item contains icon, label, optional count/attention badge, and optional plugin
provenance. Active treatment combines desk tint, label weight, and a geometric marker.
Disabled and unavailable are distinct:

- **Disabled** — present but temporarily unusable; include reason.
- **Unavailable** — capability not installed, licensed, or supported; route to the
  relevant explanation/Store action when permitted.

## 8. Status chip

A status chip contains:

- 6-unit dot or status glyph;
- status word;
- optional concise qualifier or relative time.

Do not render a bare colored dot. Use semantic colors only for actual status. Product
and provider accents identify identity, not health.

## 9. Banner

Banners span their containing region with a full 1-unit border.

Variants: info, success, warning, danger, and neutral.

Anatomy:

- status icon;
- short title;
- one or two lines of explanation;
- optional primary and secondary action;
- dismiss control only when the state is safe to hide.

Security limitations, guest jail boundaries, degraded operation, stale data, and
failed cutovers are not dismissible by default.

## 10. Toast and notification

A toast reports transient completion or failure and links to durable detail when
available. It never carries the only copy of an approval, security warning, transfer
failure, or destructive outcome.

Desktop native notifications and browser notifications map to the same notification
record and action identifiers as the in-app notification center.

## 11. Table and data grid

Tables are dense and operational.

- header remains visible when practical;
- rows are 28 units on pointer clients and 44 on touch clients;
- text aligns left, numerics right, state consistently;
- machine values use mono;
- row selection is independent from row action menus;
- sorting communicates direction and priority;
- loading retains column structure;
- empty state is one useful sentence and an action where appropriate;
- horizontal overflow does not compress values into unreadability.

Virtualization may be used but must preserve keyboard focus and screen-reader position.

## 12. Tree

Trees are used for files, projects, worktrees, and hierarchical resources.

- disclosure and selection are separate targets;
- left/right arrows collapse/expand; up/down moves;
- current path remains discoverable;
- loading children does not collapse the parent;
- drag and drop has cut/copy/move commands as alternatives;
- grant or jail boundaries are labeled in the tree, not implied by missing siblings.

## 13. List row

A row contains a primary label, optional secondary value, status, and trailing actions.
Trailing actions appear on focus as well as hover. A row may navigate or select, but it
must not do both ambiguously.

## 14. Command bar and toolbar

Group commands by consequence:

1. primary operation;
2. view and filter controls;
3. selection operations;
4. overflow.

Toolbars use separators sparingly. Icon-only commands require accessible names and
tooltips. Disabled commands expose the reason when it is not obvious.

## 15. Menu and context menu

Menus contain commands, choices, or navigation—not form layouts. They support arrow
keys, typeahead where useful, and `Escape`. A destructive command is visually distinct
and never the default focused item.

Native context menus may be used in desktop clients when they preserve the same command
identifiers and authorization.

## 16. Dialog, sheet, and popover

- **Dialog** — blocking decision or short focused task.
- **Sheet** — responsive inspector, navigation, or multi-step content on compact widths.
- **Popover** — lightweight contextual controls.

Every transient layer has a title or accessible name, initial focus, contained keyboard
behavior when modal, and a deterministic focus return target. `Escape` closes unless
doing so would silently discard a running operation; in that case provide an explicit
cancel decision.

## 17. Inline confirmation

Kick, ban, revoke, terminate, delete, overwrite, and approval denial use an inline
two-step confirmation by default.

The confirm state includes:

- action and resource;
- consequence and scope;
- expiry/retention where relevant;
- confirm and cancel;
- busy, success, and failure state.

Text-entry confirmation is reserved for irreversible or broad operations, not routine
single-resource actions.

## 18. Empty, loading, error, and permission states

Each workspace region defines all four:

- **Empty** — no data exists; explain how to create or connect it.
- **Loading** — preserve the expected structure; avoid page-wide spinners.
- **Error** — retain known data, explain failure, and offer retry/detail.
- **Permission** — state the missing capability without implying the resource is absent.

## 19. Progress and transfer

Progress is determinate when total work is known and indeterminate otherwise. Transfers
show file/resource, amount, rate where reliable, state, and cancel/retry. Completed
transfers remain available in history long enough to inspect failures.

## 20. Splitter and resizable tile

- pointer target is larger than the visible 1-unit divider;
- keyboard can adjust in meaningful increments;
- current size is exposed accessibly;
- double activation resets to the recommended size;
- dragging never selects embedded surface text or sends terminal input;
- saved layout is clamped to the current viewport on restore.

The active tile uses `stroke.active` plus a label/selection relationship.

## 21. Terminal surface frame

The frame, not the terminal canvas, provides:

- tab/resource title;
- provider/kind;
- connected, stale, view-only, recording, and attention state;
- close, detach, fullscreen, clipboard, and pane actions;
- focus ring and keyboard escape route;
- reconnect/error treatment.

Terminal colors may approximate the design system through xterm configuration, but ANSI
meaning and user shell themes are preserved.

## 22. Remote desktop and screen frame

The frame adds connection, quality, input permission, fullscreen, clipboard, fit/scale,
and reconnect controls. A view-only surface uses a persistent label. Quality changes do
not reset focus or pointer mode.

## 23. Code editor frame

Monaco or a future native editor uses ByteDesk chrome for file identity, dirty state,
save, language, encoding, line ending, branch/worktree, diagnostics, and connection
state. Editor theme values map to canonical background, text, accent, semantic, and
border tokens.

## 24. Agent message

Message anatomy:

- role/provider identity;
- timestamp/run association;
- content;
- optional reasoning disclosure;
- related tool calls and results;
- error or completion state;
- copy and inspect actions.

Streaming content does not cause the composer or transcript controls to jump. Partial
content remains after failure.

## 25. Tool call

A tool call card shows:

- tool name and source;
- argument summary;
- permission/approval requirement;
- running duration;
- success, failure, cancelled, or waiting state;
- concise result and expandable detail;
- audit identity.

Arguments containing secrets are redacted before rendering.

## 26. Approval

An approval card is durable and contains:

- requesting agent/run;
- requested operation;
- target and scope;
- expected consequence;
- expiry;
- approve and deny;
- optional remember/allow policy only when the server supports it;
- final actor and outcome.

Approval buttons use default or danger semantics based on the requested consequence,
not the agent/provider accent.

## 27. Chart

Charts follow [`VISUALIZATIONS.md`](VISUALIZATIONS.md) and use `color.chart.*`,
`stroke.chart`, and `size.chart.*`. Every interactive chart has focusable series/points
or an accompanying table and never encodes meaning through hue alone.

## 28. Platform parity record

Each client maintains a component parity table with:

- component name and version;
- supported states;
- keyboard/touch behavior;
- token adapter version/source checksum;
- accessibility test;
- known platform exception;
- screenshot or test reference.

A platform exception belongs in the client adapter only when it is required by the
operating system or rendering toolkit. Product-specific divergence must be resolved in
this contract.
