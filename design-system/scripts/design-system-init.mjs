#!/usr/bin/env node
/** Adopt or migrate a consumer to the installed ByteDesk design-system plugin. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncRuntime = path.join(pluginRoot, "scripts", "design-system-sync.mjs");
const checkRuntime = path.join(pluginRoot, "scripts", "design-system-check.mjs");
const payloadRoot = path.join(pluginRoot, "payload");
const managedRelative = ".context/design-system";
const START = "bytedesk-design-system:start";
const END = "bytedesk-design-system:end";

class UsageError extends Error {}

function usage() {
  return [
    "Usage: design-system-init [init|migrate] [--app <slug>] [--runtime web|go|native] [options]",
    "",
    "Options:",
    "  --app <slug>       product profile; inferred only from an exact repository/package match",
    "  --runtime <kind>   resolve repositories with multiple or nonstandard runtime markers",
    "  --stylesheet <path> web root stylesheet; required when no common path is detected",
    "  --dry-run          print the complete plan without writing",
    "  --apply            required for migrate; init applies by default",
    "  --help             print this usage",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = { command: "init", app: null, runtime: null, stylesheet: null, dryRun: false, apply: false };
  if (argv[0] === "init" || argv[0] === "migrate") opts.command = argv.shift();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--app", "--runtime", "--stylesheet"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      opts[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--apply") opts.apply = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (opts.runtime && !["web", "go", "native"].includes(opts.runtime)) throw new UsageError("--runtime must be web, go, or native");
  if (opts.app && !/^[a-z][a-z0-9-]*$/.test(opts.app)) throw new UsageError(`invalid app slug: ${opts.app}`);
  if (opts.command === "migrate" && !opts.apply) opts.dryRun = true;
  return opts;
}

function run(command, args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`.trim());
  }
  return result;
}

function posix(value) {
  return value.split(path.sep).join("/");
}

function safeRelative(value, label) {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new UsageError(`unsafe ${label}: ${value}`);
  return posix(path.normalize(value));
}

async function profiles() {
  const root = path.join(payloadRoot, "profiles");
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "_template")
    .map((entry) => entry.name)
    .sort();
}

async function resolveApp(opts, cwd, available) {
  if (opts.app) {
    if (!available.includes(opts.app)) throw new UsageError(`unknown app "${opts.app}"; available: ${available.join(", ")}`);
    return opts.app;
  }
  const configured = path.join(cwd, ".bytedesk", "design-system.json");
  if (existsSync(configured)) {
    const app = JSON.parse(await readFile(configured, "utf8")).app;
    if (available.includes(app)) return app;
  }
  const candidates = new Set();
  const names = [path.basename(cwd).toLowerCase()];
  const packageFile = path.join(cwd, "package.json");
  if (existsSync(packageFile)) {
    try { names.push(JSON.parse(await readFile(packageFile, "utf8")).name?.toLowerCase()); } catch { /* reported by runtime tooling later */ }
  }
  for (const name of names.filter(Boolean)) {
    for (const candidate of [name, name.replace(/^@[^/]+\//, ""), name.replace(/^bytedesk-/, "")]) {
      if (available.includes(candidate)) candidates.add(candidate);
    }
  }
  if (candidates.size === 1) return [...candidates][0];
  throw new UsageError(`product identity is ambiguous; pass --app <slug> (available: ${available.join(", ")})`);
}

function resolveRuntime(opts, cwd) {
  if (opts.runtime) return opts.runtime;
  const detected = [];
  if (existsSync(path.join(cwd, "package.json"))) detected.push("web");
  if (existsSync(path.join(cwd, "go.mod"))) detected.push("go");
  if (existsSync(path.join(cwd, "Cargo.toml"))) detected.push("native");
  if (detected.length !== 1) {
    throw new UsageError(detected.length === 0
      ? "runtime is not recognized; pass --runtime web|go|native"
      : `multiple runtimes detected (${detected.join(", ")}); pass --runtime`);
  }
  return detected[0];
}

function replaceBlock(original, commentStart, commentEnd, content, { prepend = false } = {}) {
  const start = `${commentStart} ${START} ${commentEnd}`;
  const end = `${commentStart} ${END} ${commentEnd}`;
  const block = `${start}\n${content.trim()}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\r?\\n?`, "m");
  const without = original.replace(pattern, "").trimEnd();
  if (prepend) return `${block}\n${without ? `\n${without}\n` : ""}`;
  return `${without ? `${without}\n\n` : ""}${block}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownBlock(app, target) {
  const heading = target === "AGENTS.md" ? "## ByteDesk design context" : "## ByteDesk design inheritance";
  return [
    heading,
    "",
    "Read design authority in this order:",
    "",
    "1. `.context/design-system/DESIGN.md`",
    `2. \`.context/design-system/profiles/${app}/DESIGN.md\` and adjacent \`PRODUCT.md\``,
    "3. This repository's root `DESIGN.md` for local implementation details and explicit exceptions",
    "",
    "Managed design-system files are read-only. Canonical changes land in `ByteDeskAI/design-system` first.",
  ].join("\n");
}

