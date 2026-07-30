# agentconf

Capability-tested configuration for AI coding agents.

Writing a config file is not evidence that anything read it. `rulesync` will happily write
`~/.config/goose/.goosehints`; `strings $(command -v goose)` contains no reference to that
filename. The file exists, the tool ignores it, and nothing anywhere says so.

agentconf keeps one shared instruction source wired into every agent on the machine, and
**proves each tool reads it** with a canary token rather than assuming the write landed.

```
$ agentconf check
ok: 3 adapters wired and in sync (claude-instructions, codex-instructions, codex-policy)

$ agentconf detect
  claude     installed  logged in (oauth_token)
  codex      installed  mixed auth signals: ChatGPT login plus API key env var
```

That second line is the argument for asking each vendor's own diagnostic instead of stat-ing
credential files. A file check calls that state green. It is not green — an API key env var is
shadowing the ChatGPT login, silently changing which account is billed.

## Three states, never two

| state | means |
|---|---|
| `proven` | a canary token was written to the shared source, the tool was asked for it, and said it back. Dated. |
| `unproven` | wired, but no canary has run. Reported as unproven — **not** as working. |
| `broken` | the wiring is gone or has drifted. |

Every other config tool has one state: "configured". That is why silent failure is the norm.

## Commands

```
agentconf detect            what is installed and logged in, via each vendor's own diagnostic
agentconf check             is the wiring intact? offline, fast, exit 1 on drift
agentconf wire [--dry-run]  apply the adapters; backs up anything it replaces
agentconf verify [--all]    canary: prove each tool actually READS the shared file
agentconf adopt             what this machine already has, before you wire anything
agentconf restore [stamp]   list backups, or put one back
agentconf install-cli       wrapper in ~/.local/bin so your shell and Codex can call it too
```

`install-cli` matters more here than for most plugins: Claude Code puts `bin/` on the **tool
host's** PATH only, and a tool whose job is configuring the other agents is the wrong half of
itself if only one agent can call it. The wrapper resolves the source tree first, then the
most **recently modified** cache dir — by mtime, not version sort, because commit-SHA
directory names do not sort chronologically.

`check` is cheap and runs on every session via the SessionStart hook. `verify` costs real
tokens — each probe is a model invocation — so it is explicit and occasional.

## The mechanism is per-target, and discovered

Not a style choice. Established by testing, not by reading docs:

| target | mechanism | why |
|---|---|---|
| `~/.claude/CLAUDE.md` | `@import` | Claude Code expands `@path`, so tool-specific sections stay put |
| `~/.codex/AGENTS.md` | symlink | Codex follows it — canary confirmed |
| `~/.codex/rules/shared.rules` | **copy** | a symlinked `*.rules` is **silently ignored** ([openai/codex#16452](https://github.com/openai/codex/issues/16452)) |

Same tool, same directory, opposite answers, no error either way. This is exactly the class of
failure the canary exists to catch, and why adapters ship with `verified` and `verifiedBy`
fields naming the token that came back.

`~/.codex/rules/default.rules` is deliberately **not** managed: Codex appends to it on every
approval in the TUI, so anything written there is fighting a generator. Hand-authored policy
goes in a sibling file, which Codex also loads — and `forbidden` there overrides `allow` in the
generated file, so an allowlist that grew by accident can be walked back.

## What it will not do

- **Read credential files.** `~/.config/github-copilot/auth.db` is `0644` with a live `-wal`
  and its mtime moves during normal use; mode and mtime carry no login signal. A tool that
  walks `$HOME` opening OAuth material is indistinguishable from an exfiltrator whatever its
  README says.
- **Write config a tool generates.**
- **Replace [rulesync](https://github.com/dyoshikawa/rulesync).** rulesync writes, across ~40
  targets, and is good at it. agentconf proves the write was read. `agentconf verify` after
  `rulesync generate` is the composition; a second syncer is not.

## Adding a tool

Adapters are data — `adapters/*.json` — so a new tool is a file plus a passing canary, not a
code change. The `config-auditor` agent does the research: vendor docs first, `strings` on the
binary as corroboration, then a canary through the mechanism it intends to ship. It returns
**no adapter** if the canary fails, because coverage that lies is the failure mode this plugin
exists to prevent.

A tool with no adapter is reported as unmanaged. `check` passing says nothing about it.

## Install

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install agentconf@bytedesk
```

The CLI at `bin/agentconf` is the product; the plugin is a skin over it. A Claude Code plugin
can only be installed *by* Claude Code, and the point is to configure Codex, Gemini and the
rest too — so the binary works standalone, and `bin/` is added to the Bash tool's PATH when
the plugin is enabled.

## Tests

```
bash tests/test-agentconf.sh
```

27 tests against a throwaway `$HOME`, covering the failure modes rather than the happy path:
the clobbered symlink, the symlinked rules file that reads as in-sync but is not in force,
drift in a copied file, `--if-touched` staying silent for unmanaged files, `verify` leaving no
canary behind when a probe cannot run, `install-cli` refusing to overwrite a wrapper it did
not write, and `restore` backing up the current state before overwriting so an undo is itself
undoable.
