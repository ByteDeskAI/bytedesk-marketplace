// EP-026: a test must never reach the operator's real local NATS home, with or without our preflight.
// `node --test` sets NODE_TEST_CONTEXT in every test child; localNatsHome must refuse the real default home there.
import assert from "node:assert/strict";
import test from "node:test";

import { localNatsHome } from "../../topology/lib/nats-local.mjs";

test("localNatsHome refuses the real home in a node --test process and in an AO test run", () => {
  assert.equal(localNatsHome({ AO_NATS_HOME: "/tmp/x" }), "/tmp/x");
  for (const env of [{ NODE_TEST_CONTEXT: "child-v8" }, { AO_TEST_RUN: "1" }]) {
    assert.throws(() => localNatsHome(env), (e) => { console.log("refused:", e.code); return e.code === "TOPOLOGY_TEST_REAL_NATS_HOME"; });
  }
  // outside a test (a plain operator CLI) the default is unchanged
  assert.match(localNatsHome({}), /\.bytedesk\/agent-orchestration\/nats$/);
});
