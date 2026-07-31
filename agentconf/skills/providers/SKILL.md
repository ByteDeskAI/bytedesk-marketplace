---
name: providers
description: Report which LLM providers are configured on this machine, which tools use them, and where two auth signals conflict — such as an API key silently overriding a subscription login. Use when the user asks what providers or models are set up, why usage is billing to the wrong account, or whether a tool is pointed at the right endpoint.
user-invokable: true
allowed-tools:
  - Bash
---

```
agentconf providers
```

A tool is not a provider: `codex` is a tool, OpenAI is a provider, and the failures worth
finding live in the gap between them.

## Read the conflicts first

They are relationships between two signals, which no single file check can see:

- **Billing ambiguity** — a subscription is signed in *and* an API key env var is set. The key
  usually wins, so usage bills to the key while the subscription sits idle. `codex doctor`
  independently calls this "mixed auth signals"; agentconf reports the same class for tools
  whose own diagnostics do not.
- **Silent redirection** — a `*_BASE_URL` variable points a tool at a proxy. Legitimate for a
  gateway, and the highest-value thing to notice if the user did not set it.
- **Idle keys** — configured, but no installed tool is known to use it. Usually a leftover.

## What it does not do

Detection is by **signal, never by secret**: whether a variable is set, never its value, and
never by opening a credential file. Say this if the user asks how it knows — it is the
difference between a diagnostic and a credential scraper.

It also does not *fix* a provider. Resolving a billing conflict means unsetting an env var or
logging out, both of which touch the user's shell profile or a vendor's credential store. Show
the conflict, name the variable, and let them choose. `~/.zshrc` may not be the file their
shell reads — check `ZDOTDIR` before suggesting an edit.
