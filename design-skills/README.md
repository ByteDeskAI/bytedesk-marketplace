# design-skills

Design craft skills, split out of the old `design-system` plugin on 4 September 2026 when that
plugin became the thin eight-skill procedure set that lives in the design-system repository.

These twenty skills are general craft and carry no ByteDesk design content: motion and animation
(`animate`, `animate-expo`, `animation-vocabulary`, `find-animation-opportunities`,
`improve-animations`, `review-animations`), platform and web craft (`apple-design`,
`web-design-engineer`, `emil-design-eng`, `awwwards-creative-frontend`,
`awwwards-micro-interactions`, `awwwards-webgl-shaders`, `write-swift`), and composition and tooling
(`beautiful-article`, `web-video-presentation`, `prototype`, `pick-ui-library`, `gpt-image-2`,
`ask-sonner`, `kb-retriever`). The four specialist agents beside them read the consumer's
vendored design-system tree and have checksum and routing checks in CI.

For anything about the ByteDesk design system itself — adopting it, syncing the vendored tree,
looking up a token, reviewing a diff against a profile, running the studio, cutting a release —
install `design-system@bytedesk` instead. It reads the published catalog and the consumer's own
tree at run time and carries no payload.

```
/plugin install design-skills@bytedesk
```

Versionless by design: every commit to this marketplace is a new version, so consumers update
without a bump. The upstream extraction of the same content lives in `ByteDeskAI/design-skills`.

## Specialist selection and integrity

The four agents are `profile-architect`, `token-accessibility-auditor`,
`consumer-migration-specialist`, and `design-system-reviewer`. Their reviewed SHA-256
pins, trigger phrases, allowed tools, and required output sections live in
[`agents/validation/agent-catalog.json`](agents/validation/agent-catalog.json).
The catalog restores the useful contract from `e28d39a^:design-system/agent-catalog.json`;
it contains no design payload or MCP tool inventory.

From this marketplace checkout, select a role manually with Node:

```sh
node design-skills/agents/validation/routing.mjs -- "Review this pull request for design drift against the selected product profile."
```

The CLI verifies the agent files before suggesting a role. Matching is lexical:
case and punctuation are normalized, complete trigger phrases are counted once,
and the role with the most distinct matches wins. Ties return `clarify` with the
candidate names; no matches return `unmatched`. Rephrase or choose the role explicitly
after clarification. This is a deterministic helper, not a model evaluation or an
automatic host dispatch hook; negation and nuanced multi-part requests require judgment.

Read `agents/<agent>.md` for the returned role and use it as the brief. If the current
host actually exposes that named agent, pass `--native-agent-available` before `--`
to get a `named-agent` suggestion. The helper never launches a provider. The historical
`nativeProviders`/`fallbackProviders` brand lists are replaced by this explicit capability
check: a provider name does not prove that an installed host loaded the plugin's agents.
The removed `design-system-agents` fallback skill is replaced here by the documented
brief workflow; no nonexistent skill is invoked.

Before executing the brief, follow the agent's file discovery and safety instructions.
Missing `.context/design-system/` evidence means stop and use `design-system-sync`;
the selector does not read or certify the consumer's tree. Routing never authorizes
writes. The migration agent's `explicit-write` mode describes its separate user-approval
requirements, not permission granted by the selector or enforcement of its tool use.

Run the same checks as the Marketplace workflow:

```sh
node scripts/validate-marketplace.mjs
node --test design-skills/agents/validation/routing.test.mjs
```

Golden fixtures preserve the four historical prompts and their output sections, plus
native/brief capability paths, ambiguous and unmatched requests, and case/punctuation
variants. Mutation tests prove that changed agent bytes, removed inventory entries,
and swapped trigger routing fail. These checks validate the shipped contract and manual
selector; they do not claim that Claude, Codex, Grok, or Kimi autonomously selects it.

For an intentional agent edit, review the text change, compute its new hash (for example,
`sha256sum design-skills/agents/profile-architect.md`), then update only that catalog pin
and any deliberately changed contract or golden expectation. CI never refreshes pins.
`.gitattributes` disables line-ending conversion for these four files so byte checks
remain stable across checkouts. Hashes catch unreviewed drift, not an attacker able to
edit both source and pins.