async function resolveStylesheet(opts, cwd) {
  if (opts.stylesheet) return safeRelative(opts.stylesheet, "stylesheet");
  const candidates = [
    "src/app/globals.css", "app/globals.css", "src/styles/globals.css", "styles/globals.css",
    "src/index.css", "src/app.css", "styles/app.css",
  ].filter((relative) => existsSync(path.join(cwd, relative)));
  if (candidates.length !== 1) {
    throw new UsageError(candidates.length === 0
      ? "no root stylesheet detected; pass --stylesheet <path>"
      : `multiple root stylesheets detected (${candidates.join(", ")}); pass --stylesheet`);
  }
  return candidates[0];
}

async function integrationWrites(opts, cwd, app, runtime) {
  const writes = new Map();
  const sourceSha = (await readFile(path.join(payloadRoot, ".source-sha"), "utf8")).trim();
  const pluginManifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  for (const file of ["DESIGN.md", "AGENTS.md"]) {
    const absolute = path.join(cwd, file);
    const original = existsSync(absolute) ? await readFile(absolute, "utf8") : "";
    writes.set(file, replaceBlock(original, "<!--", "-->", markdownBlock(app, file)));
  }

  const config = {
    schemaVersion: 1,
    app,
    runtime,
    managedDirectory: managedRelative,
    pluginVersion: pluginManifest.version,
    sourceSha,
  };
  writes.set(".bytedesk/design-system.json", `${JSON.stringify(config, null, 2)}\n`);
  writes.set(".bytedesk/design-system-check.mjs", await readFile(checkRuntime));
  writes.set(".github/workflows/bytedesk-design-system.yml", [
    "name: ByteDesk design system",
    "", "on:", "  pull_request:", "  push:", "    branches: [main]", "",
    "jobs:", "  integrity:", "    runs-on: ubuntu-latest", "    steps:",
    "      - uses: actions/checkout@v4", "      - uses: actions/setup-node@v4",
    "        with:", "          node-version: 22",
    "      - run: node .bytedesk/design-system-check.mjs --dir .context/design-system", "",
  ].join("\n"));

  if (runtime === "web") {
    const stylesheet = await resolveStylesheet(opts, cwd);
    const absolute = path.join(cwd, stylesheet);
    const original = existsSync(absolute) ? await readFile(absolute, "utf8") : "";
    const withoutLegacyImports = original.replace(
      /^@import\s+["'][^"']*\.context\/design-system\/tokens\/(?:css\/bytedesk\.css|tailwind\/theme\.css)["'];\s*\r?\n/gm,
      "",
    );
    const base = posix(path.relative(path.dirname(absolute), path.join(cwd, managedRelative, "tokens")));
    const packagePath = path.join(cwd, "package.json");
    const packageJson = existsSync(packagePath)
      ? JSON.parse(await readFile(packagePath, "utf8"))
      : {};
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const imports = [`@import "${base}/css/bytedesk.css";`];
    if (dependencies.tailwindcss) imports.push(`@import "${base}/tailwind/theme.css";`);
    writes.set(stylesheet, replaceBlock(withoutLegacyImports, "/*", "*/", imports.join("\n"), { prepend: true }));
    config.adapter = { kind: "css-import", path: stylesheet };
  } else if (runtime === "go") {
    const generator = goGenerator();
    writes.set("scripts/generate-bytedesk-design-tokens.mjs", generator);
    const css = (await readFile(path.join(payloadRoot, "tokens", "css", "bytedesk.css"), "utf8")).replaceAll("\r\n", "\n").trimEnd() + "\n";
    writes.set("internal/design_tokens/bytedesk_generated.go", [
      "// Code generated by scripts/generate-bytedesk-design-tokens.mjs; DO NOT EDIT.",
      `// ByteDesk design-system source: ${sourceSha}`,
      "package design_tokens", "", `const CSS = ${JSON.stringify(css)}`, "",
    ].join("\n"));
    config.adapter = { kind: "go-css-inline", generator: "scripts/generate-bytedesk-design-tokens.mjs", output: "internal/design_tokens/bytedesk_generated.go" };
  } else {
    const tokenDocument = JSON.parse(await readFile(path.join(payloadRoot, "tokens", "bytedesk.tokens.json"), "utf8"));
    const availableAccents = new Set(Object.keys(tokenDocument.product ?? {}).filter((key) => !key.startsWith("$")));
    const accentCandidates = [app, app.replace(/-website$/, ""), app === "bytedesk-ai" ? "platform" : null, "platform"];
    const accent = accentCandidates.find((candidate) => candidate && availableAccents.has(candidate));
    const mapping = {
      schemaVersion: 1,
      source: ".context/design-system/tokens/bytedesk.tokens.json",
      mappings: {
        BG_BASE: "color.bg.base.$value", BG_SURFACE: "color.bg.surface.$value",
        TEXT_PRIMARY: "color.text.primary.$value", PRODUCT_ACCENT: `product.${accent}.$value`,
        RADIUS_LG: "radius.lg.$value", TYPE_BODY: "type.body.$value",
      },
    };
    writes.set(".bytedesk/design-token-map.json", `${JSON.stringify(mapping, null, 2)}\n`);
    config.adapter = { kind: "native-json-map", path: ".bytedesk/design-token-map.json" };
  }
  writes.set(".bytedesk/design-system.json", `${JSON.stringify(config, null, 2)}\n`);
  return writes;
}

