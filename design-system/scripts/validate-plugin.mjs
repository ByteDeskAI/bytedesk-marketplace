#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(process.argv[2] ?? scriptRoot);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{40}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(relative, label) {
  try {
    return JSON.parse(await readFile(path.join(pluginRoot, relative), "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
}

async function walk(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    requireValue(!entry.isSymbolicLink(), `${relative}: plugin archives must not contain symlinks`);
    if (entry.isDirectory()) output.push(...(await walk(absolute, relative)));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

function safeRelative(relative, label) {
  requireValue(typeof relative === "string" && relative.length > 0, `${label}: missing path`);
  const normalized = relative.replaceAll("\\", "/");
  requireValue(!path.posix.isAbsolute(normalized), `${label}: absolute paths are forbidden`);
  requireValue(!normalized.split("/").includes(".."), `${label}: parent traversal is forbidden`);
  return normalized;
}

async function validateFileManifest(rootRelative, manifest, excluded, label) {
  requireValue(Array.isArray(manifest.files), `${label}: files must be an array`);
  const root = path.join(pluginRoot, rootRelative);
  const actual = (await walk(root)).filter((relative) => !excluded.has(relative));
  const expected = [];
  const seen = new Set();
  for (const item of manifest.files) {
    const relative = safeRelative(item.path, `${label} file`);
    requireValue(!seen.has(relative), `${label}: duplicate file ${relative}`);
    seen.add(relative);
    expected.push(relative);
    const absolute = path.join(root, relative);
    requireValue(existsSync(absolute), `${label}: missing file ${relative}`);
    const bytes = await readFile(absolute);
    requireValue(item.size === bytes.length, `${label}: size mismatch for ${relative}`);
    requireValue(item.sha256 === sha256(bytes), `${label}: checksum mismatch for ${relative}`);
  }
  expected.sort();
  requireValue(JSON.stringify(actual) === JSON.stringify(expected), `${label}: file inventory is incomplete or has extras`);
}

function frontmatter(text, label) {
  const normalized = text.replaceAll("\r\n", "\n");
  requireValue(normalized.startsWith("---\n"), `${label}: missing YAML frontmatter`);
  const end = normalized.indexOf("\n---\n", 4);
  requireValue(end !== -1, `${label}: malformed YAML frontmatter`);
  const values = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    requireValue(separator > 0, `${label}: malformed frontmatter line ${line}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    values[key] = value;
  }
  requireValue(values.name, `${label}: frontmatter name is required`);
  requireValue(values.description, `${label}: frontmatter description is required`);
  requireValue(!text.includes("[TODO:"), `${label}: unfinished scaffold placeholder`);
  return values;
}

async function validateManifests() {
  const claude = await readJson(".claude-plugin/plugin.json", "Claude plugin manifest");
  const codex = await readJson(".codex-plugin/plugin.json", "Codex plugin manifest");
  for (const [provider, manifest] of [["Claude", claude], ["Codex", codex]]) {
    requireValue(manifest.name === "design-system", `${provider}: plugin name must be design-system`);
    requireValue(SEMVER.test(manifest.version ?? ""), `${provider}: version must be strict semver`);
    requireValue(manifest.description, `${provider}: description is required`);
    requireValue(manifest.author?.name === "ByteDeskAI", `${provider}: author must be ByteDeskAI`);
    requireValue(manifest.license === "MIT", `${provider}: license must match bundled MIT license`);
  }
  requireValue(claude.version === codex.version, "Claude and Codex versions must match");
  requireValue(claude.description === codex.description, "Claude and Codex descriptions must match");
  requireValue(codex.skills === "./skills/", "Codex manifest must expose ./skills/");
  requireValue(existsSync(path.join(pluginRoot, "LICENSE")), "plugin root LICENSE is missing");
  const designKit = await readJson("design-system.manifest.json", "design kit manifest");
  requireValue(designKit.schemaVersion === 1 && designKit.id === "bytedesk-design-system", "design kit schema/id is unsupported");
  requireValue(designKit.version === codex.version, "design kit version does not match provider manifests");
  for (const category of ["providers", "runtimes", "files", "tokens", "adapters", "profiles", "assets", "templates", "skills", "agents", "mcpServers", "bundles"]) {
    requireValue(Array.isArray(designKit[category]), `design kit ${category} must be an array`);
  }
  for (const item of designKit.files.filter((file) => file.distributions?.includes("plugin"))) {
    const relative = safeRelative(item.deliveryPath, "design kit plugin file");
    const absolute = path.join(pluginRoot, relative);
    requireValue(existsSync(absolute), `plugin runtime is incomplete: ${relative}`);
    const bytes = await readFile(absolute);
    requireValue(bytes.length === item.size && sha256(bytes) === item.sha256, `design kit plugin checksum mismatch: ${relative}`);
  }
  return { pluginVersion: codex.version, designKit };
}

async function validatePayload(pluginVersion, designKit) {
  const manifest = await readJson("payload/.payload-manifest.json", "payload manifest");
  const sourceSha = (await readFile(path.join(pluginRoot, "payload", ".source-sha"), "utf8")).trim();
  requireValue(manifest.schemaVersion === 1, "payload manifest schemaVersion must be 1");
  requireValue(manifest.pluginVersion === pluginVersion, "payload pluginVersion does not match plugin manifests");
  requireValue(SHA.test(sourceSha), "payload source SHA must be an immutable 40-character Git SHA");
  requireValue(manifest.sourceSha === sourceSha, "payload manifest and .source-sha disagree");
  const expected = designKit.files.filter((item) => item.distributions?.includes("payload"))
    .map((item) => item.deliveryPath).sort();
  const actual = manifest.files.map((item) => item.path).sort();
  requireValue(JSON.stringify(actual) === JSON.stringify(expected), "payload manifest does not match the design kit bundle");
  await validateFileManifest(
    "payload",
    manifest,
    new Set([".payload-manifest.json", ".source-sha"]),
    "payload manifest",
  );
  return sourceSha;
}

async function validateSkills(pluginVersion, sourceSha, designKit) {
  requireValue(
    !existsSync(path.join(pluginRoot, "commands")),
    "legacy commands directory duplicates provider-native skills",
  );
  const provenance = await readJson("skills/.provenance.json", "skill provenance");
  const manifest = await readJson("skills/.skill-manifest.json", "skill manifest");
  requireValue(provenance.schemaVersion === 1, "skill provenance schemaVersion must be 1");
  requireValue(provenance.pluginVersion === pluginVersion, "skill provenance pluginVersion is stale");
  requireValue(provenance.designSystemSourceSha === sourceSha, "skill provenance source SHA is stale");
  const expectedReviewed = designKit.skills.filter((item) => item.classification === "reviewed").map((item) => item.name).sort();
  const expectedCore = designKit.skills.filter((item) => item.classification === "core").map((item) => item.name).sort();
  requireValue(provenance.reviewedSkillCount === expectedReviewed.length, "reviewed skill count disagrees with design kit");
  requireValue(JSON.stringify([...provenance.reviewedSkills].sort()) === JSON.stringify(expectedReviewed), "reviewed skill inventory disagrees with design kit");

  const skillsRoot = path.join(pluginRoot, "skills");
  const skillDirectories = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const frontmatterNames = new Set();
  for (const directory of skillDirectories) {
    const skillFile = path.join(skillsRoot, directory, "SKILL.md");
    requireValue(existsSync(skillFile), `${directory}: missing SKILL.md`);
    const metadata = frontmatter(await readFile(skillFile, "utf8"), directory);
    requireValue(metadata.name === directory, `${directory}: frontmatter name must match directory`);
    requireValue(!frontmatterNames.has(metadata.name), `duplicate skill name: ${metadata.name}`);
    frontmatterNames.add(metadata.name);
  }

  const cataloged = [];
  for (const source of provenance.sources ?? []) {
    requireValue(source.name && source.repository && source.license && source.licenseFile, "skill source provenance is incomplete");
    requireValue(source.license === "MIT", `${source.name}: unsupported or missing license`);
    const license = path.join(pluginRoot, "licenses", safeRelative(source.licenseFile, `${source.name} license`));
    requireValue(existsSync(license), `${source.name}: license file is missing`);
    requireValue((await stat(license)).size > 500, `${source.name}: license file is incomplete`);
    if (source.name !== "ByteDesk design-system") {
      requireValue(SHA.test(source.sourceCommit ?? ""), `${source.name}: immutable source commit is required`);
    }
    requireValue(Array.isArray(source.skills) && source.skills.length > 0, `${source.name}: skills are required`);
    cataloged.push(...source.skills);
  }
  requireValue(new Set(cataloged).size === cataloged.length, "skill provenance assigns a skill more than once");
  const catalogedSorted = [...cataloged].sort();
  requireValue(JSON.stringify(catalogedSorted) === JSON.stringify(skillDirectories), "skill provenance and plugin directories disagree");
  requireValue(expectedCore.every((name) => frontmatterNames.has(name)), "core ByteDesk lifecycle skills are incomplete");

  requireValue(manifest.schemaVersion === 1, "skill manifest schemaVersion must be 1");
  requireValue(manifest.pluginVersion === pluginVersion, "skill manifest pluginVersion is stale");
  requireValue(manifest.designSystemSourceSha === sourceSha, "skill manifest source SHA is stale");
  requireValue(JSON.stringify([...manifest.skills].sort()) === JSON.stringify(skillDirectories), "skill manifest inventory is stale");
  await validateFileManifest("skills", manifest, new Set([".skill-manifest.json"]), "skill manifest");
  return skillDirectories.length;
}

try {
  requireValue(existsSync(pluginRoot), `plugin directory does not exist: ${pluginRoot}`);
  const { pluginVersion, designKit } = await validateManifests();
  const sourceSha = await validatePayload(pluginVersion, designKit);
  const skillCount = await validateSkills(pluginVersion, sourceSha, designKit);
  process.stdout.write(`design-system plugin valid: version=${pluginVersion} source=${sourceSha} skills=${skillCount}\n`);
} catch (error) {
  process.stderr.write(`validate-plugin: ${error.message}\n`);
  process.exitCode = 1;
}
