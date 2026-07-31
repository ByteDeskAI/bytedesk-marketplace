---
name: audit
description: Add an unmanaged AI coding tool to agentconf by discovering how it loads configuration and proving it with a canary. Use when a tool is installed but has no adapter, or when it is unclear whether a tool reads a given config path.
user-invokable: true
allowed-tools:
  - Bash
  - Agent
---

Run `agentconf detect` first to confirm the tool is actually installed and which tools are
already covered.

Then spawn the **config-auditor** agent with the tool name. It researches the vendor docs,
corroborates against the binary, and runs a canary through the mechanism it intends to ship —
symlink or copy — because that is a per-target fact, not a style choice.

Return its adapter to the user for review before writing it into `adapters/`. Two things to
check in the result:

- Is `verifiedBy` a real canary token that came back, or is it a paraphrase of documentation?
  Only the first counts.
- Did it distinguish **unproven** from **disproven**? A missing string in a stripped binary
  is not evidence of absence.

If the canary did not pass, do not add the adapter. Coverage that lies is the failure mode
this whole plugin exists to prevent.
