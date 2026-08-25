#!/usr/bin/env node
/**
 * Vendor and verify a ByteDesk design-system payload in a consumer repository.
 *
 * This file is authored and tested here, then copied into the marketplace
 * plugin by publish-plugin.mjs. It intentionally uses only Node built-ins.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payloadDir = path.join(pluginRoot, "payload");
const DEFAULT_DIR = ".context/design-system";
const STATE_FILE = ".design-system.json";
const SOURCE_FILE = ".source-sha";
const PAYLOAD_MANIFEST = ".payload-manifest.json";
const MANAGED_FILE = ".managed-files.json";
const EXIT = Object.freeze({ healthy: 0, drift: 1, misconfigured: 2, failure: 3 });
const METADATA_FILES = new Set([STATE_FILE, SOURCE_FILE, MANAGED_FILE, "README.md"]);
const SKIP_SCAN_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  "out",
]);
const SCAN_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".go",
  ".rs",
  ".json",
  ".md",
  ".mjs",
  ".js",
  ".ts",
  ".tsx",
  ".toml",
  ".yaml",
  ".yml",
]);

class UsageError extends Error {}
class PayloadError extends Error {}

function usage() {
  return [
    "Usage: design-system-sync [--app <slug>] [--dir <path>] [--check|--doctor|--dry-run]",
    "",
    "Options:",
    "  --app <slug>   product profile to vendor; remembered after the first sync",
    `  --dir <path>   managed destination (default: ${DEFAULT_DIR})`,
    "  --check        verify managed content; write nothing",
    "  --doctor       verify content and consumer integration; write nothing",
    "  --dry-run      print the exact add/change/delete plan; write nothing",
    "  --help         print this usage",
    "",
    "Exit codes: 0 healthy, 1 content drift, 2 consumer misconfiguration, 3 tool/payload failure.",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = {
    app: null,
    dir: DEFAULT_DIR,
    check: false,
    doctor: false,
    dryRun: false,
    migrationPreview: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--check") {
      opts.check = true;
    } else if (arg === "--doctor") {
      opts.doctor = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--migration-preview") {
      opts.migrationPreview = true;
    } else if (arg === "--app" || arg === "--dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      opts[arg === "--app" ? "app" : "dir"] = value;
      index += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  const modes = [opts.check, opts.doctor, opts.dryRun].filter(Boolean).length;
  if (modes > 1) throw new UsageError("choose only one of --check, --doctor, or --dry-run");
  if (opts.migrationPreview && !opts.dryRun) throw new UsageError("--migration-preview requires --dry-run");
  if (opts.app && !/^[a-z][a-z0-9-]*$/.test(opts.app)) {
    throw new UsageError(`app must be lowercase kebab-case: ${opts.app}`);
  }
  return opts;
}

function posix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function safeRelative(relativePath, label = "path") {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new PayloadError(`unsafe ${label}: ${relativePath}`);
  }
  return posix(path.normalize(relativePath));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(file, ErrorType, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new ErrorType(`${label} is not readable JSON (${file}): ${error.message}`);
  }
}

async function walkFiles(root, prefix = "", skipDirectories = new Set()) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirectories.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(absolute, relative, skipDirectories)));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

async function loadPayload() {
  if (!existsSync(payloadDir)) throw new PayloadError(`plugin payload missing at ${payloadDir}`);
  const manifestPath = path.join(payloadDir, PAYLOAD_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new PayloadError(`payload manifest missing at ${manifestPath}; republish the plugin`);
  }
  const manifest = await readJson(manifestPath, PayloadError, "payload manifest");
  if (manifest.schemaVersion !== 1) throw new PayloadError("payload manifest schemaVersion must be 1");
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceSha ?? "")) {
    throw new PayloadError("payload manifest sourceSha must be a full Git SHA");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new PayloadError("payload manifest files must be a non-empty array");
  }
  const sourceSha = (await readFile(path.join(payloadDir, SOURCE_FILE), "utf8")).trim();
  if (sourceSha !== manifest.sourceSha) {
    throw new PayloadError(`${SOURCE_FILE} does not match ${PAYLOAD_MANIFEST}`);
  }

  const seen = new Set();
  const files = [];
  for (const item of manifest.files) {
    const relative = safeRelative(item.path, "payload file path");
    if (seen.has(relative)) throw new PayloadError(`duplicate payload file: ${relative}`);
    seen.add(relative);
    if (!/^[0-9a-f]{64}$/.test(item.sha256 ?? "")) {
      throw new PayloadError(`invalid payload checksum for ${relative}`);
    }
    const absolute = path.join(payloadDir, relative);
    if (!existsSync(absolute)) throw new PayloadError(`payload file is missing: ${relative}`);
    const bytes = await readFile(absolute);
    const checksum = sha256(bytes);
    if (checksum !== item.sha256) throw new PayloadError(`payload checksum mismatch: ${relative}`);
    files.push({ path: relative, sha256: checksum, size: bytes.length, bytes });
  }
  const manifested = new Set(files.map((file) => file.path));
  for (const relative of await walkFiles(payloadDir)) {
    if (relative === SOURCE_FILE || relative === PAYLOAD_MANIFEST) continue;
    if (!manifested.has(relative)) throw new PayloadError(`unmanifested payload file: ${relative}`);
  }
  const apps = [...new Set(files.flatMap((file) => {
    const match = /^profiles\/([^/]+)\//.exec(file.path);
    return match && !match[1].startsWith("_") ? [match[1]] : [];
  }))].sort();
  return { sourceSha, files, apps };
}

function resolveDestination(cwd, requested) {
  const destination = path.resolve(cwd, requested);
  const relative = path.relative(cwd, destination);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UsageError(`--dir must resolve to a child of the consumer repository: ${requested}`);
  }
  if (relative.split(path.sep).includes(".git")) {
    throw new UsageError(`--dir cannot be inside .git: ${requested}`);
  }
  return destination;
}

async function readConsumerState(destDir, required = false) {
  const statePath = path.join(destDir, STATE_FILE);
  if (!existsSync(statePath)) {
    if (required) throw new UsageError(`no app configured in ${statePath}; pass --app <slug>`);
    return null;
  }
  const state = await readJson(statePath, UsageError, "consumer state");
  if (!state || typeof state.app !== "string" || !state.app) {
    throw new UsageError(`${statePath} does not name an app; pass --app <slug>`);
  }
  return state;
}

function resolveApp(opts, state, payload) {
  const app = opts.app ?? state?.app;
  if (!app) throw new UsageError(`no app configured; pass --app <slug> (known: ${payload.apps.join(", ")})`);
  if (!payload.apps.includes(app)) {
    throw new UsageError(`unknown app "${app}"; known apps: ${payload.apps.join(", ")}`);
  }
  if ((opts.check || opts.doctor) && opts.app && state?.app && opts.app !== state.app) {
    throw new UsageError(`selected app "${opts.app}" does not match configured app "${state.app}"`);
  }
  return app;
}

function selectPayloadFiles(payload, app) {
  return payload.files.filter((file) => {
    if (!file.path.startsWith("profiles/")) return true;
    return file.path.startsWith(`profiles/${app}/`);
  });
}

function readmeStamp(app, sourceSha, files) {
  return [
    "# Managed ByteDesk design system",
    "",
    "Managed by the ByteDesk design plugin. Do not edit files in this directory.",
    "Author changes in `ByteDeskAI/design-system`, publish the plugin, then sync.",
    "",
    `- app: \`${app}\``,
    `- source commit: \`${sourceSha}\``,
    `- managed files: ${files.length}`,
    "",
    "Verify integrity:",
    "",
    "```bash",
    "node <plugin>/scripts/design-system-sync.mjs --check",
    "```",
    "",
  ].join("\n");
}

function desiredTree(payload, app, previousState = null) {
  const selected = selectPayloadFiles(payload, app);
  const managed = {
    schemaVersion: 1,
    sourceSha: payload.sourceSha,
    app,
    files: selected.map(({ path: filePath, sha256: checksum, size }) => ({
      path: filePath,
      sha256: checksum,
      size,
    })),
  };
  const state = {
    ...(previousState ?? {}),
    schemaVersion: 1,
    app,
    sourceSha: payload.sourceSha,
  };
  const desired = new Map(selected.map((file) => [file.path, file.bytes]));
  desired.set(SOURCE_FILE, Buffer.from(`${payload.sourceSha}\n`));
  desired.set(STATE_FILE, Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
  desired.set(MANAGED_FILE, Buffer.from(`${JSON.stringify(managed, null, 2)}\n`));
  desired.set("README.md", Buffer.from(readmeStamp(app, payload.sourceSha, selected)));
  return { desired, selected, managed, state };
}

async function ensureDestinationCanBeManaged(destDir, state) {
  if (!existsSync(destDir)) return;
  if (existsSync(path.join(destDir, ".git"))) {
    throw new UsageError(`${destDir} is a Git checkout or submodule; run the explicit migration workflow first`);
  }
  const files = await walkFiles(destDir);
  if (files.length === 0) return;
  const legacyManaged = state && existsSync(path.join(destDir, SOURCE_FILE));
  if (!existsSync(path.join(destDir, MANAGED_FILE)) && !legacyManaged) {
    throw new UsageError(`${destDir} is non-empty and not managed; choose another --dir or migrate it explicitly`);
  }
}

async function planChanges(destDir, desired) {
  const current = await walkFiles(destDir, "", new Set([".git"]));
  const changes = [];
  for (const [relative, bytes] of desired) {
    const absolute = path.join(destDir, relative);
    if (!existsSync(absolute)) {
      changes.push({ action: "ADD", path: relative });
    } else if (sha256(await readFile(absolute)) !== sha256(bytes)) {
      changes.push({ action: "CHANGE", path: relative });
    }
  }
  for (const relative of current) {
    if (!desired.has(relative)) changes.push({ action: "DELETE", path: relative });
  }
  const order = { ADD: 0, CHANGE: 1, DELETE: 2 };
  return changes.sort((a, b) => order[a.action] - order[b.action] || a.path.localeCompare(b.path));
}

async function envrcPlan(cwd, destDir, app) {
  const envrc = path.join(cwd, ".envrc");
  const profileDir = path.join(destDir, "profiles", app);
  const relative = path.relative(cwd, profileDir);
  const contextDir = relative && !relative.startsWith("..") ? posix(relative) : posix(profileDir);
  const line = `export IMPECCABLE_CONTEXT_DIR=${contextDir}`;
  const current = existsSync(envrc) ? await readFile(envrc, "utf8") : "";
  const present = current.split(/\r?\n/).some((entry) => entry.trim() === line);
  return { needed: !present, envrc, line, current };
}

function printPlan(destDir, changes, envrc) {
  process.stdout.write(`design-system plan: ${destDir}\n`);
  if (changes.length === 0 && !envrc.needed) {
    process.stdout.write("  NO CHANGES\n");
    return;
  }
  for (const change of changes) process.stdout.write(`  ${change.action.padEnd(6)} ${change.path}\n`);
  if (envrc.needed) process.stdout.write(`  UPDATE .envrc (${envrc.line})\n`);
}

async function applyAtomic(destDir, desired) {
  const parent = path.dirname(destDir);
  const name = path.basename(destDir);
  const nonce = `${process.pid}-${randomUUID()}`;
  const stage = path.join(parent, `.${name}.stage-${nonce}`);
  const backup = path.join(parent, `.${name}.backup-${nonce}`);
  await mkdir(stage, { recursive: true });
  let movedExisting = false;
  try {
    for (const [relative, bytes] of desired) {
      const target = path.join(stage, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    if (existsSync(destDir)) {
      await renameWithRetry(destDir, backup);
      movedExisting = true;
    }
    if (process.env.BYTEDESK_DESIGN_SYNC_TEST_FAIL === "after-backup") {
      throw new Error("injected sync interruption after backup");
    }
    await renameWithRetry(stage, destDir);
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (movedExisting && existsSync(backup)) {
      if (existsSync(destDir)) await rm(destDir, { recursive: true, force: true });
      await renameWithRetry(backup, destDir);
    }
    throw error;
  }
}

async function renameWithRetry(source, destination) {
  const transient = new Set(["EACCES", "EBUSY", "EPERM"]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (process.platform !== "win32" || !transient.has(error.code) || attempt >= 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
    }
  }
}

async function applyEnvrc(envrc) {
  if (!envrc.needed) return;
  const prefix = envrc.current && !envrc.current.endsWith("\n") ? `${envrc.current}\n` : envrc.current;
  await writeFile(envrc.envrc, `${prefix}${envrc.line}\n`);
}

async function inspectManaged(destDir, payload, app) {
  const drift = [];
  const configuration = [];
  const statePath = path.join(destDir, STATE_FILE);
  const managedPath = path.join(destDir, MANAGED_FILE);
  if (!existsSync(statePath)) configuration.push(`${STATE_FILE} is missing`);
  if (!existsSync(managedPath)) configuration.push(`${MANAGED_FILE} is missing; run sync once`);
  if (configuration.length > 0) return { drift, configuration };

  const state = await readJson(statePath, UsageError, "consumer state");
  const managed = await readJson(managedPath, UsageError, "managed-file state");
  if (state.app !== app) configuration.push(`configured app is ${state.app}, expected ${app}`);
  if (managed.schemaVersion !== 1) configuration.push(`${MANAGED_FILE} schemaVersion must be 1`);
  if (managed.app !== app) configuration.push(`${MANAGED_FILE} app is ${managed.app}, expected ${app}`);
  if (state.sourceSha !== payload.sourceSha) {
    drift.push(`consumer source ${state.sourceSha ?? "missing"} != payload ${payload.sourceSha}`);
  }
  if (managed.sourceSha !== payload.sourceSha) {
    drift.push(`managed source ${managed.sourceSha ?? "missing"} != payload ${payload.sourceSha}`);
  }

  const selected = selectPayloadFiles(payload, app);
  const expected = new Map(selected.map((file) => [file.path, file.sha256]));
  const recorded = new Map();
  if (!Array.isArray(managed.files)) {
    configuration.push(`${MANAGED_FILE} files must be an array`);
  } else {
    for (const item of managed.files) {
      let relative;
      try {
        relative = safeRelative(item.path, "managed file path");
      } catch (error) {
        configuration.push(error.message);
        continue;
      }
      recorded.set(relative, item.sha256);
    }
  }
  for (const [relative, checksum] of expected) {
    if (!recorded.has(relative)) drift.push(`managed record missing: ${relative}`);
    else if (recorded.get(relative) !== checksum) drift.push(`managed checksum is stale: ${relative}`);
    const absolute = path.join(destDir, relative);
    if (!existsSync(absolute)) drift.push(`managed file missing: ${relative}`);
    else if (sha256(await readFile(absolute)) !== checksum) drift.push(`managed file corrupted: ${relative}`);
  }
  for (const relative of recorded.keys()) {
    if (!expected.has(relative)) drift.push(`stale managed record: ${relative}`);
  }
  const allowed = new Set([...expected.keys(), ...METADATA_FILES]);
  for (const relative of await walkFiles(destDir)) {
    if (!allowed.has(relative)) drift.push(`unexpected file in managed tree: ${relative}`);
  }
  const sourcePath = path.join(destDir, SOURCE_FILE);
  if (!existsSync(sourcePath)) drift.push(`${SOURCE_FILE} is missing`);
  else if ((await readFile(sourcePath, "utf8")).trim() !== payload.sourceSha) {
    drift.push(`${SOURCE_FILE} does not match payload source`);
  }
  return { drift: [...new Set(drift)], configuration: [...new Set(configuration)] };
}

async function scanRepository(cwd, destDir) {
  const files = await walkFiles(cwd, "", SKIP_SCAN_DIRS);
  const destRelative = posix(path.relative(cwd, destDir));
  const texts = [];
  for (const relative of files) {
    if (destRelative && !destRelative.startsWith("..") && (relative === destRelative || relative.startsWith(`${destRelative}/`))) continue;
    if (!SCAN_EXTENSIONS.has(path.extname(relative)) && !["AGENTS.md", "DESIGN.md"].includes(path.basename(relative))) continue;
    const absolute = path.join(cwd, relative);
    if ((await stat(absolute)).size > 2 * 1024 * 1024) continue;
    try {
      texts.push({ path: relative, text: await readFile(absolute, "utf8") });
    } catch {
      // A repository scan is advisory. Unreadable candidate files are skipped.
    }
  }
  return texts;
}

function integrationChecks(cwd, destDir, app, texts) {
  const checks = [];
  const runtime = existsSync(path.join(cwd, "package.json"))
    ? "web"
    : existsSync(path.join(cwd, "go.mod"))
      ? "go-embedded"
      : existsSync(path.join(cwd, "Cargo.toml"))
        ? "native"
        : "unknown";
  const has = (predicate) => texts.some((file) => predicate(file.text, file.path));
  let tokenWired = false;
  if (runtime === "web") {
    tokenWired = has((text, filePath) => /\.(css|scss|sass|less)$/.test(filePath) && text.includes("tokens/css/bytedesk.css"));
  } else if (runtime === "go-embedded") {
    tokenWired = has((text) => text.includes("bytedesk.css") || text.includes("ByteDeskAI/design-system"));
  } else if (runtime === "native") {
    tokenWired = has((text) => text.includes("bytedesk.tokens.json"));
  } else {
    tokenWired = has((text) => text.includes("tokens/css/bytedesk.css") || text.includes("bytedesk.tokens.json"));
  }
  checks.push({
    ok: tokenWired,
    label: `runtime adapter (${runtime})`,
    fix: runtime === "web"
      ? "import .context/design-system/tokens/css/bytedesk.css from the root stylesheet"
      : runtime === "go-embedded"
        ? "add a build step that inlines the managed CSS and stamps its source revision"
        : runtime === "native"
          ? "map the managed tokens/bytedesk.tokens.json into the native theme"
          : "declare and wire a supported runtime adapter",
  });

  const localDesign = texts.find((file) => file.path === "DESIGN.md")?.text ?? "";
  checks.push({
    ok: localDesign.includes("design-system/DESIGN.md") && localDesign.includes(`profiles/${app}/DESIGN.md`),
    label: "local DESIGN.md adapter",
    fix: `make DESIGN.md inherit .context/design-system/DESIGN.md and profiles/${app}/DESIGN.md`,
  });
  const agents = texts.find((file) => file.path === "AGENTS.md")?.text ?? "";
  checks.push({
    ok: agents.includes("design-system/DESIGN.md") && agents.includes(`profiles/${app}/DESIGN.md`),
    label: "AGENTS.md instruction chain",
    fix: `add the shared foundation, profiles/${app}, and local adapter reading order to AGENTS.md`,
  });
  const workflowTexts = texts.filter((file) => file.path.startsWith(".github/workflows/"));
  checks.push({
    ok: workflowTexts.some((file) => (
      (file.text.includes("design-system-sync.mjs") && file.text.includes("--check"))
      || file.text.includes("design-system-check.mjs")
    )),
    label: "CI drift gate",
    fix: "add the standalone .bytedesk/design-system-check.mjs integrity gate to a pull-request workflow",
  });
  return checks;
}

async function runDoctor(cwd, destDir, payload, app) {
  const inspection = await inspectManaged(destDir, payload, app);
  if (inspection.drift.length === 0 && inspection.configuration.length === 0) {
    process.stdout.write(`OK managed payload (${payload.sourceSha})\n`);
  } else {
    for (const finding of inspection.drift) process.stdout.write(`DRIFT ${finding}\n`);
    for (const finding of inspection.configuration) process.stdout.write(`ERROR ${finding}\n`);
  }
  const checks = integrationChecks(cwd, destDir, app, await scanRepository(cwd, destDir));
  for (const check of checks) {
    process.stdout.write(check.ok ? `OK ${check.label}\n` : `ERROR ${check.label}; fix: ${check.fix}\n`);
  }
  if (inspection.drift.length > 0) return EXIT.drift;
  if (inspection.configuration.length > 0 || checks.some((check) => !check.ok)) return EXIT.misconfigured;
  return EXIT.healthy;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return EXIT.healthy;
  }
  const payload = await loadPayload();
  const cwd = process.cwd();
  const destDir = resolveDestination(cwd, opts.dir);
  const state = await readConsumerState(destDir, false);
  const app = resolveApp(opts, state, payload);

  if (opts.check) {
    const inspection = await inspectManaged(destDir, payload, app);
    for (const finding of inspection.drift) process.stderr.write(`design-system drift: ${finding}\n`);
    for (const finding of inspection.configuration) process.stderr.write(`design-system configuration: ${finding}\n`);
    if (inspection.configuration.length > 0) return EXIT.misconfigured;
    if (inspection.drift.length > 0) return EXIT.drift;
    process.stdout.write(`design-system healthy: app=${app} source=${payload.sourceSha}\n`);
    return EXIT.healthy;
  }
  if (opts.doctor) return runDoctor(cwd, destDir, payload, app);

  if (!opts.migrationPreview) await ensureDestinationCanBeManaged(destDir, state);
  const tree = desiredTree(payload, app, state);
  const changes = await planChanges(destDir, tree.desired);
  const envrc = await envrcPlan(cwd, destDir, app);
  printPlan(posix(path.relative(cwd, destDir)) || posix(opts.dir), changes, envrc);
  if (opts.dryRun) return EXIT.healthy;
  if (changes.length > 0) await applyAtomic(destDir, tree.desired);
  await applyEnvrc(envrc);
  process.stdout.write(`design-system synced: app=${app} source=${payload.sourceSha} files=${tree.selected.length}\n`);
  return EXIT.healthy;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`design-system-sync: ${error.message}\n\n${usage()}\n`);
    process.exitCode = EXIT.misconfigured;
  } else if (error instanceof PayloadError) {
    process.stderr.write(`design-system-sync: payload failure: ${error.message}\n`);
    process.exitCode = EXIT.failure;
  } else {
    process.stderr.write(`design-system-sync: ${error.stack || error.message}\n`);
    process.exitCode = EXIT.failure;
  }
}
