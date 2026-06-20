import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve the ByteDesk platform checkout (ADR-0058 workflow host). */
export function resolvePlatformRoot() {
  if (process.env.BYTEDESK_REPO_ROOT && existsSync(process.env.BYTEDESK_REPO_ROOT)) {
    return process.env.BYTEDESK_REPO_ROOT;
  }
  if (process.env.CLAUDE_PROJECT_DIR && existsSync(process.env.CLAUDE_PROJECT_DIR)) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, "scripts/dev/workflow.mjs"))) return cwd;
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, "..", "..", "..", "bytedesk-platform");
  if (existsSync(join(sibling, "scripts/dev/workflow.mjs"))) return sibling;
  return cwd;
}
