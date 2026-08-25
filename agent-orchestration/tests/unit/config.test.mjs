import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stateRoot, validateStateRoot } from "../../src/config.mjs";

test("stateRoot uses native Windows and Linux state locations", () => {
  assert.equal(
    stateRoot({ LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local" }, "win32", "C:\\Users\\operator"),
    "C:\\Users\\operator\\AppData\\Local\\ByteDesk\\agent-orchestration",
  );
  assert.equal(
    stateRoot({}, "win32", "C:\\Users\\operator"),
    "C:\\Users\\operator\\AppData\\Local\\ByteDesk\\agent-orchestration",
  );
  assert.equal(
    stateRoot({ XDG_STATE_HOME: "/var/lib/operator" }, "linux", "/home/operator"),
    "/var/lib/operator/bytedesk/agent-orchestration",
  );
  assert.equal(
    stateRoot({}, "linux", "/home/operator"),
    "/home/operator/.local/state/bytedesk/agent-orchestration",
  );
});

test("validateStateRoot preserves nested missing segments on every platform", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-path-test-"));
  const pluginRoot = join(root, "plugin");
  await mkdir(pluginRoot);
  try {
    const candidate = join(root, "state", "nested");
    assert.equal(validateStateRoot(candidate, pluginRoot), join(realpathSync(root), "state", "nested"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
