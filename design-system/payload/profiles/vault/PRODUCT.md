# Product — ByteDesk Vault

Canonical product direction for `bytedesk-vault`. Paired with the "Dispatch Desk"
[`DESIGN.md`](DESIGN.md) in this directory.

## Register

product

## Product purpose

ByteDesk Vault is the optional **identity and access directory** for ByteDesk Gateway
fleets: identities, credential methods (password, TOTP, public key), profiles and
grants, gateway enrollment, and short-lived assertions.

The split is deliberate and load-bearing: **Vault is the IdP/PDP; the Gateway remains
the PEP.** Vault decides who may authenticate to which gateway; the gateway still owns
sessions, cookies, CSP, and lockdown at the host. Vault never becomes a session layer,
and it never becomes a commerce layer — catalog, signed packages, licenses, and billing
live in ByteDesk Store, against which Vault is an authenticated client.

Success is: one operator can enroll a new gateway and land a controlled login in
minutes, with local break-glass access still intact offline.

## Users

Fleet platform engineers, security operators, and on-call leads who manage multiple
ByteDesk Gateway hosts. They work at a docked workstation under office light, often
mid-cutover or mid-access-review, and need to know who can authenticate to which
gateway without hunting through per-host config files.

## The Dispatch Desk

The Admin UI is a dense enterprise control plane, and the operator's mental model is a
**dispatch desk**: they issue access with procedural clarity — create an identity, mint
a one-time gateway enroll token, inspect enrolled gateways — and then get out of the
way. The product is at its best when it disappears into the access task.

Enroll tokens are the product's sharpest edge: they are secrets in flight, shown once,
and the console must treat them that way rather than as ordinary field values.

## Brand personality

Precise, calm, authoritative. Three words: **procedural, trustworthy, dense.** No
theatrics.

## Anti-references

- Neon cyberpunk "hacker vault" skins.
- Generic identity-vendor-clone purple marketing chrome.
- Glassmorphism card stacks and side-stripe accent borders.
- SaaS hero-metric dashboards and identical icon card grids.
- The Gateway workroom's high-energy console register applied to a control plane whose
  job is deliberate, reviewable access decisions.

## Design principles

1. **Trust before flourish.** Every surface must read as a secure operations desk.
2. **Dispatch clarity.** The primary action is issuing access — an identity or an
   enroll token — never decoration.
3. **Honest posture.** If admin auth is missing, the UI says so. Never fake enterprise
   RBAC chrome for controls that do not exist.
4. **Fleet kinship, product separation.** Share the family typeface and console density
   language with Gateway; keep Vault's accent and shell distinct so an operator always
   knows which control plane they are in.
5. **Local break-glass is sacred.** Enrolling a gateway never implies wiping host
   credentials, and the UI must never imply otherwise.

## Accessibility and inclusion

Target **WCAG 2.2 AA** for the Admin UI: focus-visible rings, contrast on dark
surfaces, no information carried by colour alone, keyboard-usable forms and tables, and
`prefers-reduced-motion` respected for any transition.

## Success criteria

An operator enrolls a new gateway into an existing fleet, grants one identity access to
it, and verifies the resulting login — without reading documentation, without copying a
secret into a second tool, and without losing offline break-glass access to the host.
