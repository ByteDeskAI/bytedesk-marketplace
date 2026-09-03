# Changelog

## Unreleased

### Added

- `bytedesk-designer-translate`: a ninth member that turns an approved mockup into a
  pixel-accurate HTML surface and keeps an implementation matched to it, separating the
  coarse `layoutScore` (surface ↔ mockup PNG, never reaches 1.0) from the strict
  `pixelDiff` (surface ↔ live URL, reaches 0.0).
- `scripts/authority-doctor.sh`: resolves a design authority from an explicit
  `--authority` argument or a committed `.design-authority` file, verifies it conforms,
  names the rule that fired, and exits `0` connected / `1` found-but-not-conforming /
  `2` nothing-configured. `--product <name>` reports the resolved profile.
- `scripts/codex-exec.sh`: a bounded, varying, disclosed retry around `codex exec`. It
  checks the disk before retrying so a hung-but-successful generation is not billed twice,
  varies each attempt (direct → scoped `CODEX_HOME` → backoff), and writes
  `<name>.attempts.json` so a stage can say which attempt produced the artifact.
- The **named reflexes** list in the surface skill — the specific generation habits Codex
  reaches for by default (eyebrow labels, pill-everything, glass panels, decorative
  gradients, empty charts, opening metric-card grids), forbidden by name rather than by
  taste, with the authority always overriding. Adapted from Uncodixfy (MIT).
- The three-layer profile rule and the fail-closed rule for an unreachable authority,
  carried into every producing skill and its evals.
- A full eval harness: 31 evals across the suite with typed assertions, three benchmark
  iterations, `evals/README.md`, and `evals/sweep-findings.md` — the defects a sweep finds
  being the actual product, not the score.
- `references/codex-handoff.md` now diagnoses the silent `codex exec` hang: MCP servers
  declared in `~/.codex/config.toml` all start before the prompt runs, so one unreachable
  server stalls every invocation. Two commands to confirm it, and the rule that repair is
  permitted but concealed repair is not.

### Changed

- The authority skill treats the CSS adapter as **generated once at creation and
  hand-maintained afterwards** — once it carries a light theme, richness scopes, desk tints
  or a reduced-motion block, regenerating it deletes all of them.
- Extending an existing authority is now documented as a two-phase commit, because manifest
  hashes compare against `git show HEAD:<path>`; writing everything and validating once
  fails three gates in a way that reads like a bug in the files rather than in the order.
- Authority validation checks that the four declarations of an `own` accent *agree*, not
  merely that they exist — the previous check passed products whose accent fell below the
  4.5:1 their own token file asserts, and `inherits` products with no `[data-bd-product]`
  scope that silently render the family accent.
- A `viewed` entry in the run folder records a hash of the artifact at the moment it was
  inspected, and covers render dependencies. A name list cannot tell you the file changed
  afterwards, which is how a broken verdict screen shipped past a green check.
- Eval assertions were re-typed and re-trapped after iteration 1 found 96 of 176 passing in
  both configurations — those measure a careful agent, not this suite.

### Fixed

- The doctor emits a machine-readable `SHA:` line beside the human one. `resolve_authority`
  looked for an `@`-prefixed sha while the doctor only said "pinnable at `<sha>`" in prose,
  so every run recorded `"authority": null` and lost the pin entirely.
- Shipped the profile-resolution work that had never been vendored: installed copies exited
  `64` on the `authority-doctor.sh --product <name>` call the skills' own instructions
  specify, so a stage following its instructions literally could not complete the profile
  check.
- `codex exec -o` is passed an absolute path — it resolves against the invoking shell, not
  `-C`, so generated images landed outside the run folder.
- Five defects the first eval sweep surfaced, including the discovery stage diverging on a
  fact the authority had already settled, in contradiction of its own rule against
  inventing an audience.

### Removed

- The conventional-location authority resolution rules (`../design-system`,
  `~/design-system`). They baked one company's directory naming into a suite meant for
  anyone and made resolution depend on the working directory — one sweep produced two
  different answers from seven runs on the same machine against the same repository. The
  doctor may still name plausible candidates nearby; it will never adopt one.
