/**
 * Domain side of the Bridge: apply MirrorIntent[] to the task store.
 *
 * Harness adapters never call create/update themselves — only this module does.
 * That keeps epic/WIP/duplicate policy in one place regardless of Claude or Grok.
 */
import { create, list, logEvent, release, unblockDependents, update } from "../store.mjs";
import { state } from "../store.mjs";

/**
 * @typedef {object} ApplyContext
 * @property {object} p paths
 * @property {() => object} stamp session/branch stamp fields
 * @property {(title: string, p: object) => object | null} [findDuplicate]
 */

/**
 * @param {import('./intents.mjs').MirrorIntent[]} intents
 * @param {ApplyContext} ctx
 */
export function applyIntents(intents, ctx) {
  if (!intents?.length) return;
  for (const intent of intents) {
    if (intent.op === "create") applyCreate(intent, ctx);
    else if (intent.op === "update") applyUpdate(intent, ctx);
  }
}

function applyCreate(intent, { p, stamp, findDuplicate }) {
  const title = intent.title;
  if (!title) return;

  const nativeId = intent.nativeId || undefined;
  if (findDuplicate) {
    const dup = findDuplicate(title, p);
    if (dup) {
      update(dup.id, { nativeId: nativeId || dup.nativeId, ...stamp() }, p);
      return;
    }
  }

  // Idempotent create by nativeId: if we already mirrored this id, update instead.
  if (nativeId) {
    const existing = list("task", {}, p).find((t) => t.nativeId === nativeId);
    if (existing) {
      const patch = { ...stamp() };
      if (intent.title) patch.title = intent.title;
      if (intent.body != null && intent.body !== "") patch.body = intent.body;
      if (intent.activeForm) patch.activeForm = intent.activeForm;
      if (intent.status) patch.status = intent.status;
      update(existing.id, patch, p);
      finishStatus(existing.id, patch.status, p, intent.via);
      return;
    }
  }

  create(
    "task",
    {
      title,
      nativeId,
      epic: state(p).activeEpic || null,
      activeForm: intent.activeForm,
      status: intent.status || "open",
      acceptance: [],
      evidence: [],
      commits: [],
      blockedBy: [],
      blocks: [],
      ...stamp(),
    },
    intent.body || "",
    p,
  );
}

function applyUpdate(intent, { p, stamp, findDuplicate }) {
  const nativeId = String(intent.nativeId || "").trim();
  if (!nativeId) return;

  let existing = list("task", {}, p).find((t) => t.nativeId === nativeId);
  if (!existing) {
    // Grok todos often "update" on first write — promote to create.
    if (intent.title) {
      applyCreate(
        {
          op: "create",
          title: intent.title,
          body: intent.body,
          nativeId,
          activeForm: intent.activeForm,
          status: intent.status || "open",
          via: intent.via,
        },
        { p, stamp, findDuplicate },
      );
    }
    return;
  }

  const patch = { ...stamp() };
  if (intent.status) patch.status = intent.status;
  if (intent.title) patch.title = intent.title;
  if (intent.activeForm) patch.activeForm = intent.activeForm;
  if (intent.owner) patch.owner = intent.owner;
  if (intent.body != null && intent.body !== "") patch.body = intent.body;
  if (intent.addBlockedBy?.length) {
    patch.blockedBy = [...new Set([...(existing.blockedBy || []), ...nativeIdsToStore(intent.addBlockedBy, p)])];
  }
  if (intent.addBlocks?.length) {
    patch.blocks = [...new Set([...(existing.blocks || []), ...nativeIdsToStore(intent.addBlocks, p)])];
  }
  update(existing.id, patch, p);
  finishStatus(existing.id, patch.status, p, intent.via);
}

function finishStatus(id, status, p, via) {
  if (status === "done") {
    release(id, p);
    logEvent("done", { id, via: via ? `native:${via}` : "native" }, p);
    unblockDependents(id, p);
  }
  if (status === "deleted") release(id, p);
}

function nativeIdsToStore(ids, p) {
  const all = list("task", {}, p);
  return ids.map((n) => all.find((t) => t.nativeId === String(n))?.id || `native:${n}`);
}
