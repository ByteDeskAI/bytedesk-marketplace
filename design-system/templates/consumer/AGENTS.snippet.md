## Design context

Before changing user-facing design, read in order:

1. `.context/design-system/DESIGN.md`
2. `.context/design-system/profiles/PRODUCT_SLUG/DESIGN.md` (and `PRODUCT.md` beside it)
3. `DESIGN.md`

This repository's agent context directory is the profile inside the managed delivery:

```bash
IMPECCABLE_CONTEXT_DIR=.context/design-system/profiles/PRODUCT_SLUG
```

The managed tree is read-only from this repository. Design-system changes land in `ByteDeskAI/design-system` first, then this repository adopts a reviewed plugin payload.