function goGenerator() {
  return `import { mkdir, readFile, writeFile } from "node:fs/promises";\nimport path from "node:path";\n\nconst root = path.resolve(import.meta.dirname, "..");\nconst managed = path.join(root, ".context", "design-system");\nconst css = (await readFile(path.join(managed, "tokens", "css", "bytedesk.css"), "utf8")).replaceAll("\\r\\n", "\\n").trimEnd() + "\\n";\nconst sourceSha = (await readFile(path.join(managed, ".source-sha"), "utf8")).trim();\nif (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("invalid ByteDesk design-system source SHA");\nconst output = path.join(root, "internal", "design_tokens", "bytedesk_generated.go");\nconst generated = ["// Code generated by scripts/generate-bytedesk-design-tokens.mjs; DO NOT EDIT.", \`// ByteDesk design-system source: \${sourceSha}\`, "package design_tokens", "", \`const CSS = \${JSON.stringify(css)}\`, ""].join("\\n");\nawait mkdir(path.dirname(output), { recursive: true });\nawait writeFile(output, generated);\nprocess.stdout.write(\`generated ByteDesk token CSS from \${sourceSha}\\n\`);\n`;
}

async function planWrites(cwd, writes) {
  const changes = [];
  for (const [relative, content] of writes) {
    const absolute = path.join(cwd, relative);
    const desired = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!existsSync(absolute)) changes.push({ action: "ADD", path: relative });
    else if (!Buffer.from(await readFile(absolute)).equals(desired)) changes.push({ action: "CHANGE", path: relative });
  }
  return changes;
}

async function legacyState(cwd) {
  const dest = path.join(cwd, managedRelative);
  const gitmodules = path.join(cwd, ".gitmodules");
  const text = existsSync(gitmodules) ? await readFile(gitmodules, "utf8") : "";
  const stage = run("git", ["ls-files", "--stage", "--", managedRelative], cwd, { allowFailure: true }).stdout;
  const submodule = text.includes(managedRelative) || /^160000 /m.test(stage);
  const checkout = existsSync(path.join(dest, ".git")) && !submodule;
  const manual = existsSync(dest) && !existsSync(path.join(dest, ".design-system.json")) && !submodule && !checkout;
  return { dest, submodule, checkout, manual };
}

