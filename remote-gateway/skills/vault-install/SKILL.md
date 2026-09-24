---
name: vault-install
description: >
  Install ByteDesk Vault (fleet identity directory) on Linux, macOS, or Windows.
  Use when the user says install vault, setup vault, or vault enroll.
---

# vault-install

ByteDesk Vault is a **standalone product** ([ADR 0013](../../../docs/adr/0013-multi-repo-product-topology.md)):

| Path | Role |
|------|------|
| **`bytedesk-vault`** (sibling repo) | Product source + `scripts/install.sh` / `scripts/release.sh` + TeamCity |
| **TeamCity → get.bytedesk.ai** | Commercial multi-arch binaries (SoT) |
| This skill | Operator install on Linux/macOS/Windows |

GitHub is **source control only** (clone/PR). Do not install from GitHub Releases.

## Preferred install (product path)

```bash
# Published one-liner (get.bytedesk.ai → Vault TeamCity release-publish)
curl -fsSL https://get.bytedesk.ai/vault | sh
curl -fsSL https://get.bytedesk.ai/vault | sh -s -- --bind 127.0.0.1:18765 --start

# From product checkout (lab / offline)
git clone https://github.com/ByteDeskAI/bytedesk-vault
cd bytedesk-vault
./scripts/release.sh   # local binary
./scripts/install.sh --bind 127.0.0.1:18765 --start
```

## Skill scripts (self-contained; setup plugin)

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/vault-install}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
"$SKILL_DIR/scripts/install-vault.sh" --bind 127.0.0.1:18765 --start
# Windows: pwsh -File "$SKILL_DIR/scripts/install.ps1" --start
```

Private-first by default. Offline: `BYTEDESK_VAULT_ARTIFACT=/path/to/binary`.

### Artifact / source resolution

1. `BYTEDESK_VAULT_ARTIFACT` (local path)
2. `BYTEDESK_VAULT_RELEASE_URL`
3. `BYTEDESK_VAULT_RELEASE_BASE` (default `https://get.bytedesk.ai/releases/latest` — TeamCity)
4. Local `dist/`
5. Build from source when `go` is available: `BYTEDESK_VAULT_SRC` → sibling `../bytedesk-vault`

Env: `BYTEDESK_VAULT_HOME` / `VAULT_HOME`, `BYTEDESK_VAULT_PUBLIC_URL`, `BYTEDESK_VAULT_SRC`.

Gateway helpers: `./scripts/commercial/install-vault.sh`, `./scripts/bdgw vault install`
(same resolution order).
