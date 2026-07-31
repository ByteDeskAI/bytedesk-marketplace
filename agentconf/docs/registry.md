# The registry, and why it can be untrusted

## The load-bearing idea

agentconf holds two kinds of knowledge and keeps them in different files on purpose:

| | what it is | can it cause a write? |
|---|---|---|
| **registry** — `catalog.json`, `providers.json` | claims: tools that exist, paths they *might* read, env vars that *might* mean auth | **no** |
| **adapters** — `adapters/*.json` | proof: a canary on *this* machine confirmed this tool reads this file | yes |

That asymmetry is what makes an update capability safe. A registry entry is a hypothesis, and
a hypothesis only becomes a write after a canary the user's own machine runs. So the worst a
wrong — or malicious — registry can do is **suggest a path that then fails to prove**. It
cannot cause a file to be written, because nothing in the write path consults it.

This is why fetching the registry from a remote source is defensible where fetching adapters
would not be. Keep the two separate and the trust question mostly dissolves; merge them for
convenience and you have built a supply-chain vector that writes to `$HOME`.

## Two registries

### `catalog.json` — tools

Which agent CLIs exist, their binaries (including `binPaths` for tools like kimi that install
outside `PATH`), config directories, and *candidate* instruction paths graded
`documented | reported | unverified | proven`. Only `proven` has a matching adapter.

### `providers.json` — model backends

A tool is not a provider. `codex` is a tool; OpenAI is a provider. One tool may reach several
providers, one provider serves many tools, and **the interesting failures live in that gap.**

Each entry records the env vars that signal auth, the base-URL override that redirects a tool
elsewhere, which tools use it, and the conflicts worth reporting.

## What providers buys that tools alone do not

Detection is by **signal, never by secret**: whether a variable is set, never its value, and
never by opening a credential file. Three things fall out:

- **Billing ambiguity.** Live on the machine this was written on: `codex doctor` reports
  *"mixed auth signals: ChatGPT login plus API key env var; HTTP reachability uses API-key
  mode."* A ChatGPT subscription is signed in, `OPENAI_API_KEY` is set, and the API key wins —
  so usage bills to the key while the user believes it bills to the subscription. No file check
  would find that; it is a *relationship* between two signals.
- **Silent redirection.** `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL` points a tool at a proxy.
  Legitimate for a gateway, and the single highest-value thing to notice if it appeared without
  you setting it.
- **Reachability without configuration.** A provider whose key is set but which no installed
  tool is configured to use is dead weight, and usually a leftover.

## The update capability

Three sources, merged in order, each with a different trust posture:

1. **Bundled** — ships with the plugin. This marketplace versions by commit SHA, so a new entry
   arrives on the next session with nothing to subscribe to. Trusted as much as the plugin is.
2. **Local overlay** — `~/.agents/catalog.local.json`, `~/.agents/providers.local.json`.
   The user's own additions, merged over the bundled set by `id`. Exists so a tool released
   this morning does not require a plugin release. Trusted as much as the user.
3. **Remote** — `agentconf update --from <url>`, opt-in per invocation and never automatic.
   Safe by the argument above: it can only add claims.

Merge rule: later sources override earlier ones **by `id`**, field by field. Removal is
explicit (`"retired": true`) rather than by omission, so a truncated download cannot silently
delete coverage.

`update` always prints a diff and, for a remote source, requires confirmation. It never
rewrites an adapter — a registry that could edit `adapters/*.json` would defeat the whole
separation.

## What is deliberately not built

- **Auto-fetching on a timer.** A background process that pulls remote data and writes it near
  a home directory is the shape of the thing this design exists to avoid. The bundled path
  already updates automatically and needs no network.
- **Writing provider credentials.** agentconf reports that a provider is configured. Configuring
  one means handling a secret, and that is the vendor CLI's job (`codex login`, `claude auth`).
- **Inferring a provider from a config file.** Reading `~/.kimi-code/config.toml` would mean
  parsing a file that contains an `api_key`. The env-var signal is weaker and costs nothing.
