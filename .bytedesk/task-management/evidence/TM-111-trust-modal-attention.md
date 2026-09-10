# TM-111 — measured, 2026-09-06, tmux 3.4, real `claude --model haiku`

## The report's mechanism was inverted

A launch into a directory Claude Code had never seen returned in 5s with
`"ready": true, "outcome": "ready"` — not a timeout. The pane held the folder-trust modal:

    Quick safety check: Is this a project you created or one you trust? …
    ❯ No, exit
      Yes, I trust this folder

`claude.json`'s ready pattern `^\s*[│|]?\s*[>❯]` matched the menu row `❯ No, exit`, so the
launcher declared the agent ready and typed the bootstrap pointer into a modal whose Enter
means "No, exit".

## Pattern probes against two live panes (`tmux display-message -p '#{C/r:…}'`)

| pattern | real input box | trust modal |
|---|---|---|
| `^\s*[│\|]?\s*[>❯]`                | 29 (match) | 14 (match — the bug) |
| `^\s*[│\|]?\s*[>❯][^a-zA-Z0-9]*$`  | 29 (match) | 0 (no match) |
| `^\s*[│\|]?\s*[>❯]$`               | 0 (no match — too strict) | 0 |

The real input box is `❯` followed by U+00A0 and nothing else, which is why the bare `$`
anchor fails and the "nothing alphanumeric after the glyph" form is the right one.

## After the fix

Untrusted directory, one `claude:haiku` agent, elapsed 5s:

    ready: False  provider: None
    attempt: {'label': 'claude:haiku', 'outcome': "Claude is waiting on its folder-trust question
      for this directory — nobody can answer it from here. Answer it once in a normal terminal
      (cd into the agent's cwd and run `claude`, choose \"Yes, I trust this folder\"), then launch
      again."}

Trusted directory (this repo), same spec: `ready: True  provider: claude:haiku` — the narrowed
pattern still matches a real prompt, with `⚠ 3 MCP servers need authentication · run /mcp` on
screen (TM-110).
