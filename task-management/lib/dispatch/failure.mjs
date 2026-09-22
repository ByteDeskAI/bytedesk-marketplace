/** A task hold must never exhaust the repository's provider failure budget. */
export function failureScope(result = {}, fallback = "task") {
  if (["task", "provider", "backend"].includes(result.failureScope)) return result.failureScope;
  const text = `${result.code || ""} ${result.reason || result.summary || ""}`;
  if (/AO_CONSUMER_DIRTY|OWNERSHIP|ALREADY_ASSIGNED|DUPLICATE|WORKTREE|SCOPE|UNSUPPORTED_FALLBACK|WORKER_GUARD_UNSUPPORTED|another writer|already dispatched|claimed by|not ready for agent/i.test(text)) return "task";
  if (/quota|rate.?limit|too many requests|insufficient.?credits|billing|RESOURCE_EXHAUSTED|\b429\b|authentication failed|invalid api key|TOPOLOGY_STARTUP_NOT_READY/i.test(text)) return "provider";
  if (/ECONNREFUSED|ECONNRESET|ENOENT|ETIMEDOUT|backend.*not available|no dispatch backend available/i.test(text)) return "backend";
  return fallback;
}

export const isSystemFailure = (result, fallback = "task") => failureScope(result, fallback) !== "task";
