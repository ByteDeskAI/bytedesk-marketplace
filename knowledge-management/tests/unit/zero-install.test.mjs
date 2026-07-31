/**
 * Prove vendored YAML path works without resolving the npm package name "yaml".
 * Simulates post-/plugin-install where node_modules is absent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseDoc, serializeDoc } from "../../lib/yaml-doc.mjs";

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const KM = join(PLUGIN, "bin", "km");

describe("zero-install yaml", () => {
  it("yaml-doc round-trips via vendored parser (not package name yaml)", () => {
    const text = serializeDoc(
      {
        type: "Architecture",
        title: "T",
        tags: ["a", "b"],
        generated: { by: "knowledge-management/0.1.0", at: "2026-07-31T00:00:00Z" },
        sources: [{ resource: "https://example.com", title: "ex" }],
      },
      "# Body\n",
    );
    assert.match(text, /^---\n/);
    const { data, body } = parseDoc(text);
    assert.equal(data.type, "Architecture");
    assert.deepEqual(data.tags, ["a", "b"]);
    assert.equal(data.generated.by, "knowledge-management/0.1.0");
    assert.equal(data.sources[0].resource, "https://example.com");
    assert.match(body, /Body/);
  });

  it("CLI init/validate without NODE_PATH to node_modules (real entry)", () => {
    const proj = mkdtempSync(join(tmpdir(), "km-zi-"));
    // Clear NODE_PATH; run with cwd outside plugin so accidental resolution is less likely
    const env = {
      ...process.env,
      KM_ROOT: proj,
      KM_NO_AUTOLINK: "1",
      NODE_PATH: "",
    };
    delete env.NODE_PATH;
    const init = spawnSync(process.execPath, [KM, "init"], { env, encoding: "utf8", cwd: proj });
    assert.equal(init.status, 0, init.stderr + init.stdout);
    const create = spawnSync(
      process.execPath,
      [KM, "concept", "new", "ZI Concept", "--type", "Reference"],
      { env, encoding: "utf8", cwd: proj },
    );
    assert.equal(create.status, 0, create.stderr + create.stdout);
    const val = spawnSync(process.execPath, [KM, "validate"], { env, encoding: "utf8", cwd: proj });
    assert.equal(val.status, 0, val.stderr + val.stdout);
    assert.match(val.stdout, /ok/i);
    rmSync(proj, { recursive: true, force: true });
  });

  it("does not resolve bare import 'yaml' from node_modules for yaml-doc module graph", async () => {
    // Source must import vendored path
    const require = createRequire(import.meta.url);
    const fs = require("fs");
    const src = fs.readFileSync(join(PLUGIN, "lib/yaml-doc.mjs"), "utf8");
    assert.match(src, /vendor\/yaml/);
    assert.doesNotMatch(src, /from ["']yaml["']/);
  });
});
