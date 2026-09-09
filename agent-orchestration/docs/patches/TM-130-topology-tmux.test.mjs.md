# TM-130 — patch for `tests/contract/topology-tmux.test.mjs` (+ `tests/fixtures/fake-agent.json`)

Shared file, so this is the change I want rather than an edit I made. **Apply it in the same commit
as `TM-130-cli.mjs.md`** — the three pieces here are atomic. On its own my branch leaves this
contract green and unchanged, which is deliberate: nothing rings until the `cli.mjs` patch lands.

---

## 1. `tests/fixtures/fake-agent.json` — give the fixture a measured composer

Without this the fixture adapter has no `composer`, so `ringCapability` is `"unsupported"`, the
bell correctly refuses to ring, and the assertion below would keep passing while proving nothing.
The fixture is a readline stand-in rather than a TUI, but it renders a composer line exactly like
one: a bare `> ` when it is waiting, `> <text>` while a line is typed and unsubmitted.

**Add, as a sibling of `ready`:**

```json
  "composer": {
    "empty_tmux_pattern": "^>[^a-zA-Z0-9]*$",
    "empty_pattern": "(^|\\n)>[^a-zA-Z0-9\\n]*$",
    "note": "Measured 2026-09-09 against tmux 3.4 by running this fixture in a real pane and asking `tmux display-message -p -t <pane> '#{C/r:^>[^a-zA-Z0-9]*$}'`: idle answered 2, the same pane with `[ao] Message 001-ping from conductor` typed and NOT submitted answered 0, and after Enter it answered 4. That negative is what makes the contract below meaningful — without it the fixture would report `ring_capability: unsupported` and the bell would never be exercised at all."
  }
```

Two measured facts behind that pattern, both worth keeping in the fixture rather than rediscovering:

* `#{C/r:}` searches the pane's **visible** content only, not its scrollback. Verified on tmux 3.4:
  a pane with `history_size` 26 answered **0** for a marker that was in history and off-screen, and
  14 for a string on the visible screen. So an old `> ` line scrolled out of view cannot produce a
  false "composer empty" — which is the failure mode this whole design would otherwise have.
* tmux trims trailing whitespace off a rendered line, so the pattern must not end in `\s` — the
  guard `assertTmuxPattern` (extracted in this branch, and now called for `composer` too) refuses
  one that does.

---

## 2. Line 85 — **INVERT it, do not delete it**

**Context — `tests/contract/topology-tmux.test.mjs:83-85`:**

```js
    const sent = JSON.parse(await ao(["send", "--run", runDir, "--from", "conductor", "--to", "worker-a,worker-b", "--stage", "ping", "--body", "PING please"], env));
    assert.equal(sent.id, "001-ping");
    assert.ok(sent.delivered.every((item) => item.rang === false && item.notification === 'durable-pending')); // fixture polls its inbox
```

That line asserts the TM-127 regression **as though it were the contract**: it pins "the bell never
rings" in place. Deleting it is not the fix either — a bell that silently stops ringing is the same
failure class TM-130 exists to eliminate, and with no assertion here nobody would notice.

**Change:**

```js
    const sent = JSON.parse(await ao(["send", "--run", runDir, "--from", "conductor", "--to", "worker-a,worker-b", "--stage", "ping", "--body", "PING please"], env));
    assert.equal(sent.id, "001-ping");
    // INVERTED from the TM-127 regression, which asserted `rang === false && durable-pending` — the
    // bell not ringing — as if that were the contract. It is the bug. The fixture still polls its
    // inbox, so the reply would arrive either way; what is pinned here is that the doorbell was
    // OBSERVED to work: the pointer was typed, the composer emptied again, and the state machine
    // says so in its own words rather than the caller assuming it.
    assert.ok(sent.delivered.every((item) => item.rang === true), JSON.stringify(sent.delivered, null, 2));
    assert.ok(sent.delivered.every((item) => item.notification === 'submitted'), JSON.stringify(sent.delivered, null, 2));
    for (const item of sent.delivered) {
      assert.equal(item.delivery.state, "submitted");
      assert.equal(item.delivery.ring_capability, "supported");
      assert.equal(item.delivery.composer_empty_after, true);
      assert.equal(item.delivery.typed, true);
      assert.equal(item.delivery.escalated, false);
      assert.deepEqual(item.delivery.rungs, ["retype"], "a healthy pane needs exactly one rung");
    }
    // Additive, not replaced: every key `delivered[]` carried before still carries it.
    assert.ok(sent.delivered.every((item) => typeof item.agent === "string"));
```

---

## 3. `--no-ring` — assert it now does something

**Context — `tests/contract/topology-tmux.test.mjs:101`** (the flag is already passed here, and has
never been implemented in the `send` body):

```js
    const sent2 = JSON.parse(await ao(["send", "--run", runDir, "--from", "conductor", "--to", "worker-b", "--stage", "again", "--body", "PING again", "--no-ring"], env));
```

**Add after it:**

```js
    // --no-ring has sat in USAGE, in this file and in tests/live/two-projects.sh since `send` was
    // written, and the body never read it. It is implemented now, so assert the difference.
    assert.ok(sent2.delivered.every((item) => item.rang === false && item.notification === 'ring-skipped'), JSON.stringify(sent2.delivered, null, 2));
    assert.ok(sent2.delivered.every((item) => item.delivery.escalated === false), "a skipped ring is never an escalation");
```

---

## 4. New contract — a deaf pane escalates instead of reporting success

