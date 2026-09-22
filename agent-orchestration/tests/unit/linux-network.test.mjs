import assert from "node:assert/strict";
import test from "node:test";
import { linuxNetworkCommand } from "../../src/platform/linux-network.mjs";

test("Linux network attachment refuses missing, malformed, or unbound namespace identities", () => {
  for (const info of [null, {}, { "child-pid": 1 }, { "child-pid": "1", "net-namespace": 2 },
    { "child-pid": 1, "net-namespace": 0 }, { "child-pid": 1, "net-namespace": "2; touch /tmp/no" },
    { "child-pid": -1, "net-namespace": 2 }, { "child-pid": 1, "net-namespace": Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => linuxNetworkCommand(info), { code: "AO_SANDBOX_NAMESPACE_IDENTITY_MISSING" });
  }
});

test("Linux namespace identities remain arguments to a fixed isolated launcher", () => {
  const first = linuxNetworkCommand({ "child-pid": 123, "net-namespace": 456 });
  const second = linuxNetworkCommand({ "child-pid": 789, "net-namespace": 987 });
  assert.equal(first.executable, "/usr/bin/python3");
  assert.deepEqual(first.args.slice(0, 2), ["-I", "-c"]);
  assert.equal(first.args[2], second.args[2], "identities must never become program text");
  assert.deepEqual(first.args.slice(3), ["123", "456"]);
  assert.deepEqual(second.args.slice(3), ["789", "987"]);
});
