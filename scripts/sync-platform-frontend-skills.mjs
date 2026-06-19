#!/usr/bin/env node
/**
 * One-shot copy of platform-frontend skills from bytedesk-platform.
 * Run: node scripts/sync-platform-frontend-skills.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKETPLACE = join(__dirname, "..");
const PLATFORM = join(MARKETPLACE, "..", "bytedesk-platform");
/** Copy design reference docs only (SKILL.md already in marketplace). */
const DESIGN_REFS = join(
  PLATFORM,
  ".claude",
  "skills",
  "bytedesk-design",
  "references",
);
const DESIGN_REFS_DST = join(
  MARKETPLACE,
  "platform-frontend",
  "skills",
  "bytedesk-design",
  "references",
);

const SKILLS = [
  "bytedesk-atomize",
  "bytedesk-browser-test",
  "bytedesk-design",
  "bytedesk-realtime-engineer",
];

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    const s = join(src, e);
    const d = join(dst, e);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else copyFileSync(s, d);
  }
}

if (existsSync(DESIGN_REFS)) {
  copyTree(DESIGN_REFS, DESIGN_REFS_DST);
  console.log("copied bytedesk-design/references");
}

for (const skill of SKILLS) {
  const src = join(PLATFORM, ".claude", "skills", skill);
  const dst = join(MARKETPLACE, "platform-frontend", "skills", skill);
  if (!existsSync(src)) {
    console.error(`missing: ${src}`);
    process.exit(1);
  }
  copyTree(src, dst);
  console.log(`copied ${skill}`);
}
console.log("done");