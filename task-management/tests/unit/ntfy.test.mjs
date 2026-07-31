/**
 * ntfy push notifications, fired hook-side so they arrive with no browser open
 * and no dashboard running — the whole point being a phone buzzing while you are
 * away from the machine.
 *
 * The rules that matter: never throw (a notifier must not break a hook or fail a
 * `tm` command), never fire for a category that is switched off, and never keep
 * a secret in the git-tracked config file.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import {
  CATALOG,
  headersFor,
  categoryOf,
  messageFor,
  ntfyConfig,
  shouldPublish,
  topicUrl,
} from "../../lib/ntfy.mjs";
import { config, writeConfig } from "../../lib/store.mjs";

const stores = [];
function store(ntfy = {}) {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ ntfy: { enabled: true, server: "https://ntfy.example", topic: "tm-test", ...ntfy } }, p);
  return p;
}
after(() => cleanup(...stores));

const ENV = { TM_NTFY_TOKEN: "tk_test", TM_NTFY_SERVER: undefined, TM_NTFY_TOPIC: undefined };

/**
 * Every event name the store can log, scanned out of lib/ and bin/.
 *
 * Takes the first argument of each logEvent call and pulls every quoted name out of it, so the
 * ternary form — `logEvent(created ? "decision_captured" : "decision_updated", …)` — is caught
 * too. A regex anchored on `logEvent("name"` misses that one and then reports it as a stale
 * catalog entry, which is a false accusation rather than a missing test.
 */
function emittedEvents() {
  const root = new URL("../../", import.meta.url);
  const names = new Set();
  // Recursive: lib/ grew subdirectories (lib/harness/), and a flat scan both missed the events
  // emitted there and died with EISDIR trying to read the directory as a file.
  const files = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(new URL(`${e.name}/`, d)) : [new URL(e.name, d)],
    );
  for (const dir of ["lib", "bin"]) {
    const d = new URL(`${dir}/`, root);
    for (const file of files(d)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/logEvent\(/g)) {
        // Walk to the comma that ends the first argument, respecting nesting and strings.
        let i = m.index + m[0].length;
        let depth = 0;
        let arg = "";
        for (; i < text.length; i += 1) {
          const c = text[i];
          if (c === "(" || c === "[" || c === "{") depth += 1;
          else if (c === ")" || c === "]" || c === "}") {
            if (depth === 0) break;
            depth -= 1;
          } else if (c === "," && depth === 0) break;
          arg += c;
        }
        for (const q of arg.matchAll(/"([a-z_]+)"/g)) names.add(q[1]);
      }
    }
  }
  return names;
}

describe("catalog", () => {
  it("groups every event kind the store emits", () => {
    // Derived from the source, not hand-listed. A hardcoded list silently stops testing the
    // moment someone adds a logEvent — which is exactly what had happened: doctor_fix,
    // doctor_release and override_used were all emitted and unclassified, so they were
    // un-notifiable and invisible in the settings panel with nothing to say so.
    const emitted = emittedEvents();
    assert.ok(emitted.size > 25, `only found ${emitted.size} event names — the scan is broken`);

    const known = new Set(Object.keys(CATALOG.events));
    const missing = [...emitted].filter((e) => !known.has(e)).sort();
    assert.deepEqual(missing, [], `emitted but not in the catalog: ${missing.join(", ")}`);
  });

  it("has no catalog entry for an event nothing emits", () => {
    // The other direction: a stale entry advertises a notification that can never fire.
    const emitted = emittedEvents();
    // `notification` is logged from a hook payload, not a literal in a logEvent call.
    const exempt = new Set(["notification"]);
    const stale = Object.keys(CATALOG.events).filter((e) => !emitted.has(e) && !exempt.has(e)).sort();
    assert.deepEqual(stale, [], `in the catalog but never emitted: ${stale.join(", ")}`);
  });

  it("marks a small set as recommended and leaves writes off by default", () => {
    assert.ok(CATALOG.recommended.includes("stop_gate_blocked"));
    assert.ok(CATALOG.recommended.includes("claim_stolen"));
    assert.ok(CATALOG.writes.includes("assign"));
    assert.ok(CATALOG.writes.includes("comment"));
    assert.equal(CATALOG.recommended.some((e) => CATALOG.writes.includes(e)), false, "a kind belongs to one group");
  });

  it("gives every kind a human description for the settings panel", () => {
    for (const [kind, meta] of Object.entries(CATALOG.events)) {
      assert.ok(meta.label && meta.label.length > 3, `${kind} needs a readable label`);
      assert.ok(["recommended", "writes", "noise"].includes(meta.group), `${kind} has no group`);
    }
  });
});

describe("ntfyConfig", () => {
  it("takes the token from the environment, never from the store", () => {
    const p = store();
    const cfg = ntfyConfig(p, ENV);
    assert.equal(cfg.token, "tk_test");
    assert.equal(config(p).ntfy.token, undefined, "config.json is git-tracked — a token must never land in it");
  });

  it("lets the environment override server and topic", () => {
    const p = store();
    const cfg = ntfyConfig(p, { ...ENV, TM_NTFY_SERVER: "https://other", TM_NTFY_TOPIC: "tm-other" });
    assert.equal(cfg.server, "https://other");
    assert.equal(cfg.topic, "tm-other");
  });

  it("is disabled when there is no token, whatever the config says", () => {
    const p = store();
    assert.equal(ntfyConfig(p, { TM_NTFY_TOKEN: undefined }).enabled, false, "enabled with no credential is a lie");
  });
});

