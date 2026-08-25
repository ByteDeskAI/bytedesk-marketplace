# Product — ByteDesk Gateway

Canonical product direction for `bytedesk-remote-gateway`. Paired with
[`DESIGN.md`](DESIGN.md).

## Register

product

## Product purpose

ByteDesk Gateway is a small Go service that puts **secure remote access to your own
workstation** behind real authentication: a protected terminal, desktop and live screen
surfaces, a full file browser, an agentic workroom, and connection administration —
reachable from a laptop or a phone without exposing the machine.

It is the **free, top-of-funnel product** of the ByteDesk host layer. Gateway owns the
host: sessions, policy enforcement, CSP, lockdown. It does **not** own identity
directories (that is Vault) or catalog, licensing, and billing (that is Store); against
both it is an authenticated client only.

## Users

A single technical operator, or a small team of them, running their own machines:
developers, solo operators, and on-call engineers. They live in terminals, read
monospace fluently, and value density and precision over decoration. They are often
mobile — the phone is a real client, not an afterthought.

## What it does

- **Authenticated access**: password + TOTP, optional post-MFA approval link, optional
  push notification, CIDR and geo allowlists, signed short-lived session cookies, local
  rate limiting.
- **Sessions**: an authenticated tab launcher for terminals, coding agents, a browser,
  a virtual desktop, and a live screen mirror.
- **Mission Control**: live health for tunnel, backends, units, deploy and watchdog
  state, streamed over Server-Sent Events rather than client polling.
- **Files**: upload/download, multi-select, resumable transfer, zip.
- **Connection admin**: see logged-in sessions and live viewers, kick, ban by IP with
  optional expiry, audit the result.
- **Host awareness**: an on-screen border on the physical display while a remote viewer
  is connected, and a clipboard bridge back to the host.
- **Installable PWA** with on-screen terminal keys for mobile use.

## Product surface architecture

The React SPA is the single source of truth for every product document route; embedded
legacy HTML exists only as a fallback when the SPA bundle is missing. Everything ships
inside one Go binary — the UI is embedded, CDN-free, and works on a private network
with no external asset fetches.

## Brand and tone

Direct, operational, honest. The console states facts and current posture; it does not
sell inside the work surface. Where a security control is absent, the UI says so
plainly rather than implying an enterprise capability that is not there.

## Anti-references

- Generic SaaS admin templates: hero-metric tiles, identical icon card grids, icon soup.
- Bootstrap-dark or default component-library dashboards.
- Marketing gloss inside the console: gradients, glassmorphism, decorative illustration.
- Fake enterprise RBAC chrome standing in for controls that do not exist.

## Strategic principles

1. **The host is the product.** Chrome frames the terminal, desktop, and files; it never
   competes with them for space or attention.
2. **Authentication is not decoration.** Every non-health endpoint stays authenticated,
   and launch validation stays server-side even when the UI also disables the choice.
3. **Live state must be honest.** Health is streamed, and stale data is labeled stale.
4. **Self-healing over alarming.** Watchdogs roll back bad deploys and re-heal the
   public path; the UI reports what happened rather than demanding operator triage.
5. **Free core, clean seams.** Commerce and identity live in Store and Vault; Gateway
   keeps client seams rather than absorbing their authority.
6. **Zero external dependencies at runtime.** The binary carries its own UI.

## Success criteria

An operator can reach a live terminal on their own machine from a phone, over a public
hostname, in seconds — through real auth, with the host visibly signalling the remote
session, and with a one-liner install that needed no manual configuration.
