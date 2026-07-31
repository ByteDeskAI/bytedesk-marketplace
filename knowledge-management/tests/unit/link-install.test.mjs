import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, lstatSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { BIN, binDir, link, status, unlink } from "../../lib/link.mjs";
import { spawnSync } from "node:child_process";

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const KM = join(PLUGIN, "bin", "km");

describe("link install/where", () => {
  let dir;
  let prevBin;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "km-link-"));
    prevBin = process.env.KM_BIN_DIR;
    process.env.KM_BIN_DIR = dir;
  });

  after(() => {
    if (prevBin === undefined) delete process.env.KM_BIN_DIR;
    else process.env.KM_BIN_DIR = prevBin;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("status reports absent before link", () => {
    const s = status(dir);
    assert.equal(s.dir, dir);
    assert.equal(s.dirExists, true);
    assert.ok(s.entries.every((e) => e.state === "absent"));
    assert.equal(s.linked, false);
  });

  it("link creates symlinks to shipped bins", () => {
    const r = link({ dir });
    assert.equal(r.ok, true);
    assert.ok(r.created.length >= 1);
    const kmLink = join(dir, "km");
    assert.ok(existsSync(kmLink));
    assert.ok(lstatSync(kmLink).isSymbolicLink());
    assert.equal(readlinkSync(kmLink), BIN.km);
    const s = status(dir);
    assert.equal(s.linked, true);
  });

  it("refuses foreign without --force", () => {
    const foreign = join(dir, "km");
    // replace with foreign file
    rmSync(foreign, { force: true });
    writeFileSync(foreign, "#!/bin/sh\necho foreign\n");
    const r = link({ dir, force: false });
    assert.equal(r.ok, false);
    assert.match(r.reason || "", /not ours|force/i);
    // take over with force
    const r2 = link({ dir, force: true });
    assert.equal(r2.ok, true);
    assert.ok(lstatSync(foreign).isSymbolicLink());
  });

  it("unlink removes only our links", () => {
    link({ dir, force: true });
    const r = unlink(dir);
    assert.equal(r.ok, true);
    assert.ok((r.removed || []).length >= 1);
    assert.equal(status(dir).linked, false);
  });

  it("CLI where reports version and paths (real entry)", () => {
    const proj = mkdtempSync(join(tmpdir(), "km-where-"));
    const r = spawnSync(process.execPath, [KM, "where"], {
      env: { ...process.env, KM_ROOT: proj, KM_BIN_DIR: dir, KM_NO_AUTOLINK: "1" },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /version:\s*0\.1\.0/);
    assert.match(r.stdout, /root:/);
    assert.match(r.stdout, /bundle:/);
    assert.match(r.stdout, /link dir:/);
    rmSync(proj, { recursive: true, force: true });
  });

  it("CLI install --force and uninstall (real entry)", () => {
    const r = spawnSync(process.execPath, [KM, "install", "--force"], {
      env: { ...process.env, KM_BIN_DIR: dir, KM_NO_AUTOLINK: "1" },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /linked/i);
    assert.ok(existsSync(join(dir, "km")));

    const u = spawnSync(process.execPath, [KM, "uninstall"], {
      env: { ...process.env, KM_BIN_DIR: dir, KM_NO_AUTOLINK: "1" },
      encoding: "utf8",
    });
    assert.equal(u.status, 0, u.stderr);
    assert.match(u.stdout, /removed/i);
  });
});