describe("shouldPublish", () => {
  it("fires for a category that is switched on", () => {
    const p = store({ categories: ["claim_stolen"] });
    assert.equal(shouldPublish({ event: "claim_stolen", id: "TM-1" }, ntfyConfig(p, ENV)).ok, true);
  });

  it("stays silent for a category that is switched off", () => {
    const p = store({ categories: ["claim_stolen"] });
    const res = shouldPublish({ event: "assign", id: "TM-1" }, ntfyConfig(p, ENV));
    assert.equal(res.ok, false);
    assert.match(res.reason, /not enabled/i);
  });

  it("stays silent when ntfy is switched off entirely", () => {
    const p = store({ enabled: false, categories: ["done"] });
    assert.equal(shouldPublish({ event: "done", id: "TM-1" }, ntfyConfig(p, ENV)).ok, false);
  });

  it("rate-limits repeats for the same task and kind", () => {
    const p = store({ categories: ["update"], minIntervalSeconds: 60 });
    const cfg = ntfyConfig(p, ENV);
    const seen = new Map();
    const first = shouldPublish({ event: "update", id: "TM-1" }, cfg, { seen, now: 1000 });
    const second = shouldPublish({ event: "update", id: "TM-1" }, cfg, { seen, now: 5000 });
    const other = shouldPublish({ event: "update", id: "TM-2" }, cfg, { seen, now: 5000 });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false, "a chatty loop must not empty a phone battery");
    assert.match(second.reason, /rate/i);
    assert.equal(other.ok, true, "the limit is per task, not global");
  });

  it("never fires for an unknown event kind", () => {
    const p = store({ categories: ["invented"] });
    assert.equal(shouldPublish({ event: "invented", id: "TM-1" }, ntfyConfig(p, ENV)).ok, false);
  });
});

describe("messageFor", () => {
  it("builds a title, body, priority and tags from the event", () => {
    const p = store({ categories: ["stop_gate_blocked"] });
    const msg = messageFor({ event: "stop_gate_blocked", id: "TM-14", actor: "@mcp" }, { title: "Add cursors" }, ntfyConfig(p, ENV));
    assert.match(msg.title, /TM-14/);
    assert.match(msg.body, /Add cursors/);
    assert.equal(msg.priority, "high", "a session stuck at the exit gate is worth an interrupt");
    assert.ok(msg.tags.length > 0);
  });

  it("deep-links to the card on the project's own dashboard port", () => {
    const p = store({ categories: ["done"], boardUrl: "http://127.0.0.1:53147" });
    const msg = messageFor({ event: "done", id: "TM-9" }, null, ntfyConfig(p, ENV));
    assert.equal(msg.click, "http://127.0.0.1:53147/?task=TM-9");
  });

  it("names the actor so parallel agents are distinguishable", () => {
    const p = store({ categories: ["done"] });
    const msg = messageFor({ event: "done", id: "TM-9", actor: "@worktree" }, { title: "x" }, ntfyConfig(p, ENV));
    assert.match(msg.body, /@worktree/);
  });

  it("survives an event with no task behind it", () => {
    const p = store({ categories: ["events_rotated"] });
    assert.doesNotThrow(() => messageFor({ event: "events_rotated" }, null, ntfyConfig(p, ENV)));
  });
});

describe("headersFor", () => {
  // HTTP headers are ByteString. An em dash in a Title makes fetch throw before
  // anything leaves the machine — and `send` reports it as status 0, so it looks
  // like a network blip. Three of the six recommended labels contained one.
  it("keeps every header value inside latin-1", () => {
    const p = store({ categories: ["epic_auto_closed"] });
    const cfg = ntfyConfig(p, ENV);
    const msg = messageFor({ event: "epic_auto_closed", id: "EP-001" }, { title: "v0.2 — done" }, cfg);
    for (const [k, v] of Object.entries(headersFor(msg, cfg))) {
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[^\x00-\xFF]/.test(String(v)), `header ${k} carries a non-latin-1 character: ${v}`);
    }
  });

  it("keeps the unicode in the body, where utf-8 is legal", () => {
    const p = store({ categories: ["done"] });
    const cfg = ntfyConfig(p, ENV);
    const msg = messageFor({ event: "done", id: "TM-1" }, { title: "cursors — paginated" }, cfg);
    assert.match(msg.body, /—/, "the body is sent as utf-8 and must not be mangled");
  });

  it("survives an em dash anywhere in the catalog", () => {
    const p = store();
    const cfg = ntfyConfig(p, ENV);
    for (const kind of Object.keys(CATALOG.events)) {
      const msg = messageFor({ event: kind, id: "TM-1" }, { title: "x" }, cfg);
      for (const [k, v] of Object.entries(headersFor(msg, cfg))) {
        assert.ok(!/[^\x00-\xFF]/.test(String(v)), `${kind}: header ${k} is not sendable`);
      }
    }
  });
});

describe("topicUrl", () => {
  it("joins server and topic without doubling slashes", () => {
    assert.equal(topicUrl({ server: "https://ntfy.example/", topic: "tm-x" }), "https://ntfy.example/tm-x");
    assert.equal(topicUrl({ server: "https://ntfy.example", topic: "tm-x" }), "https://ntfy.example/tm-x");
  });
});
