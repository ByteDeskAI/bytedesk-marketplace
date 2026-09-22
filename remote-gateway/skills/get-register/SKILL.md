---
name: get-register
description: >
  Portable skill: register the current product checkout with get.bytedesk.ai.
  Copy this folder into a product repo (gateway, vault, store, or any GitHub
  repo). The product does not need get.yaml.
---

# Portable get-register

Run from a **product** checkout. Reads `git remote get-url origin`, then
writes a catalog PR/entry on get — never a `get.yaml` here.

```bash
SKILL_DIR="<path-to-this-skill>"
"$SKILL_DIR/scripts/register-from-checkout.sh" [--id gateway] [--title "ByteDesk Gateway"]

This repo publishes two getd applications: `gateway` (Go server, TeamCity) and
`gateway-desktop` (Tauri client, GitHub Actions). Register the desktop id
separately if the catalog is per-application:

```bash
"$SKILL_DIR/scripts/register-from-checkout.sh" --id gateway-desktop --title "ByteDesk Gateway Desktop"
```
```

Needs either:

- a sibling/local clone of `ByteDeskAI/get.bytedesk.ai` (`GET_REPO`), or
- `BYTEDESK_GET_ORIGIN` (POST `/admin/register`).
