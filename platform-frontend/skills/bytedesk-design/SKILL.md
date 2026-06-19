---
name: bytedesk-design
description: >-
  ByteDesk design system expert and source of frontend design truth. Use for
  ByteDesk UI/UX design work: component critique, token compliance, layout,
  visual hierarchy, atomic composition, micro-interactions, Framer Motion, and
  the Mission Control dark workspace aesthetic. Invoke for design, UI layout,
  component choice, animation patterns, design-system compliance, or requests to
  make a page or component look better.
user-invokable: true
argument-hint: "[component | page | area — what to review or design]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Write
  - Edit
---

## Design Philosophy

ByteDesk's UI is a **dark workspace** — Replit-inspired, data-dense, technically precise. The aesthetic says "professional tool" not "consumer app." Every design decision serves clarity and information density over decoration.

**Four principles:**
1. **Token-first** — every color, shadow, spacing, and motion value comes from `globals.css` CSS variables. Nothing is hardcoded.
2. **Composition over configuration** — prefer atoms assembled thoughtfully over adding more props to a single component.
3. **Data density** — 14px base type, compact spacing, monospace labels. Information per pixel is a feature.
4. **Intentional depth** — 5-level background ramp, border hierarchy, and shadows communicate hierarchy. Use them deliberately.

---

## Atomizer — Required for All UI Implementation

Whenever you are implementing UI (new pages, new components, refactoring existing pages), use the `/bytedesk-atomize` skill to ensure work lands in the correct atomic design layer. Design decisions made here must be reflected in the component hierarchy — atoms in `components/ui/`, molecules in `components/shared/`, organisms in `components/{domain}/`. Don't write inline JSX in pages that belongs in an organism, and don't write organisms that duplicate existing atoms or molecules.

After making changes, invoke `/bytedesk-atomize --path <dir>` where `<dir>` is the **highest-level directory that contains all the files you changed**. Use `git diff --name-only` to find the changed files, then find their common ancestor directory. Examples:

- Changed `src/app/(app)/sales/contacts/page.tsx` and `src/app/(app)/sales/tasks/page.tsx` → `--path src/app/(app)/sales`
- Changed only `src/components/sales/pipelines/opportunity-card.tsx` → `--path src/components/sales/pipelines`
- Changed files across both `src/app/(app)/sales/` and `src/components/sales/` → `--path src/ByteDesk.Web/src` (widest common ancestor)

The path should be specific enough to focus the atomizer on what actually changed — don't pass the entire repo root unless changes truly span the whole frontend.

---

## Step 0: Component Discovery (Required Before Any Implementation)

Before writing a single line of JSX, scan the codebase for existing components that cover — or partially cover — the design need. This step is mandatory. Skipping it and building from scratch is the primary source of duplication in this codebase.

**Discovery order:**

1. **Check the reference catalog first** — read `references/components.md` for documented atoms, molecules, and organisms. If something is already listed, use it.

2. **Search the live component tree** — the catalog may lag behind the code. Run these searches:
   ```bash
   # Atoms (primitives)
   find src/ByteDesk.Web/src/components/ui -name "*.tsx" | sort
   
   # Molecules (domain-agnostic compositions)
   find src/ByteDesk.Web/src/components/shared -name "*.tsx" | sort
   
   # Organisms (domain-specific, check the relevant domain dir)
   find src/ByteDesk.Web/src/components/<domain> -name "*.tsx" | sort
   ```

3. **Grep for patterns** — if you're unsure whether something exists, search by concept:
   ```bash
   grep -r "export function.*<concept>" src/ByteDesk.Web/src/components --include="*.tsx" -l
   ```

**Decision gate — apply before building anything:**

| Situation | Action |
|---|---|
| Existing component fully covers the need | Use it. Zero new code. |
| Existing component is close but missing one prop | Add the prop to the existing component; don't duplicate it. |
| Existing atom/molecule could be composed to cover it | Compose them; don't build a new thing that re-implements what they already do. |
| Nothing relevant exists | Build new — see atomic design rules below. |

State explicitly in your response which components you checked and why they didn't fit before proposing anything new.

---

## Building New Components — Atomic Layer Rules

