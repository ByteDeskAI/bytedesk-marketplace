---
name: design-system-release
description: Validate and publish a ByteDesk design-system revision into the capability-oriented marketplace package, preserving immutable source provenance, payload checksums, skill licenses, and provider validation. Use for maintainers releasing upstream changes.
---

# Design System Release

Work from `ByteDeskAI/design-system`. Read the release section in `README.md`
and inspect both repositories before mutation.

1. Run `node scripts/validate.mjs`, `node --test tests/*.test.mjs`, and
   `git diff --check`. Review the full diff and keep unrelated user changes out.
2. Ensure every publishable byte is committed and the source revision is
   available remotely. The publisher must refuse dirty publishable inputs.
3. Run `node scripts/publish-plugin.mjs --plugin <marketplace>/design-system`.
   Review generated payload, source SHA, plugin version, skill inventory,
   provenance, licenses, and both provider manifests.
4. Run `node <marketplace>/design-system/scripts/validate-plugin.mjs
   <marketplace>/design-system`, plus all supported provider validations and a
   consumer sync/check smoke test.
5. Commit and push source or marketplace changes only when the user has
   authorized those external mutations. Monitor required CI to completion.

Never hand-edit generated payload or published skill copies. Fix the canonical
source and republish.
