---
name: get-ci
description: >
  Teach a product checkout how TeamCity / GitHub Actions must publish cores
  to get.bytedesk.ai: v* tags, {prefix}-{platform}-{arch}[.exe], upload to
  Cloudflare R2, metadata-only TeamCity artifacts, mandatory binary cleanup.
  Use when the user says how should CI publish, TeamCity, release-publish,
  or run get-ci in this repo.
---

# get-ci

Run **in the product repo** (gateway, vault, store, or any registered app).
The product does not need `get.yaml`.

```bash
SKILL_DIR="<path-to-this-skill>"
"$SKILL_DIR/scripts/audit-ci.sh"
```

## Contract this repo must satisfy

1. Tags `vMAJOR.MINOR.PATCH` start the build (TeamCity and/or GHA).
2. Assets named `{prefix}-{platform}-{arch}[.exe]` (example `bytedesk-gateway-linux-amd64`).
3. `release-publish` flattens, then calls get `scripts/publish-r2.sh <app> <ver>` (S3 API to R2). Official writer is TeamCity for application `gateway` (and vault/store) — not a laptop `aws s3 cp`. **Exception:** GitHub Actions `release-core.yml` is the R2 writer for application `gateway-desktop` only (Tauri linux/windows amd64), because TeamCity agents cannot natively produce Windows NSIS.
4. TeamCity `artifactRules` on publish = `VERSION`, `SHA256SUMS`, `RELEASE.txt` only.
5. **Cleanup is required:** `cleanup { artifacts(builds = 1) }` on every `release-*` type, plus `cleanup-tc-binaries.sh` after a successful R2 put (wipe agent `dist/bytedesk-*` and DELETE binary artifacts via TC REST).
6. Public download is `https://get.bytedesk.ai/release/{application}/{platform}/{arch}/{version|latest}`. Not TeamCity `.lastSuccessful`.

If `.teamcity/` is missing or still publishes `dist/**` binaries, list the gaps and open a PR on **this** product repo (workflow + Kotlin snippet + vendor or curl of `publish-r2.sh`). Do not invent `get.prod.bytedesk.ai`.