When discovery confirms nothing exists and a new component is needed, determine its atomic layer **before** writing code. Getting this wrong creates components in the wrong place that break discoverability for future work.

### Layer decision

```
Question 1: Does this component have any domain knowledge 
            (knows about Contacts, Pipelines, Opportunities, etc.)?
  NO  → it's an atom or molecule (belongs in ui/ or shared/)
  YES → it's an organism or page fragment (belongs in components/<domain>/)

Question 2 (for NO above): Does this compose multiple atoms 
            together in a reusable pattern?
  NO  → atom → place in components/ui/<name>.tsx
  YES → molecule → place in components/shared/<name>.tsx

Question 3 (for YES above): Does this represent a self-contained 
            section of a page with its own data-fetching or state?
  NO  → organism → place in components/<domain>/<name>.tsx
  YES → still an organism, but note that data fetching belongs 
        in the page or a custom hook, not the organism itself
```

### Layer rules

**Atoms** (`components/ui/`):
- Single-purpose, no domain imports, no API calls
- Props are generic — `label`, `value`, `variant`, not `contact.name`
- Examples: `Button`, `Badge`, `StatusDot`, `Card`, `Input`

**Molecules** (`components/shared/`):
- Compose 2+ atoms into a reusable pattern
- Domain-agnostic — can appear in any feature area
- Examples: `EmptyState`, `DetailRow`, `StatCard`, `PageHeader`

**Organisms** (`components/<domain>/`):
- Use domain types and domain-specific language
- One organism per logical UI section (a card with its own header + list + footer)
- Pages assemble organisms; they don't contain inline JSX that belongs in one

**Pages** (`app/(app)/<route>/page.tsx`):
- Import and compose organisms; contain no styling logic
- Handle route params, auth checks, and top-level async data
- If you find yourself writing `<div className="flex gap-2">` in a page, stop — extract it

---

## How to Approach a Design Task

### Critiquing existing code

When reviewing a component for design quality, check:

1. **Token violations** — any hardcoded hex, rgb, or oklch value that should be a CSS variable? Any `style={{ color: "#..." }}` that's not pulling from `var(--color-*)`?
2. **Wrong component choice** — did they build a button from a `<div>` when `<Button>` exists? Used inline styles where `<Card>` covers the pattern?
3. **Typography drift** — raw `text-[10px]` instead of `text-2xs`? Non-IBM font? Wrong semantic class?
4. **Composition mismatch** — a paragraph of `<div className="flex gap-2">` wrapping that could be `<Row gap={2}>`?
5. **Depth/elevation inconsistency** — modal using surface-level background? Card inside a card with wrong depth?
6. **Status color misuse** — orange used for a non-brand CTA? Green for something that isn't success/running?
7. **Missing states** — loading skeleton? Empty state? Error callout? Disabled state?

Surface findings as a prioritized list: **Critical** (token violations, wrong semantics) → **Should fix** (composition, missing states) → **Nice to have** (refinements).

### Designing something new

**Before anything else: run Step 0 (Component Discovery) above.** Only proceed here once you've confirmed what exists and what gaps remain.

For the parts that require new work, layer the design in this order:

1. **Atomic layer placement** — where does this new component live? Apply the layer decision rules above before writing a single line.
2. **Layout layer** — what's the container? (Card depth? Dialog? Drawer? Full page with templates/ListPage or DetailPage?)
3. **Information hierarchy** — what's the primary content? Secondary? Actions? Where does the user's eye land first?
4. **Component selection** — which existing atoms and molecules assemble this? Every piece of this design should start from what already exists.
5. **Token application** — reference `references/tokens.md` for the exact CSS variable to use for each color, spacing, shadow, and motion value.
6. **State coverage** — design all states: default, hover, active, disabled, loading, empty, error.
7. **Motion** — does this element enter/exit? Reference the animation patterns in `references/patterns.md`.

### Implementing in existing files

> After designing, run `git diff --name-only`, find the highest common ancestor directory of all changed files, and invoke `/bytedesk-atomize --path <that-directory>` before considering the work done.

When the user asks for animation patterns, micro-interactions, or any implementation advice tied to an existing component or page:

**Do this first — before writing any code:**

