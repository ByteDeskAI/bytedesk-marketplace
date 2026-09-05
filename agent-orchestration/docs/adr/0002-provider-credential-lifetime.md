# ADR-0002: How long a provider credential lives inside the sandbox

## Status

Accepted — 2026-09-05. Settles TM-103. Records a decision already taken in code by commit 27eb1c3
("host all four CLIs and stop subscription auth from failing"), which changed the credential
lifetime without writing down why, and left the contract test that guarded the old behaviour
permanently red.

## Context

Every ACP provider the broker hosts needs its own credential to authenticate. The broker never
mounts the user's file: `prepareProviderHome` (`src/provider-sandbox.mjs:92`) copies each of the
adapter's `bootstrapFiles` from `$HOME/<sourceDir>/` into a broker-owned tree under
`brokerControlDir` — a `mkdtemp` in `/dev/shm`, mode 0700 — and bind-mounts that copy read-only over
an empty file inside the sandbox home. The mount target and each of its ancestors are registered as
protected directories, so the provider cannot rename its way around the mount.

**The original rule was shred-on-bootstrap.** The moment the ACP `initialize`/`authenticate`
exchange completed, `revokeBootstrap()` truncated, `fsync`ed and unlinked the broker copy. An agent
that then went looking for a token found an empty file. The contract test recorded this as
`bootstrap_credentials_cleared`.

**It does not work for subscription CLIs.** Claude Max — and the same shape in the other
subscription products — re-reads its credential file on *later turns*, not only at handshake. Shred
it after bootstrap and the second prompt of every session fails to authenticate. This is not a
timing bug that a retry fixes; the file has to still be there.

## Decision

**The broker-owned copy stays mounted for the life of the provider process, and is destroyed at
teardown.** Consequently an agent running inside the sandbox *can read the provider credential for
the duration of its own run*. That is accepted, deliberately, as the price of hosting subscription
CLIs at all.

Everything else that bounded the exposure is kept, and together these are the whole of the
protection:

1. **It is a copy, never the host's file.** The mount source is under `brokerControlDir`; the
   user's own `$HOME/<sourceDir>/` is never a mount source and is never written.
2. **The sandbox home is read-only to the provider.** It cannot regenerate, replace or poison the
   credential — only read it.
3. **Ancestors are protected**, so it cannot rename a directory out from under the mount and
   substitute its own.
4. **Failure paths still shred immediately.** If session establishment or the auth bootstrap fails
   — anything before the task prompt gate opens — `revokeBootstrap()` runs at once and the buffered
   input is discarded. The extended lifetime applies only to a session that authenticated.
5. **Teardown destroys it.** The `finally` path truncates, `fsync`s and unlinks the copy, then
   removes the whole control directory. A broker whose process died without running teardown is
   swept by the next sandbox start, which prunes `/dev/shm/agent-orchestration-broker-<pid>-*` for
   any pid that no longer exists.

## Consequences

**The threat model changed and should be stated plainly.** Before: a compromised agent could not
exfiltrate the provider token. Now: it can, for the length of one run. What still holds is that it
cannot exfiltrate the *user's* credential file, cannot modify credentials, cannot make the exposure
outlive the run, and cannot reach it at all if authentication failed.

**The assertion that replaces shred-on-bootstrap is that nothing survives the run.** That is now the
only thing separating a bounded decision from an unbounded leak, so it is the thing the contract
test asserts: after a completed run, no broker tree may still hold the secret
(`tests/contract/clean-install.test.mjs`). The `bootstrap_credentials_exposed` marker in that test is
correct and deliberate — reverting it re-breaks subscription auth, which is why the test says so at
the assertion.

**If the exposure ever needs closing**, the lever is per-provider, not global: an adapter whose CLI
demonstrably reads its credential only at handshake can declare that, and keep shred-on-bootstrap.
The current adapters are not distinguished this way because none of them has been measured to be
handshake-only, and guessing would fail open.
