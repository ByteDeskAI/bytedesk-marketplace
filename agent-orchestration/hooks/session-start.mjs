#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_INPUT_BYTES = 64 * 1024;

async function hookInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) return {};
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function within(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function real(path) {
  return realpath(path).catch(() => resolve(path));
}

async function isPluginCheckout(consumer, pluginRoot) {
  const [repo, plugin] = await Promise.all([real(consumer), real(pluginRoot)]);
  return within(repo, plugin) || within(plugin, repo);
}

function emitContext(additionalContext) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  })}\n`);
}

function sessionId(input, env) {
  for (const value of [input.session_id, env.AO_SESSION, env.CLAUDE_CODE_SESSION_ID, env.CODEX_SESSION_ID, env.GROK_SESSION_ID]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function main() {
  const env = process.env;
  const input = await hookInput();
  const pluginRoot = env.PLUGIN_ROOT || env.CLAUDE_PLUGIN_ROOT || env.GROK_PLUGIN_ROOT || PLUGIN_ROOT;
  const consumer = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();

  if (typeof consumer !== "string" || !consumer.trim()) return;
  if (await isPluginCheckout(consumer, pluginRoot)) return;

  let result;
  try {
    const { startupCheck } = await import("../topology/lib/startup.mjs");
    result = await startupCheck({
      consumer: resolve(consumer),
      source: "hook",
      agentId: env.AO_AGENT_ID,
      session: sessionId(input, env),
      pane: env.TMUX_PANE,
      env,
      home: env.HOME,
    });
  } catch {
    emitContext("Agent Orchestration could not complete its SessionStart check. This session continues. Repository enrollment and NATS readiness are unknown; no repository configuration was changed by this hook.");
    return;
  }

  const enrollment = result.activation?.enrollment;
  if (enrollment?.source === "disabled") {
    emitContext(`Agent Orchestration is disabled for this repository: ${enrollment.reason || "the repository configuration vetoes activation"}. No supervisor was started. Keep it disabled unless the repository owner explicitly opts in. This check did not provision or verify NATS credentials.`);
    return;
  }

  if (!enrollment?.enrolled) {
    emitContext(
      `Agent Orchestration is installed globally, but this repository has not opted in${enrollment?.reason ? ` (${enrollment.reason})` : ""}. No repository configuration was changed and no supervisor was started. To opt in, ask the repository owner before creating or updating `.bytedesk/agent-orchestration/config.json` to include { \"enabled\": true }; preserve any existing settings. This opts the repository into local Agent Orchestration only. Gateway owns NATS credentials; this hook did not provision credentials or verify broker connectivity, so do not describe NATS as ready.`
    );
    return;
  }

  if (result.readiness?.state === "offer") {
    emitContext(`Agent Orchestration is enrolled, but this repository has no registered lead. To create one, run ${JSON.stringify(result.readiness.command)}. This SessionStart check does not verify NATS credentials or connectivity.`);
  } else if (result.readiness?.state === "blocked") {
    emitContext(`Agent Orchestration is enrolled, but its local lead/reviewer readiness check is blocked: ${result.readiness.message || "a required local agent is not ready"}. Existing work is preserved. This check does not verify NATS credentials or connectivity.`);
  }
}

main().catch(() => {
  try {
    emitContext("Agent Orchestration could not complete its SessionStart check. This session continues. Repository enrollment and NATS readiness are unknown.");
  } catch {
    // A failed context write must never turn SessionStart into a failed host session.
  }
});