async function applyMigration(cwd, legacy) {
  if (!legacy.submodule && !legacy.checkout && !legacy.manual) return;
  const dirty = legacy.submodule || legacy.checkout
    ? run("git", ["-C", legacy.dest, "status", "--porcelain"], cwd, { allowFailure: true }).stdout.trim()
    : [
        run("git", ["diff", "--name-only", "--", managedRelative], cwd, { allowFailure: true }).stdout,
        run("git", ["diff", "--cached", "--name-only", "--", managedRelative], cwd, { allowFailure: true }).stdout,
        run("git", ["ls-files", "--others", "--exclude-standard", "--", managedRelative], cwd, { allowFailure: true }).stdout,
      ].join("").trim();
  if (dirty) throw new UsageError(`legacy design-system tree has local changes; preserve or commit them before migration:\n${dirty}`);
  if (legacy.submodule) {
    run("git", ["submodule", "deinit", "-f", "--", managedRelative], cwd, { allowFailure: true });
    run("git", ["rm", "-f", "--", managedRelative], cwd);
  } else {
    await rm(legacy.dest, { recursive: true, force: true });
  }
}

async function writePlanned(cwd, writes) {
  for (const [relative, content] of writes) {
    const absolute = path.join(cwd, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

function printReview(cwd) {
  const status = run("git", ["status", "--short"], cwd, { allowFailure: true }).stdout.trimEnd();
  const stat = run("git", ["diff", "--stat"], cwd, { allowFailure: true }).stdout.trimEnd();
  process.stdout.write("\nREADY FOR REVIEW\n");
  if (status) process.stdout.write(`${status}\n`);
  if (stat) process.stdout.write(`${stat}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(`${usage()}\n`); return 0; }
  if (!existsSync(syncRuntime) || !existsSync(payloadRoot)) throw new Error("installed plugin is incomplete: sync runtime or payload missing");
  const cwd = process.cwd();
  if (!existsSync(path.join(cwd, ".git"))) throw new UsageError("run from a Git repository root");
  const available = await profiles();
  const app = await resolveApp(opts, cwd, available);
  const runtime = resolveRuntime(opts, cwd);
  const legacy = await legacyState(cwd);
  if (opts.command === "init" && (legacy.submodule || legacy.checkout || legacy.manual)) throw new UsageError("legacy design-system delivery detected; run migrate --dry-run first");
  if (opts.command === "migrate" && !legacy.submodule && !legacy.checkout && !legacy.manual) process.stdout.write("migration preflight: no legacy delivery detected; continuing as init\n");
  if (legacy.submodule) process.stdout.write(`migration preflight: REMOVE git submodule ${managedRelative}\n`);
  if (legacy.checkout) process.stdout.write(`migration preflight: REPLACE nested Git checkout ${managedRelative}\n`);
  if (legacy.manual) process.stdout.write(`migration preflight: REPLACE tracked manual snapshot ${managedRelative}\n`);

  const writes = await integrationWrites(opts, cwd, app, runtime);
  const changes = await planWrites(cwd, writes);
  const syncArgs = ["--app", app];
  if (opts.dryRun) syncArgs.push("--dry-run");
  if (opts.dryRun && (legacy.submodule || legacy.checkout || legacy.manual)) syncArgs.push("--migration-preview");
  if (!legacy.submodule && !legacy.checkout && !legacy.manual || opts.dryRun) {
    const sync = run(process.execPath, [syncRuntime, ...syncArgs], cwd);
    if (sync.stdout) process.stdout.write(sync.stdout);
  }
  process.stdout.write(`consumer integration plan: app=${app} runtime=${runtime}\n`);
  if (changes.length === 0) process.stdout.write("  NO CHANGES\n");
  else for (const change of changes) process.stdout.write(`  ${change.action.padEnd(6)} ${change.path}\n`);
  if (opts.dryRun) {
    if (opts.command === "migrate") process.stdout.write("migration is read-only; rerun with --apply after reviewing this plan\n");
    return 0;
  }

  if (opts.command === "migrate" && !opts.apply) throw new UsageError("migrate requires --apply");
  await applyMigration(cwd, legacy);
  const sync = run(process.execPath, [syncRuntime, "--app", app], cwd);
  process.stdout.write(sync.stdout);
  await writePlanned(cwd, writes);
  if (runtime === "go") process.stdout.write(run(process.execPath, [path.join(cwd, "scripts", "generate-bytedesk-design-tokens.mjs")], cwd).stdout);
  const doctor = run(process.execPath, [syncRuntime, "--app", app, "--doctor"], cwd, { allowFailure: true });
  process.stdout.write(doctor.stdout);
  if (doctor.status !== 0) throw new Error(`adoption applied but doctor is not healthy (${doctor.status})\n${doctor.stderr}`.trim());
  printReview(cwd);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`design-system-init: ${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`design-system-init: ${error.message}\n`);
    process.exitCode = 3;
  }
}