`tests/fixtures/deaf-pane.mjs` exists for exactly this: a pane that is ON but takes the terminal
into raw mode, so the tty echo is off and typed text vanishes with no error. That is TM-126.
`tests/unit/topology-launch.test.mjs:845` already proves `deliverPointer` detects it; this proves
the whole `send` path turns that detection into an escalation a human can see.

**Add as a new test in this file (after the main launch→send→wait test):**

```js
test("a message rung at a deaf pane escalates rather than reporting a delivery", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const { runDir, env, session, root } = await launchFixtureRun(t); // same helper the test above uses
  const worker = JSON.parse(await ao(["status", "--run", runDir, "--json"], env)).agents.find((a) => a.id === "worker-a");

  // Replace the agent's process with one that takes the terminal and never echoes. The pane stays
  // ALIVE and its composer is empty, so every liveness check passes — this is precisely the state
  // in which the old code typed a pointer and reported success.
  await promisify(execFile)("tmux", ["respawn-pane", "-k", "-t", worker.pane, `${process.execPath} ${join(root, "tests", "fixtures", "deaf-pane.mjs")}`]);
  await new Promise((resolve) => setTimeout(resolve, 800));

  const result = await aoAllowingFailure(["send", "--run", runDir, "--from", "conductor", "--to", "worker-a", "--stage", "deaf", "--body", "PING deaf"], env);
  const sent = JSON.parse(result.stdout);
  const item = sent.delivered.find((entry) => entry.agent === "worker-a");
  assert.equal(item.rang, false);
  assert.equal(item.notification, "ring-failed");
  assert.equal(item.delivery.state, "not-typed");
  assert.equal(item.delivery.escalated, true);
  // exit 3 is for exactly this: the pane was judged safe and the pointer still did not land.
  assert.equal(result.code, 3, "a safe pane that swallowed the pointer is exit 3, not exit 0");

  // Never silent. The journal carries it and `status` says which message is stuck and why.
  const journal = JSON.parse(await ao(["journal", "--run", runDir, "--limit", "200"], env));
  assert.ok(journal.some((event) => event.type === "message.undelivered" && event.agent === "worker-a"));
  const status = JSON.parse(await ao(["status", "--run", runDir, "--json"], env));
  assert.equal(status.undelivered.length, 1);
  assert.equal(status.undelivered[0].agent, "worker-a");
  assert.match(await ao(["status", "--run", runDir], env), /! UNDELIVERED/);

  // And the message of record is untouched: the file is there, and nothing re-sent it.
  const inbox = await readdir(join(runDir, "agents", "worker-a", "inbox"));
  assert.equal(inbox.filter((name) => name.includes("-deaf")).length, 1);
});
```

Two helpers this needs and the file does not have yet:

* `launchFixtureRun(t)` — extract the existing launch block from the first test rather than
  duplicating it. The current test does it inline; the extraction is mechanical.
* `aoAllowingFailure(args, env)` — the existing `ao()` throws on a non-zero exit, which is now a
  legitimate outcome (`exit 3`). It needs a sibling that returns `{ code, stdout, stderr }`.

---

## 5. New contract — a stuck composer is resubmitted, never re-typed

The TM-121 family: the pointer lands in the composer and sits there. The fixture cannot be made to
do that by itself (it consumes a line as soon as one arrives), so drive the pane with a process that
echoes what it is given and never consumes a submit — `cat` with the tty echo left ON does exactly
that, and its screen then reads `> <pointer>` with no bare `>` line, which is `typed-unsubmitted`.

```js
test("a pointer stuck in the composer is resubmitted with the submit key alone, never re-typed", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const { runDir, env } = await launchFixtureRun(t);
  const worker = JSON.parse(await ao(["status", "--run", runDir, "--json"], env)).agents.find((a) => a.id === "worker-a");
  // A pane that echoes and never redraws a fresh prompt: whatever is typed stays on the composer
  // line forever, which is what a TUI with a full composer looks like from the outside.
  await promisify(execFile)("tmux", ["respawn-pane", "-k", "-t", worker.pane, `sh -c 'printf "> "; cat > /dev/null'`]);
  await new Promise((resolve) => setTimeout(resolve, 800));

  const result = await aoAllowingFailure(["send", "--run", runDir, "--from", "conductor", "--to", "worker-a", "--stage", "stuck", "--body", "PING stuck"], env);
  const item = JSON.parse(result.stdout).delivered.find((entry) => entry.agent === "worker-a");
  assert.equal(item.notification, "stuck-in-composer");
  assert.equal(item.delivery.state, "typed-unsubmitted");
  assert.equal(item.delivery.typed, true);
  assert.equal(item.delivery.escalated, true);
  assert.equal(result.code, 3);
  // The ladder is cheapest-rung-first and it never re-types: re-typing would append a SECOND copy
  // of the pointer to the draft already sitting in the composer, and the agent would read a
  // doubled message. One `retype` (the initial delivery), then submit keys alone.
  assert.deepEqual(item.delivery.rungs.slice(0, 3), ["retype", "resubmit", "resubmit"]);
  assert.equal(item.delivery.rungs.filter((rung) => rung === "retype").length, 1);
  const screen = await ao(["capture", "--run", runDir, "--agent", "worker-a", "--lines", "40"], env);
  assert.equal(screen.split("[ao] Message").length - 1, 1, "the pointer appears on the pane exactly once");
});
```

The last assertion is the one that matters most in this file. It is cheap, it is direct evidence,
and it is what a future refactor of `nextDeliveryRung` would break first.
