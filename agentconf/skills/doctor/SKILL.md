---
name: doctor
description: Report the state of shared agent configuration on this machine — which agent tools are installed and logged in, whether the shared instruction source is wired into each, and whether anything has drifted. Use when the user asks about agent config, AGENTS.md, CLAUDE.md, whether a tool is picking up their rules, or says a tool seems to be ignoring instructions.
user-invokable: true
allowed-tools:
  - Bash
---

Run both, in this order, and read them together:

```
agentconf detect
agentconf check
```

`detect` asks each vendor's own diagnostic rather than inspecting credential files — a file
check cannot tell "logged in" from "logged in AND an API key env var is shadowing it", and
that second state is real and silently changes which account is billed.

`check` is offline and fast. Exit 1 means the wiring is broken; the message names the file.

Report what is **unmanaged**, not just what is broken. A tool with no adapter is a gap in
coverage, and `check` passing says nothing about it. If the user has tools installed that
have no adapter, say so plainly and offer [[audit]] to add one.

Do not run `agentconf verify` here — each probe is a real model invocation. Suggest it only
when the user suspects a tool is ignoring a file that is correctly wired.
