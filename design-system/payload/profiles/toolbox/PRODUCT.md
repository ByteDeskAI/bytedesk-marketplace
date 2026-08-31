# ByteDesk Toolbox - Product Direction

## Register

product

## Purpose

ByteDesk Toolbox is the desktop home for discovering, installing, updating, launching,
and understanding applications in the ByteDesk ecosystem. It stays near the system tray,
uses `get.bytedesk.ai` as its catalog/update interface, and makes the next safe action
obvious without becoming a permanent dashboard.

## Users

- People evaluating or installing public ByteDesk applications.
- Signed-in customers whose account unlocks entitled applications or channels.
- Developers and operators who need exact versions, freshness, progress, failure, and
  rollback information without managing each application separately.

## Product promises

1. Public applications remain useful before sign-in; entitlement changes availability,
   not the honesty of what is shown.
2. Installed version, available version, catalog freshness, and update consequence are
   explicit.
3. Bulk actions remain inspectable and individual applications remain controllable.
4. Background presence is quiet; attention is requested only when the user can act.
5. Simulated, unavailable, cached, stale, and live information are visibly distinct.

## Primary journeys

- See installed applications and pending updates at a glance.
- Update one application or review and start `Update all`.
- Discover public and account-entitled applications without mixing access and health.
- Expand release notes, version history, and update activity without leaving the shelf.
- Change update policy, account state, launch behavior, theme, personality, and dark
  richness.

## Voice

Calm, exact, and technical. Prefer short verbs, real versions, source-valid states, and
plain-language consequences. Celebrate completion briefly; explain waiting and failure
without blame. Never imply an agent or updater performed work that did not occur.

## Success

A user can open the shelf, understand catalog freshness, identify installed and available
applications, and start the intended safe action in seconds. A failed or gated action
always states why and what can happen next.

## The application we are building

**JetBrains Toolbox's functionality, drawn entirely in ByteDesk's design tokens.**

That is the whole instruction, and the split is clean. JetBrains Toolbox decides **what
is on the screen and what it does**. The ByteDesk design system decides **every value it
is drawn with**. A person who uses JetBrains Toolbox should already know how to drive
this; nobody should be able to tell where its look came from, because its look is ours.

**From JetBrains Toolbox — the functional model:**

- **The feature set.** Install, update, and roll back applications from a catalog. Update
  one, or update everything in one coordinated action. Release notes and version history
  for each application. Account state that changes what is available.
- **The information architecture.** One list is the home screen. Installed applications
  sit above available ones. A row is an application, and it carries the name, the
  installed version, the available version, and the action that applies right now.
- **The interaction model.** Per-row actions with a coordinated action alongside them.
  Detail expands in place rather than navigating away. Search leads and reaches
  applications, versions, release notes, and settings alike.
- **The manner.** Tray-adjacent, summoned rather than resident, dismissed as soon as the
  question it was opened for is answered.

Raycast remains the keyboard-fluency reference for invocation.

## From the ByteDesk design system — every visual value

No colour, dimension, typeface, weight, radius, or elevation is taken from JetBrains
Toolbox, sampled from a screenshot of it, or hand-picked to resemble it. All of them come
from the family token set:

- Colour: the family palette and Toolbox's own accent (`product.toolbox`), theme-scoped.
- Type: the family type stack and its scale, including where versions and timestamps are
  set in the mono face.
- Spacing, sizing, radius, border and elevation: the family's steps, which is what
  actually sets row height, list density, and the rhythm of the page.
- Material and state treatment: the family's, including the honesty rules below — live,
  cached, stale, simulated, gated and unavailable stay visibly distinct, and nothing
  implies an update did work it did not do.

Where the two meet: JetBrains Toolbox says "a scannable list of application rows, each
with an action." The token set says how tall that row is, what it is coloured, and what
its type is. Neither answer is negotiable by the other.

## Anti-references

- JetBrains **branding**: its name, logos, product marks, or wordmarks anywhere in the
  interface. The style is the reference; the brand is not ours to wear.
- A promotional app store that obscures versions, access, or update consequences.
- A telemetry-heavy mission-control dashboard as the only personality.
- Decorative AI imagery, fake terminals, or activity implying work not occurring.
