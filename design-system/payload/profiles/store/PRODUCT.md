# Product — ByteDesk Store

Canonical product direction for `bytedesk-store`. Paired with [`DESIGN.md`](DESIGN.md).

## Register

product

## Product purpose

ByteDesk Store is the **centrally operated commercial backend** for the ByteDesk
product line, run as a single deployment by ByteDesk only. It is the sole authority for
the package catalog, artifacts, customers, license keys, install credentials, usage
metering, billing, and install jobs. The Admin UI at `/admin` is the operator console
for all of it.

Store is **not a customer-deployable product**. Gateway and Vault are authenticated
clients only: they do not own catalog, customers, licenses, billing secrets, or usage
ledgers.

Within the suite, Store is infrastructure rather than a sold product — it is *how
selling works* for every paid product in the family.

## Users

- **ByteDesk operators** — internal ops running the store on a private host.
- **Customer ops teams** — paying customers' engineers will eventually see and use this
  console. The polish bar is therefore customer-facing, not internal-tool.

Both are technical: they live in terminals and editors, read monospace identifiers
fluently, and value density and precision over decoration.

## What it owns

- **Catalog**, organized by category and subcategory, designed so product types beyond
  plugins can be sold later.
- **Packages and artifacts**, with a named signing publisher.
- **Customers, registrations, and entitlements.** Purchases apply to product instances
  the customer has registered; applying a purchase checks entitlement and creates an
  install job targeting that instance.
- **License keys and install credentials.**
- **Usage metering** — every artifact download is metered, free packages included.
- **Billing**, through a mode-gated adapter (mock, test, live) where live charges are a
  deliberate human gate rather than a config default.

## Authorization model

Two authorities that must never merge:

- The **install credential** (service auth) is the only download path. Every catalog
  detail and artifact download requires it — **free is not anonymous**.
- The **admin session cookie** authorizes console operations and *never* authorizes an
  artifact download.

Paid packages additionally require an entitlement; denials surface as an explicit
payment-required result rather than a generic error.

## Brand and tone

Precise, operator-grade, calm. The console states facts; it does not sell.
Terminal-adjacent: monospace for identifiers, keys, and timestamps; sans for labels and
prose. Trust surfaces matter — signing publisher, billing mode, and session state are
always visible, and security invariants are stated in the UI rather than hidden in
documentation.

## Anti-references

- Generic SaaS admin templates: hero metrics, identical card grids, icon soup.
- Bootstrap-dark or default component-library dashboards.
- Marketing gloss of any kind: gradients, glassmorphism, mascot illustrations.

## Strategic principles

1. **Server-rendered, CSP-safe, zero external assets.** The whole UI ships inside the Go
   binary and works air-gapped.
2. **Every admin mutation is auditable and reversible** where the domain allows
   (revoke/reactivate, deactivate/activate).
3. **Download authority is separate from console authority**, always.
4. **One deployment, two environments.** Dev first, then production, through the
   release pipeline — never an ad-hoc path to production.
5. **The catalog taxonomy outlives today's inventory.** Model categories so the next
   product type is a data change, not a schema rewrite.

## Success criteria

An operator can trace any commercial fact — who owns a license, what a customer is
entitled to, which instance an install job targeted, what a download metered — from one
console screen, and can reverse any mutation the domain permits without leaving the
row it happened in.
