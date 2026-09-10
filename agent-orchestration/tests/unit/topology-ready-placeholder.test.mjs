// TM-151. A ready Claude composer does not always render an empty box. On a session with no
// history it renders a placeholder hint — `❯ Try "fix lint errors"` — and the shipped patterns
// forbade letters after the glyph, so a healthy, idle, ready pane read as NOT READY.
//
// The cost was not a slow launch. Readiness failing means the role session is never REGISTERED, so
// `role status reviewer` reads registered:false and every governed launch refuses with
// TOPOLOGY_STARTUP_NOT_READY. Measured on live panes during the EP-018 demo: the shipped pattern
// answered 0 on two ready reviewer panes; the fixed one answered 12 on both.
//
// These cases are the strings tmux actually rendered, kept as data so a future edit to the regex
// has to explain itself against them.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const providers = join(fileURLToPath(new URL("../../providers/", import.meta.url)));
const claude = JSON.parse(await readFile(join(providers, "claude.json"), "utf8"));

/** Ready, and every one of these was on a real pane. */
const READY = [
  ['❯ Try "fix lint errors"', "the placeholder hint on a fresh reviewer session"],
  ['❯ Try "create a util logging.py that..."', "the other hint Claude rotates through"],
  ["❯  ", "an empty box: the glyph, a non-breaking space, nothing else"],
  ["│ > ", "the boxed render some widths produce"],
];

/** NOT ready, and each one is a bug that shipped before it was a test. */
const NOT_READY = [
  ["❯ read the inbox file 001-ping", "an agent mid-answer with its own text on the line"],
  ["❯ No, exit", "TM-111: the folder-trust modal, where Enter EXITS the provider"],
  ["❯ 1. Yes, and switch to BYPASS PERMISSIONS", "TM-111: the plan modal, where Enter is destructive"],
  ["  ⏵⏵ auto mode on (shift+tab to cycle)", "the status line, which is not a composer at all"],
];

for (const [field, description] of [
  ["ready.pattern", "the provider is up and accepting input"],
  ["composer.empty_pattern", "the composer is empty RIGHT NOW"],
]) {
  const [group, key] = field.split(".");
  const source = claude[group][key];

  test(`${field} — a ready composer is ready, hint or no hint (${description})`, () => {
    const re = new RegExp(source);
    for (const [line, why] of READY) {
      assert.ok(re.test(line), `${field} must match ${JSON.stringify(line)} — ${why}`);
    }
  });

  test(`${field} — the negatives still hold, TM-111 included`, () => {
    const re = new RegExp(source);
    for (const [line, why] of NOT_READY) {
      assert.ok(!re.test(line), `${field} must NOT match ${JSON.stringify(line)} — ${why}`);
    }
  });
}

test("the tmux siblings say the same thing, and stay tmux-safe", () => {
  // tmux compiles these server-side into a `#{C/r:}` format. `{`, `}`, `:` and a newline each make
  // the format parser produce something that compiles fine and matches nothing — the trap
  // `normalizeAdapter` exists to catch. Assert it here too: this file is where the patterns are
  // edited, and the guard is one module away.
  for (const source of [claude.ready.tmux_pattern, claude.composer.empty_tmux_pattern]) {
    for (const forbidden of ["{", "}", ":", "\n"]) {
      assert.ok(!source.includes(forbidden), `a tmux pattern may not contain ${JSON.stringify(forbidden)}: ${source}`);
    }
    const re = new RegExp(source);
    for (const [line, why] of READY) assert.ok(re.test(line), `tmux pattern must match ${JSON.stringify(line)} — ${why}`);
    for (const [line, why] of NOT_READY) assert.ok(!re.test(line), `tmux pattern must NOT match ${JSON.stringify(line)} — ${why}`);
  }
});

test("the hint branch is literal, not 'letters are allowed'", () => {
  // The whole point of the original pattern was that an agent's own text after the glyph means the
  // pane is busy. Widening the fix to permit letters would readmit exactly that. So the branch
  // requires the literal `Try "`, and this asserts the difference rather than trusting the author.
  const re = new RegExp(claude.ready.pattern);
  assert.ok(!re.test('❯ Trying "fix lint errors"'), "a near-miss on the literal must not be admitted");
  assert.ok(!re.test("❯ Try fix lint errors"), "the hint's opening quote is part of the literal");
  assert.ok(re.test('❯ Try "anything at all, the rest is free"'), "past the literal the hint text is unconstrained");
});
