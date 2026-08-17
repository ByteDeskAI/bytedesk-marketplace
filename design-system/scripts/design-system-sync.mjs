#!/usr/bin/env node
/**
 * design-system-sync — vendor the ByteDesk design system into a consumer repo.
 *
 * Usage:
 *   node scripts/design-system-sync.mjs --app <slug> [--dir <path>] [--check]
 *
 * Options:
 *   --app <slug>   Product slug whose profile this repo vendors. Remembered in
 *                  <dir>/.design-system.json, so later runs can omit it.
 *   --dir <path>   Vendor destination (default: .context/design-system),
 *                  relative to the current working directory.
 *   --check        Compare the vendored .source-sha with the plugin payload's
 *                  and exit 1 on drift. Writes nothing. For CI drift gates.
 *   --help         Print this usage.
 *
 * The payload ships inside the plugin, so a sync is a pure local copy: no
 * network, no access to the private design-system repository.
 *
 * Zero dependencies: Node ESM only.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payloadDir = path.join(pluginRoot, "payload");
const DEFAULT_DIR = ".context/design-system";
const STATE_FILE = ".design-system.json";
const SHA_FILE = ".source-sha";

class UsageError extends Error {}

function usage() {
  return [
    "Usage: design-system-sync --app <slug> [--dir <path>] [--check]",
    "",
    "Options:",
    "  --app <slug>   product slug to vendor the profile of",
    `  --dir <path>   vendor destination (default: ${DEFAULT_DIR})`,
    "  --check        drift gate: compare .source-sha, exit 1 on drift, write nothing",
    "  --help         print this usage",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = { app: null, dir: DEFAULT_DIR, check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--check") {
      opts.check = true;
    } else if (arg === "--app" || arg === "--dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new UsageError(`${arg} needs a value`);
      }
      opts[arg === "--app" ? "app" : "dir"] = value;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function knownApps() {
  const entries = await readdir(path.join(payloadDir, "profiles"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

async function readText(file) {
  return (await readFile(file, "utf8")).trim();
}

async function resolveApp(opts, destDir) {
  if (opts.app) return opts.app;
  const stateFile = path.join(destDir, STATE_FILE);
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      if (state && typeof state.app === "string" && state.app) return state.app;
    } catch {
      throw new UsageError(`${stateFile} is not readable JSON — pass --app <slug>`);
    }
  }
  throw new UsageError(`no app configured in ${stateFile} — pass --app <slug>`);
}

function readmeStamp(app, sourceSha) {
  return [
    "# Vendored design system",
    "",
    "Vendored by the design-system plugin's `/design-system-sync`. Do not edit —",
    "edit upstream in ByteDeskAI/design-system, re-publish, re-sync.",
    "",
    `- app: \`${app}\``,
    `- source commit: \`${sourceSha}\``,
    "",
    "Contents:",
    "",
    "- `tokens/css/bytedesk.css` — the canonical `--bd-*` custom properties.",
    "- `tokens/tailwind/theme.css` — the Tailwind v4 adapter over those tokens.",
    `- \`profiles/${app}/\` — this app's impeccable context (DESIGN.md, PRODUCT.md).`,
    "",
    "CI gates drift with:",
    "",
    "```bash",
    "node <plugin>/scripts/design-system-sync.mjs --check",
    "```",
    "",
  ].join("\n");
}

async function ensureEnvrc(cwd, contextDir) {
  const envrc = path.join(cwd, ".envrc");
  const line = `export IMPECCABLE_CONTEXT_DIR=${contextDir}`;
  let current = "";
  if (existsSync(envrc)) current = await readFile(envrc, "utf8");
  if (current.split("\n").some((entry) => entry.trim() === line)) return false;
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
  await writeFile(envrc, `${prefix}${line}\n`);
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!existsSync(payloadDir)) {
    throw new Error(`plugin payload missing at ${payloadDir}`);
  }
  const payloadSha = await readText(path.join(payloadDir, SHA_FILE));

  const cwd = process.cwd();
  const destDir = path.resolve(cwd, opts.dir);
  const destShaFile = path.join(destDir, SHA_FILE);

  if (opts.check) {
    if (!existsSync(destShaFile)) {
      process.stderr.write(
        `design-system drift: ${path.relative(cwd, destShaFile) || destShaFile} is missing — run /design-system-sync\n`,
      );
      return 1;
    }
    const vendoredSha = await readText(destShaFile);
    if (vendoredSha !== payloadSha) {
      process.stderr.write(
        `design-system drift: vendored ${vendoredSha} != plugin payload ${payloadSha} — run /design-system-sync\n`,
      );
      return 1;
    }
    process.stdout.write(`design-system in sync at ${payloadSha}\n`);
    return 0;
  }

  const app = await resolveApp(opts, destDir);
  const apps = await knownApps();
  if (!apps.includes(app)) {
    throw new UsageError(`unknown app "${app}" — known apps: ${apps.join(", ")}`);
  }

  const written = [];
  await mkdir(path.join(destDir, "tokens", "css"), { recursive: true });
  await mkdir(path.join(destDir, "tokens", "tailwind"), { recursive: true });

  for (const rel of ["tokens/css/bytedesk.css", "tokens/tailwind/theme.css"]) {
    await cp(path.join(payloadDir, rel), path.join(destDir, rel));
    written.push(rel);
  }

  // Only this app's profile is vendored. Another app's profile never lands here.
  const profileRel = path.join("profiles", app);
  await cp(path.join(payloadDir, profileRel), path.join(destDir, profileRel), {
    recursive: true,
  });
  const profileFiles = await readdir(path.join(destDir, profileRel));
  for (const file of profileFiles.sort()) {
    written.push(path.join(profileRel, file));
  }

  await writeFile(destShaFile, `${payloadSha}\n`);
  written.push(SHA_FILE);

  await writeFile(path.join(destDir, "README.md"), readmeStamp(app, payloadSha));
  written.push("README.md");

  await writeFile(path.join(destDir, STATE_FILE), `${JSON.stringify({ app }, null, 2)}\n`);
  written.push(STATE_FILE);

  // Repo-relative wherever possible: .envrc is committed and read on any machine.
  const profileDir = path.join(destDir, "profiles", app);
  const relativeProfileDir = path.relative(cwd, profileDir);
  const contextDir =
    relativeProfileDir && !relativeProfileDir.startsWith("..") ? relativeProfileDir : profileDir;
  const envrcAppended = await ensureEnvrc(cwd, contextDir);

  const shownDir = path.relative(cwd, destDir) || opts.dir;
  process.stdout.write(`design-system vendored: app=${app} sha=${payloadSha} dir=${shownDir}\n`);
  for (const rel of written) {
    process.stdout.write(`  wrote ${path.join(shownDir, rel)}\n`);
  }
  process.stdout.write(
    envrcAppended
      ? `  appended .envrc: export IMPECCABLE_CONTEXT_DIR=${contextDir}\n`
      : `  .envrc already exports IMPECCABLE_CONTEXT_DIR=${contextDir}\n`,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`design-system-sync: ${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`design-system-sync: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
