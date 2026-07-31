/**
 * Hook handlers. Always return JSON-friendly payloads; the shell wrapper exits 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { config, createConcept, isInitialized, listConcepts, logEvent } from "./store.mjs";
import { loadIndexSync, reindex } from "./index.mjs";
import { find } from "./query.mjs";
import { isStale } from "./validate.mjs";
import { paths } from "./paths.mjs";
import { autolink } from "./link.mjs";
import { lintBundle } from "./lint.mjs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function summaryContext(p, max = 12) {
  if (!isInitialized(p)) {
    return "knowledge-management: no bundle yet — run `km init` in this project.";
  }
  let idx;
  try {
    idx = loadIndexSync(p);
  } catch {
    idx = reindex(p);
  }
  const concepts = idx.concepts || [];
  const lines = ["knowledge-management (OKF v0.2) — progressive disclosure:", `concepts: ${concepts.length}`];
  const stale = concepts.filter((c) => c.stale);
  if (stale.length) lines.push(`stale: ${stale.slice(0, 5).map((c) => c.id).join(", ")}`);
  lines.push("index:");
  for (const c of concepts.slice(0, max)) {
    lines.push(`  - [${c.type}] ${c.title} (${c.id}) — ${(c.description || "").slice(0, 80)}`);
  }
  if (concepts.length > max) lines.push(`  … +${concepts.length - max} more (km find / km show)`);
  lines.push("Use `km find <words>` before inventing knowledge; store is truth.");
  return lines.join("\n");
}

/** True if text looks like a multi-option product decision, not a clarification. */
function looksLikeDecision(payload) {
  const text = JSON.stringify(payload).toLowerCase();
  if (text.includes("which approach") || text.includes("should we") || text.includes("prefer")) return true;
  if (text.includes("option") && text.includes("answer")) return true;
  const answers = payload?.tool_response || payload?.response || payload;
  return Array.isArray(answers?.answers) && answers.answers.length > 0;
}

export function handleHook(event, rawPayload, p = paths()) {
  const cfg = p.base && existsSync(p.config) ? config(p) : {};
  if (process.env.KM_ENFORCE === "off") {
    return { continue: true, suppressOutput: true };
  }

  switch (event) {
    case "session-start": {
      const note = autolink();
      const ctx = cfg.injectOnSessionStart !== false ? summaryContext(p, cfg.injectMaxConcepts || 12) : "";
      const extra = note ? `\n${note}` : "";
      logEvent("hook_session_start", {}, p);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: (ctx + extra).trim(),
        },
      };
    }
    case "pre-compact": {
      const ctx = summaryContext(p, cfg.injectMaxConcepts || 12);
      logEvent("hook_pre_compact", {}, p);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreCompact",
          additionalContext: ctx,
        },
      };
    }
    case "user-prompt": {
      const payload = parsePayload(rawPayload);
      const prompt = String(payload.prompt || payload.message || "").trim();
      if (!prompt || !isInitialized(p)) return { continue: true };
      const words = prompt.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 6);
      if (!words.length) return { continue: true };
      const hits = find(words, p).slice(0, 5);
      if (!hits.length) return { continue: true };
      const lines = ["knowledge-management: prompt matches existing concepts:"];
      for (const h of hits) lines.push(`  - ${h.id}: ${h.title}`);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: lines.join("\n"),
        },
      };
    }
    case "post-decision": {
      if (cfg.captureDecisions === "off") return { continue: true };
      const payload = parsePayload(rawPayload);
      if (cfg.captureDecisions === "smart" && !looksLikeDecision(payload)) {
        return { continue: true };
      }
      if (!isInitialized(p)) return { continue: true };
      try {
        const title = `Decision ${new Date().toISOString().slice(0, 10)}`;
        const body = `# ${title}\n\nCaptured from AskUserQuestion.\n\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 4000)}\n\`\`\`\n`;
        createConcept(
          {
            type: "Decision",
            title,
            description: "Agent-captured decision",
            dir: "decisions",
            tags: ["decision", "captured"],
            body,
          },
          p,
        );
        reindex(p);
        logEvent("hook_decision_captured", { title }, p);
      } catch {
        /* never break session */
      }
      return { continue: true };
    }
    case "stop": {
      if (!cfg.warnStaleOnStop || !isInitialized(p)) return { continue: true };
      const stale = listConcepts(p).filter((c) => isStale(c.data));
      if (!stale.length) return { continue: true };
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: `knowledge-management: ${stale.length} stale concept(s): ${stale
            .slice(0, 5)
            .map((c) => c.id)
            .join(", ")}`,
        },
      };
    }
    case "subagent-start": {
      if (!isInitialized(p)) return { continue: true };
      const ctx = summaryContext(p, 6);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "SubagentStart",
          additionalContext: ctx,
        },
      };
    }
    default:
      return { continue: true };
  }
}

export function runHookFromStdin(event) {
  const raw = readStdin();
  const result = handleHook(event, raw, paths());
  // Claude hooks: additionalContext via stdout JSON
  if (result.hookSpecificOutput?.additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: result.hookSpecificOutput,
      }) + "\n",
    );
  } else if (result.systemMessage) {
    process.stdout.write(JSON.stringify(result) + "\n");
  }
  return result;
}
