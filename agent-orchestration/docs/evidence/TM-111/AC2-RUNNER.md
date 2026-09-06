# TM-111 criterion 2: explicit, expiring runner quarantine

Decision: quarantine the exact installed-cache case pending an owner-approved runner
change. No namespace/security policy or runner image was changed. Existing main
`0230a5c` ran on GitHub Ubuntu 24.04 image `ubuntu24/20260831.293`, Bubblewrap
`0.9.0-1ubuntu0.1`, and slirp4netns `1.2.1-1build2`. The accepted diagnosis is
`RTM_NEWADDR: Operation not permitted` before Fake Kimi initializes. No verified
repository-only permission repair preserving the current sandbox is established.
The precise denying host policy remains unverified; this report does not assert
AppArmor is the cause. Changing sysctls, capabilities, policy or runner image is
an operator-owned runner decision, not something this PR performs.

## Quarantine contract

- Owner: **Ryan Helms (@ryanhelms)**, verified repository administrator and owner of
  the runner decision. Expiry: **2026-09-13 00:00 UTC**. No automatic renewal.
- Exact case: `tracked install bundle starts from plugin cwd but resolves only explicit consumerCwd`.
- The original test still runs unchanged in a dedicated job visibly named
  **QUARANTINED TM-111 — Ryan Helms — expires 2026-09-13 UTC**. It is not skipped.
- Only one failed case, at the known line-126 initialization assertion, carrying
  the exact Kimi/Bubblewrap loopback refusal is tolerated. A timeout, crash,
  missing/renamed case, additional test, skipped test, different diagnostic or
  later assertion fails CI. No broad `continue-on-error` or `|| true`.
- Hosted warning, job summary and uploaded `result.json` explicitly say
  `status: quarantined`, `coverage: false`, with the original test exit code 1.
  Raw TAP is retained. Actual recovery records `passed`, `coverage: true` and
  prompts removal; it does not extend the expiry.
- The exception is validated on every invocation; a daily expiry-only job fails
  after the deadline even without source changes. The original `test-build-install`
  status waits for both the strict gate and quarantine job, so an unexpected
  quarantine failure cannot hide behind the earlier successful checks.
- Other contract files are dynamically discovered and run normally. Bundle drift,
  unit, design and manifest checks remain strict. Local `npm run test:contract`
  remains unchanged and does not use this exception.

The missing coverage is the entire named installed-cache case: consumer-path,
credential protection and lifecycle assertions after initialization do not run
on the affected hosted runner. A successful workflow with this explicit
quarantine is **not** full installed-cache/sandbox acceptance. Criteria 1 and 3
retain their accepted historical evidence; they were not re-diagnosed here.

## Verification

Five guard tests exercise exact failure recognition, real hosted Node-shaped TAP,
recovery, expiry at the boundary, metadata/target removal, and multiple unexpected
failure mutations. The captured TAP fixture retains the historical failure block
from run34016794318; its summary is adapted to one isolated case for parser testing,
not presented as a new hosted run. Real Node adds `false !== true` after the JSON;
the guard validates that exact suffix rather than discarding arbitrary text.

Local `npm run build:check` passes with unchanged committed artifacts; plain
plugin manifest validation passes with its expected versionless advisory. YAML
parses and diff checks pass. Hosted verification is reported on the PR after
both jobs and the aggregate gate finish. Main is not changed by this PR.

No runtime source, committed bundle, contract test, dependency lock, runner policy,
provider credential, deployment, spending, merge or task status was changed.
