/**
 * Session + OKF actor strings (human:…, process:…, knowledge-management/version).
 */
import { PLUGIN_VERSION } from "./paths.mjs";

const SESSION_ENV = [
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_SESSION_ID",
  "CODEX_THREAD_ID",
  "GROK_SESSION_ID",
];

export function sessionId(env = process.env) {
  for (const key of SESSION_ENV) if (env[key]) return env[key];
  return null;
}

export function pluginActor(env = process.env) {
  const named = env.KM_ACTOR || env.TM_ACTOR || env.CLAUDE_AGENT_NAME;
  if (named) return named;
  return `knowledge-management/${PLUGIN_VERSION}`;
}

export function humanActor(env = process.env) {
  const id = env.KM_HUMAN || env.GIT_AUTHOR_NAME || env.USER || "user";
  const clean = String(id).replace(/\s+/g, "-").toLowerCase();
  return `human:${clean}`;
}

export function now() {
  return new Date().toISOString();
}
