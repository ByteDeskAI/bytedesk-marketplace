#!/usr/bin/env node
/**
 * Copy platform-domain, platform-ops, and omnigent-dev from bytedesk-platform.
 * Applies bootstrap path rewrites to SKILL.md and other .md files.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_ROOT = join(__dirname, "..");
const PLATFORM_ROOT = join(MARKETPLACE_ROOT, "..", "bytedesk-platform");

const PLUGIN_SPEC = {
  "platform-domain": {
    skills: [
      "bytedesk-dba",
      "bytedesk-tool-action-engineer",
      "bytedesk-workflow-runtime-smoke",
      "bytedesk-workflow-epic-integrator",
      "bytedesk-maya-workflow-router",
      "bytedesk-devprojects-sandbox-refresh",
      "bytedesk-devproject-domain-operator",
      "bytedesk-remote-gateway-operator",
    ],
    bins: {
      "workflow-runtime-smoke": "scripts/dev/workflow-runtime-smoke.mjs",
      "workflow-registry-drift-proof": "scripts/dev/workflow-registry-drift-proof.mjs",
      "devproject-domain-proof": "scripts/dev/devproject-domain-proof.mjs",
      "devproject-sandbox-refresh-proof": "scripts/dev/devproject-sandbox-refresh-proof.mjs",
      "host-diagnostics": "scripts/dev/host-diagnostics.mjs",
      "lint-bundled-workflows": "scripts/dev/lint-bundled-workflows.mjs",
    },
  },
  "platform-ops": {
    skills: ["bytedesk-production-release-teamcity", "bytedesk-devops-engineer"],
    bins: { "release-status": "scripts/dev/release-status.mjs" },
  },
  "omnigent-dev": {
    skills: [
      "omnigent-engineer",
      "omnigent-operator",
      "omnigent-architect",
      "omnigent-runtime-harness-engineer",
      "omnigent-web-deploy-engineer",
      "omnigent-api-sdk-engineer",
      "omnigent-agent-integrator",
    ],
    bins: {},
  },
};

const SKILL_SCRIPT_REWRITES = [
  [/node scripts\/dev\/release-status\.mjs/g, "release-status"],
  [/scripts\/dev\/release-status\.mjs/g, "release-status"],
  [/node scripts\/dev\/workflow-runtime-smoke\.mjs/g, "workflow-runtime-smoke"],
  [/scripts\/dev\/workflow-runtime-smoke\.mjs/g, "workflow-runtime-smoke"],
  [/node scripts\/dev\/workflow-registry-drift-proof\.mjs/g, "workflow-registry-drift-proof"],
  [/scripts\/dev\/workflow-registry-drift-proof\.mjs/g, "workflow-registry-drift-proof"],
  [/node scripts\/dev\/devproject-domain-proof\.mjs/g, "devproject-domain-proof"],
  [/scripts\/dev\/devproject-domain-proof\.mjs/g, "devproject-domain-proof"],
  [/node scripts\/dev\/devproject-sandbox-refresh-proof\.mjs/g, "devproject-sandbox-refresh-proof"],
  [/scripts\/dev\/devproject-sandbox-refresh-proof\.mjs/g, "devproject-sandbox-refresh-proof"],
  [/node scripts\/dev\/host-diagnostics\.mjs/g, "host-diagnostics"],
  [/scripts\/dev\/host-diagnostics\.mjs/g, "host-diagnostics"],
];

function listFiles(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(relative(base, p));
  }
  return out;
}

function rewriteSkillBody(text) {
  let out = text;
  for (const [pat, rep] of SKILL_SCRIPT_REWRITES) out = out.replace(pat, rep);
  return out;
}

function copyTree(src, dst, transform) {
  for (const rel of listFiles(src)) {
    const from = join(src, rel);
    const to = join(dst, rel);
    mkdirSync(dirname(to), { recursive: true });
    const raw = readFileSync(from, "utf8");
    writeFileSync(to, transform ? transform(raw, rel) : raw);
  }
}

const RESOLVE_PLATFORM_ROOT = readFileSync(
  join(MARKETPLACE_ROOT, "platform-domain/lib/resolve-platform-root.mjs"),
  "utf8",
);

const FORWARD_BIN = (platformRel) => `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { resolvePlatformRoot } from "../lib/resolve-platform-root.mjs";

const root = resolvePlatformRoot();
const target = join(root, "${platformRel}");
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, BYTEDESK_REPO_ROOT: root },
});
process.exit(result.status ?? 1);
`;

for (const [pluginName, spec] of Object.entries(PLUGIN_SPEC)) {
  const pluginDir = join(MARKETPLACE_ROOT, pluginName);
  mkdirSync(join(pluginDir, "lib"), { recursive: true });
  writeFileSync(join(pluginDir, "lib", "resolve-platform-root.mjs"), RESOLVE_PLATFORM_ROOT);

  mkdirSync(join(pluginDir, "skills"), { recursive: true });
  for (const skill of spec.skills) {
    const srcDir = join(PLATFORM_ROOT, ".claude", "skills", skill);
    const dstDir = join(pluginDir, "skills", skill);
    if (!existsSync(srcDir)) {
      console.error(`missing skill: ${skill}`);
      process.exit(1);
    }
    copyTree(srcDir, dstDir, (body, rel) =>
      rel.endsWith("SKILL.md") || rel.endsWith(".md") ? rewriteSkillBody(body) : body,
    );
  }

  mkdirSync(join(pluginDir, "bin"), { recursive: true });
  for (const [binName, platformRel] of Object.entries(spec.bins)) {
    writeFileSync(join(pluginDir, "bin", binName), FORWARD_BIN(platformRel), { mode: 0o755 });
  }
}

const devopsScripts = join(
  PLATFORM_ROOT,
  ".claude",
  "skills",
  "bytedesk-devops-engineer",
  "scripts",
);
const devopsDst = join(
  MARKETPLACE_ROOT,
  "platform-ops",
  "skills",
  "bytedesk-devops-engineer",
  "scripts",
);
if (existsSync(devopsScripts)) copyTree(devopsScripts, devopsDst);

console.log("sync-three-plugins: ok");