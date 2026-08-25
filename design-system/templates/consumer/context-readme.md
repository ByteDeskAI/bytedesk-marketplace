# Repository context

This repository consumes a checksummed ByteDesk design-system payload as committed
files at `.context/design-system`.

Verify after cloning:

```bash
node .bytedesk/design-system-check.mjs
```

Read `.context/design-system/DESIGN.md`, the selected product profile, and the repository's root `DESIGN.md` before making user-facing design changes.

The managed tree carries this repository's tokens *and* its design profile at the same source commit:

- tokens — `.context/design-system/tokens/` (see its `README.md` for the per-runtime contract)
- profile — `.context/design-system/profiles/PRODUCT_SLUG/` (`DESIGN.md` + `PRODUCT.md`), also this repository's `IMPECCABLE_CONTEXT_DIR`

Never edit managed files. Design changes land in `ByteDeskAI/design-system` first, then this repository re-syncs.
