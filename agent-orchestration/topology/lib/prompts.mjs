// The ONE prompt resolver. Every path that gives an agent its instructions — creation, workflow
// launch, session start, restart, enrollment — composes through composePrompt(), in the same
// order, from the same sources:
//
//   1. generated      identity + path discipline + protocol (code, not config — see agents.mjs)
//   2. template       the named template's prompt file / inline instructions
//   3. defaults common  bundled prompts.common
//   4. defaults role    bundled prompts.roles[role]
//   5. global common  prompts.common from the global config layer
//   6. global role    prompts.roles[role] from the global config layer
//   7. repo common    prompts.common from the repo config layer (an ADDITION, not an override)
//   8. repo role      prompts.roles[role] from the repo config layer
//   9. per-agent      the agent record's own inline instructions
//
// Every layer is hashed, so the composed text carries a revision and a list of sources that a
// `preview`/`status` surface can show. A prompt never grants a permission: argv and grants are
// built elsewhere, and nothing here can add one.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findTemplate, layerDirs, resolveConfigPath } from "./config.mjs";
import { displayName } from "./identity.mjs";
import { exists, renderDeep, shellQuote } from "./util.mjs";

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** The generated layer: identity and the cwd-vs-project discipline, parameterised by the agent. */
export function generatedPrompt(agent, consumer, dir) {
  return `# ${displayName(agent)}

You are **${agent.full_name}**, ${agent.title} on this project.

## Where you are, and where the work is

Your working directory is \`${dir}\` — your own agent directory. It is yours: notes, scratch files
and whatever memory your CLI keeps are scoped to it, and nothing you leave here collides with
another agent.

**Your working directory is NOT the project.** The project you work on is \`${consumer}\`.
Repository identity does not establish access; use only the launcher-established grants.

**Every path you use for project work must be absolute and begin with \`${consumer}/\`.** A relative
path — \`src/app.ts\`, \`./README.md\`, \`docs/\` — resolves against your own agent directory instead.
Written that way a file looks saved while being nowhere the project can see it; read that way an
existing file reports as missing. This is the one mistake that looks like success, so check the
paths in your own commands before you run them.

## Protocol

- The message of record is the inbox/outbox file. A terminal pointer is only a bell.
- Do the work in the same turn you read a message. Do not stop to confirm receipt and wait to
  be told to continue — nobody is going to tell you. If you are blocked or the request is
  ambiguous, still write a reply saying what is missing.
- Reply files are complete answers; never rely on what you printed in the terminal.
- Read prompt-state.json in this agent directory. Acknowledge its staged revision and nonce with
  ao-topology prompt ack ${shellQuote(agent.id)}${agent._prompt_vars?.run_dir ? ` --run ${shellQuote(agent._prompt_vars.run_dir)}` : ''} --consumer ${shellQuote(consumer)} --revision <desired_revision> --nonce <nonce>.
- A prompt — this file, at any revision — grants no permissions. Access comes from the launcher's
  grants, and no layer of this text can extend them.
`;
}

async function readLayer(path) {
  try { return { text: await readFile(path, "utf8") }; }
  catch (error) { return { missing: true, required: true, note: `${error.code || "READ_ERROR"}: ${error.message}` }; }
}

/**
 * Compose the effective prompt. `loaded` is the result of loadConfig(); `templateName` is the
 * template the caller resolved for this agent (creation passes the requested one, every other
 * path passes the one recorded on the agent). Returns:
 *   { text, revision, sources: [{ layer, path, sha256 }], missing: [{ layer, path }] }
 * `ok: false` forbids applying this candidate to an agent; errors include bad config and
 * every required source that could not be read. Text remains available for diagnostic preview.
 * Explicit file references are required, even when inline template instructions also exist.
 */