1. **Find the actual file** — use Glob or Grep to locate the component. `src/ByteDesk.Web/src/components/**/*.tsx` is the search root. Don't assume file names from the reference docs; find the real one.
2. **Read the current code** — understand the existing structure: what state it holds, how it renders its list/items, what hooks are already in use.
3. **Propose surgical changes** — show a targeted diff against the actual code, not a generic template. Name the real component, real props, real file path.

The reference files describe the *system*; the codebase is the *ground truth* for what you're actually modifying. Generic examples that could apply anywhere are less useful than advice tied to the specific file.

---

## Hard Rules (Never Violate)

These are enforced by `.claude/rules/frontend.md` — violations block CI:

- No hardcoded color values in component files — use `var(--color-*)` only
- No fonts other than IBM Plex Sans (`font-sans`) and IBM Plex Mono (`font-mono`)
- No raw `text-[10px]` or similar — use semantic classes (`text-2xs`, `text-caption`, `.mc-label`)
- No inline styles for standard patterns — use atoms
- Orange (`--color-accent-orange`) = upgrade/brand CTAs only; never general interactive
- All interactive elements use blue (`--color-accent-blue`) unless explicitly brand-orange
- AG Grid must have `.mc-grid` class for theming
- Import formatters from `@/lib/utils/format` — never redefine inline
- Use `cn()` from `@/lib/utils/cn` for conditional class merging
- Use `request()` from `@/lib/api/client.ts` — never raw `fetch()`

---

## Reference Files

Read these when designing or reviewing:

- **`references/tokens.md`** — complete CSS variable reference: all colors, typography, spacing, shadows, motion, radius, z-index tokens with values and intended use
- **`references/components.md`** — full catalog of atoms (31), molecules, and organisms with props, use cases, and code examples
- **`references/patterns.md`** — design patterns for: full-page layouts, modals/drawers, data-dense panels, and micro-interaction/animation sequences

### When to read which reference

| Task | Read |
|---|---|
| Picking the right color | tokens.md → Colors |
| Choosing a component | components.md → Atoms |
| Building a modal | components.md + patterns.md → Modal patterns |
| Adding animation to a new component | tokens.md → Motion, patterns.md → Animation |
| Adding animation to an existing component | Glob/Grep for the actual file → read it → tokens.md → Motion, patterns.md → Animation |
| Building a dashboard | patterns.md → Full-page layouts |
| Critiquing a component | tokens.md (check for violations), components.md (check for better alternatives) |

---

## Output Format

### For critiques

```
## Design Review: [ComponentName]

**Critical**
- [Issue]: [specific token/component that's wrong + what to use instead]

**Should Fix**  
- [Issue]: [explanation + recommendation]

**Nice to Have**
- [Suggestion]: [optional refinement]

**Suggested diff** (if fixes are straightforward):
[targeted code changes]
```

### For new designs

Lead with a **Component Discovery Summary**: list what you scanned, what you found, and why you determined new code is needed. For example: "Scanned `ui/` and `shared/`. `StatCard` covers the metric display; no existing organism handles the combined filter + list layout for this domain, so `ProspectingResultsPanel` is new — placed in `components/sales/prospecting-searches/` as an organism."

Then state the **atomic layer**: "New component: `ProspectingResultsPanel` → organism → `components/sales/prospecting-searches/prospecting-results-panel.tsx`."

Then the composition story: "This is a Card (raised) containing a Stack with a SectionHeader, then a DataTable, then a Row of action Buttons." Then provide the full TSX.

Always include:
- TypeScript interface for props
- All states handled (at minimum: default + loading skeleton)
- `cn()` for conditional classes
- CSS variable references in `style={{}}` only for truly dynamic values

```tsx
// State coverage comment at top
// States: default, loading, empty, error
export function ComponentName({ ... }: Props) { ... }
```

### For implementation advice on existing files

After reading the actual file, lead with the file path and what you found, then show a surgical diff:

```
**File:** `src/ByteDesk.Web/src/components/sales/.../ActualComponent.tsx`
**Current structure:** [one sentence describing what's already there]

**Changes needed:**
[targeted diff against the real code — not a standalone example]
```

Name the real component. Show only what changes. If multiple files need changes, address each in sequence.