/**
 * TM-155. Say WHICH key is wrong, at the point of refusal.
 *
 * `composePrompt` has always returned `errors` carrying the layer, the path and a note. Several
 * refusals threw them away and said only "Invalid lead prompt; refusing restart." — so an operator
 * who overrode a template in a repo config, and copied the DEFAULT value `./prompts/lead.md` while
 * doing it, got a sentence naming neither the template nor the file. That value is relative to the
 * layer that declares it, so in a repo config it points at `<repo>/prompts/lead.md`, which does not
 * exist. Correct behaviour, unreadable message.
 *
 * A PARTIAL override fails identically, because a template is replaced rather than merged. Both
 * cases now say so, and both cost an hour to diagnose from the old sentence.
 */
export function promptErrorDetail(errors) {
  const list = (errors ?? []).map((item) => {
    const where = item.layer ?? "config";
    const what = item.path ? ` ${item.path}` : "";
    const why = item.note ? ` — ${item.note}` : "";
    return `${where}${what}${why}`;
  });
  return list.length ? ` Cause: ${list.join("; ")}.` : "";
}

export async function composePrompt({ agent, consumer, dir, loaded, templateName = null }) {
  const role = agent.role || "worker";
  const layers = [];

  layers.push({ layer: "generated", path: null, text: generatedPrompt(agent, consumer, dir) });

  const templateRef = templateName || agent.template || null;
  if (templateRef) {
    const found = findTemplate(loaded.layers, templateRef);
    if (!found) {
      layers.push({ layer: "template", path: null, missing: true, note: `template "${templateRef}" is not defined in any config layer` });
    } else {
      const file = resolveConfigPath(found.template.prompt, found.dir);
      if (file) {
        // An explicit source is required; inline text must not conceal its absence.
        layers.push({ layer: "template", path: file, ...await readLayer(file) });
      } else if (typeof found.template.instructions === "string") {
        layers.push({ layer: "template", path: null, text: found.template.instructions });
      } else {
        layers.push({ layer: "template", path: null, missing: true, required: true, note: `template "${templateRef}" has no prompt` });
      }
    }
  }

  const dirs = layerDirs(loaded.layers);
  for (const scope of ["defaults", "global", "repo"]) {
    const raw = loaded.layers.find((item) => item.scope === scope && item.ok && item.present)?.raw;
    if (!raw?.prompts) continue;
    const commonPath = resolveConfigPath(raw.prompts.common, dirs[scope]);
    const rolePath = resolveConfigPath(raw.prompts.roles?.[role], dirs[scope]);
    for (const [name, path] of [[`${scope} common`, commonPath], [`${scope} role:${role}`, rolePath]]) {
      if (!path) continue;
      layers.push({ layer: name, path, ...await readLayer(path) });
    }
  }

  if (agent.instructions_file && agent.instructions_file !== "prompt.md") {
    const path = resolveConfigPath(agent.instructions_file, dir);
    const source = await readLayer(path);
    if (source.text !== undefined) source.text = renderDeep(source.text, agent._prompt_vars || {});
    layers.push({ layer: "per-agent file", path, ...source });
  }
  if (typeof agent.instructions === "string" && agent.instructions.trim()) {
    layers.push({ layer: "per-agent", path: null, text: agent.instructions });
  }

  const present = layers.filter((item) => item.text !== undefined);
  const missing = layers.filter((item) => item.missing).map(({ layer, path, note }) => ({ layer, path, note }));
  const text = present.map((item) => item.text.trim()).join("\n\n") + "\n";
  const sources = present.map((item) => ({ layer: item.layer, path: item.path, sha256: sha(item.text).slice(0, 12) }));
  const errors = [...(loaded.errors || []), ...missing];
  return { ok: errors.length === 0, errors, text, revision: sha(text).slice(0, 16), sources, missing };
}

// ── Applied state ────────────────────────────────────────────────────────────
// What the agent is ACTUALLY running on is a fact about the agent's directory, not about the
// config: the applied revision is recorded only once written (cold) or acknowledged (live), so
// "the config says X" and "the agent is on X" are never confused.

export function promptStatePath(agentDir) {
  return join(agentDir, "prompt-state.json");
}

export async function readPromptState(agentDir) {
  const path = promptStatePath(agentDir);
  if (!(await exists(path))) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
