// Persona allocation (TM-274, ADR-0030 part 3). A persona — the last segment of a session name — is
// unique within its scope: the team when there is one, else the repository. Uniqueness comes from
// this registry, never from a numeric suffix.
//
// The interface is three calls, so the NATS KV team registry (TM-279) can stand in for this one:
//   allocate(scope, holder, { isStale }) → persona
//                                       the holder's persona in scope; stable once held. A holder is
//                                       an agent `{ id, full_name }` or a run `{ id: "run:<id>",
//                                       candidates }`; `isStale(holderId, sinceMs)` lets a caller
//                                       reclaim a persona whose holder ended without releasing it
//   release(scope, agent)  → boolean   give it up; false when the agent held none
//   holder(scope, persona) → agentId | null
//
// This is the local half: one JSON file per scope under the topology state root, every read-modify-
// write inside lockfile.mjs withLock, so concurrent allocators on one host cannot hand out one persona
// twice. ponytail: a host-local lock — two hosts sharing a team scope need the NATS KV registry.
//
// The team half (TM-279) is natsPersonaRegistry: one JetStream KV bucket, ORCH_PERSONAS, keyed
// `<scope>.<persona>`, where an atomic `create` is the allocation. personaRegistryFor picks one per
// scope; a team is never handed the local registry while NATS is the transport.
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { withLock } from "./lockfile.mjs";
import { PART_CAPS, personaCandidates, slugPart } from "./session-names.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { fail, invariant, readJson, writeJson } from "./util.mjs";

/**
 * How long a fresh allocation is protected from reclaim: a run between allocation and `new-session`,
 * or an agent whose node has not published presence yet, must not lose its persona to a neighbour.
 * ponytail: time-based grace; a launch slower than this before `new-session` could lose its persona.
 */
export const RUN_PERSONA_GRACE_MS = 120_000;

/**
 * The scope a persona must be unique in: `team:<team>` when there is a team, else `repo:<repo slug>`.
 * The slug, not the origin, on purpose: two repositories whose names slug alike (`org1/app`,
 * `org2/app`, or two remote-less `app` folders) would otherwise produce the same session name on one
 * node. Sharing a scope makes the second one take a surname instead.
 */
export function personaScope({ team = null, repo }) {
  const slug = slugPart(team, PART_CAPS.team);
  return slug ? `team:${slug}` : `repo:${slugPart(repo, PART_CAPS.repo) || "repo"}`;
}

export function localPersonaRegistry({ env = process.env, home = homedir() } = {}) {
  const dir = join(stateRoot(env, home), "personas");
  const file = (scope) => join(dir, `${createHash("sha256").update(String(scope)).digest("hex").slice(0, 16)}.json`);
  const read = async (scope) => ({ since: {}, ...((await readJson(file(scope)).catch(() => null)) ?? { scope, holders: {} }) });
  const locked = async (scope, fn) => {
    invariant(typeof scope === "string" && scope, "TOPOLOGY_PERSONA_SCOPE", "A persona scope is required.");
    await mkdir(dir, { recursive: true });
    return withLock(`${file(scope)}.lock`, fn);
  };

  return {
    kind: "local",
    async allocate(scope, agent, { isStale = null } = {}) {
      invariant(agent?.id, "TOPOLOGY_PERSONA_AGENT", "A persona is allocated to an agent with an id.");
      return locked(scope, async () => {
        const doc = await read(scope);
        const held = Object.entries(doc.holders).find(([, id]) => id === agent.id)?.[0];
        if (held) return held;
        // A holder that ended without releasing (a run whose session vanished) gives its persona back.
        if (isStale) {
          for (const [name, id] of Object.entries(doc.holders)) {
            if (await isStale(id, Date.parse(doc.since[name] ?? "") || 0)) { delete doc.holders[name]; delete doc.since[name]; }
          }
        }
        // First name, then first-last once the first name is taken in this scope, then the agent's
        // own id: an identifier rather than a counter, and unique wherever the agent is.
        const persona = [...personaCandidates(agent), slugPart(agent.id, PART_CAPS.persona)].find((name) => name && !doc.holders[name]);
        if (!persona) fail("TOPOLOGY_PERSONA_EXHAUSTED", `No free persona for agent ${agent.id} in ${scope}.`, { scope, agent_id: agent.id });
        doc.holders[persona] = agent.id;
        doc.since[persona] = new Date().toISOString();
        await writeJson(file(scope), doc);
        return persona;
      });
    },
    async release(scope, agent) {
      return locked(scope, async () => {
        const doc = await read(scope);
        const held = Object.entries(doc.holders).filter(([, id]) => id === agent?.id).map(([name]) => name);
        for (const name of held) { delete doc.holders[name]; delete doc.since[name]; }
        if (held.length) await writeJson(file(scope), doc);
        return held.length > 0;
      });
    },
    async holder(scope, persona) {
      return (await read(scope)).holders[persona] ?? null;
    },
  };
}

/** The registry holder id of a team run: runs hold a persona only while they live. */
export function runHolder(runId) {
  return `run:${runId}`;
}

/**
 * Give a team run's persona back when the run ends (stop, failed launch, dry run). A no-op for any
 * other session: an agent keeps its persona. `identity` is the run's recorded `session_identity`.
 */
export async function releaseRunPersona(identity, { env = process.env, home = homedir(), personas = null } = {}) {
  if (identity?.kind !== "run" || !identity.run) return false;
  const scope = personaScope({ team: identity.team, repo: identity.repo });
  personas ??= await personaRegistryFor(scope, { env, home });
  return personas.release(scope, { id: runHolder(identity.run) });
}

/**
 * The registry for one scope. A repo scope is always the local file lock: it is unique per node by
 * construction. A team spans nodes, so a team scope uses the NATS registry whenever NATS is the
 * transport, and fails with TOPOLOGY_PERSONA_REGISTRY_UNAVAILABLE when NATS cannot be reached —
 * falling back to a node-local file would let two nodes hand out one persona. `AO_TRANSPORT=file`
 * is the explicit single-host double (no NATS anywhere, so no second node), and keeps the local one.
 */
export async function personaRegistryFor(scope, { env = process.env, home = homedir(), transport = null } = {}) {
  if (!String(scope).startsWith("team:")) return localPersonaRegistry({ env, home });
  const { isTransportFailure, resolveTransport, transportMode } = await import("./orch-transport.mjs");
  const selected = env === process.env ? env : { ...env, AO_TRANSPORT: env.AO_TRANSPORT ?? process.env.AO_TRANSPORT };
  if (!transport && transportMode(selected) === "file") return localPersonaRegistry({ env, home });
  try {
    return natsPersonaRegistry({ transport: await resolveTransport({ env, transport }) });
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    return unavailable(scope, error);
  }
}

function unavailable(scope, error) {
  const team = String(scope).replace(/^team:/, "");
  fail("TOPOLOGY_PERSONA_REGISTRY_UNAVAILABLE",
    `Team "${team}" allocates personas through the NATS registry, and NATS is unreachable: ${error.message}. `
    + "A team persona is never taken from the local registry, because two nodes could then take the same one. "
    + "Restore NATS (AO_NATS_URL, the gateway listener, or the local server), or run without --team.",
    { scope, team, cause: error.code ?? null });
}

const KV_CONFLICT = 10071; // JetStream "wrong last sequence": the revision check refused the write.
const isConflict = (error) => error?.api_error?.err_code === KV_CONFLICT;
const kvScope = (scope) => String(scope).replace(/[^-_=A-Za-z0-9]/g, "_");
/** The KV key of one persona: `team:core` + `ada` → `team_core.ada`. Persona slugs are already KV-safe. */
export function personaKey(scope, persona) {
  return `${kvScope(scope)}.${persona}`;
}

/** A presence agent that is this holder: the agent itself, or any member of the holder's run. */
function presenceHolds(agent, holderId) {
  const id = String(holderId);
  if (!id.startsWith("run:")) return agent?.agentId === id;
  const runId = id.slice(4);
  return agent?.primaryRunId === runId || (agent?.memberships ?? []).some((member) => member?.runId === runId);
}

/**
 * TM-279 / ADR-0030: team personas in NATS KV, unique across every node of the team.
 *
 * Bucket `ORCH_PERSONAS`, key `<scope>.<persona>`, value `{ holder, sessionId, node, repo, presence,
 * allocatedAt }` (`presence` is the allocating repository's presence key). Every write is revision
 * checked, so the bucket itself is the lock:
 *  - allocate walks the candidates (first name, first-last, the holder's id) and takes the first one
 *    whose atomic `create` succeeds; a name the holder already holds is returned as is.
 *  - a taken name is reclaimed only when its holder is provably dead — older than `graceMs` AND
 *    absent from fresh presence that its own node (`record.node`) published for its repository — and
 *    only by an `update` at the revision that was judged, so of two reclaimers exactly one wins.
 *    Missing or stale presence, or a record without a presence key or node, is unknown: never freed.
 *  - release deletes at the revision it read, so a release never frees a persona someone else
 *    reclaimed in between.
 * The caller's `isStale` is ignored here: it inspects this node's tmux server, which cannot see a
 * holder on another node. Liveness comes from presence, which every node publishes to the same NATS.
 *
 * Leaf nodes: the hub hosts the bucket. A leaf whose own server has no JetStream reaches it over the
 * leaf connection as is; a leaf with its own JetStream must name the hub's JetStream domain
 * (`AO_NATS_JS_DOMAIN` or `nats.domain` in the ao user config), which the transport's js context uses.
 */
export function natsPersonaRegistry({ transport, graceMs = RUN_PERSONA_GRACE_MS, now = Date.now } = {}) {
  invariant(typeof transport?.personaKv === "function", "TOPOLOGY_PERSONA_REGISTRY_UNAVAILABLE", "The NATS persona registry needs a NATS transport.");
  const guarded = async (scope, fn) => {
    invariant(typeof scope === "string" && scope, "TOPOLOGY_PERSONA_SCOPE", "A persona scope is required.");
    try { return await fn(await transport.personaKv()); }
    catch (error) {
      const { absorbTransportFailure } = await import("./orch-transport.mjs");
      if (await absorbTransportFailure(error)) unavailable(scope, error);
      throw error;
    }
  };
  const current = async (kv, key) => {
    const entry = await kv.get(key);
    return entry?.operation === "PUT" ? { entry, record: entry.json() } : { entry, record: null };
  };
  // Drain the key listing before reading any key: a get issued while the listing is still streaming
  // can make it drop keys, and a dropped key here would hand one holder a second persona.
  const heldBy = async (kv, scope, holderId) => {
    const keys = [];
    for await (const key of await kv.keys(`${kvScope(scope)}.*`)) keys.push(key);
    const held = [];
    for (const key of keys) {
      const { entry, record } = await current(kv, key);
      if (record?.holder === holderId) held.push({ key, persona: key.slice(kvScope(scope).length + 1), revision: entry.revision });
    }
    return held;
  };
  // TM-484: liveness is read from the holder's own node's presence (`<repo>.<node>`), never the shared
  // `<repo>` key another node with the same checkout path overwrites. Only fresh presence from that
  // node that does not list the holder proves it dead; missing, unreadable or stale presence is
  // UNKNOWN, and an unknown holder keeps its persona. ponytail: a node that never comes back leaks
  // its personas; the allocator falls through to first-last and the holder's id, so nobody is stuck.
  const live = async (record) => {
    if (now() - (Date.parse(record.allocatedAt ?? "") || 0) < graceMs) return true;
    if (!record.presence || !record.node) return true;
    const published = await transport.getPresence({ repo: record.presence, node: record.node });
    if (!published) return true;
    let snapshot;
    try { snapshot = JSON.parse(published.body); } catch { return true; }
    const age = now() - (Date.parse(snapshot.generatedAt ?? "") || 0);
    if (age > (snapshot.staleAfterMs ?? 30_000) + (snapshot.clockSkewToleranceMs ?? 0)) return true;
    return (snapshot.agents ?? []).some((agent) => presenceHolds(agent, record.holder));
  };
  // A write that lost a revision race is a normal outcome (false); anything else is not.
  const attempt = async (write) => {
    try { await write(); return true; }
    catch (error) { if (isConflict(error)) return false; throw error; }
  };

  return {
    kind: "nats",
    async allocate(scope, holder, { session = null } = {}) {
      invariant(holder?.id, "TOPOLOGY_PERSONA_AGENT", "A persona is allocated to an agent with an id.");
      return guarded(scope, async (kv) => {
        const held = await heldBy(kv, scope, holder.id);
        if (held.length) return held[0].persona;
        const value = JSON.stringify({ holder: holder.id, sessionId: session?.id ?? null, node: session?.node ?? null,
          repo: session?.repo ?? null, presence: session?.presence ?? null, allocatedAt: new Date(now()).toISOString() });
        for (const persona of [...personaCandidates(holder), slugPart(holder.id, PART_CAPS.persona)].filter(Boolean)) {
          const key = personaKey(scope, persona);
          if (await attempt(() => kv.create(key, value))) return persona;
          const { entry, record } = await current(kv, key);
          if (record?.holder === holder.id) return persona;
          // Released between our create and this read: take it at the revision we saw, or not at all.
          const free = !record || !(await live(record));
          if (free && await attempt(() => (entry ? kv.update(key, value, entry.revision) : kv.create(key, value)))) return persona;
        }
        return fail("TOPOLOGY_PERSONA_EXHAUSTED", `No free persona for agent ${holder.id} in ${scope}.`, { scope, agent_id: holder.id });
      });
    },
    async release(scope, holder) {
      return guarded(scope, async (kv) => {
        let released = 0;
        for (const { key, revision } of await heldBy(kv, scope, holder?.id)) {
          if (await attempt(() => kv.delete(key, { previousSeq: revision }))) released += 1;
        }
        return released > 0;
      });
    },
    async holder(scope, persona) {
      return guarded(scope, async (kv) => (await current(kv, personaKey(scope, persona))).record?.holder ?? null);
    },
  };
}

/** The presence key a NATS persona record carries so another node can judge its holder's liveness. */
export async function presenceKeyOf(consumer) {
  return repoKey((await canonicalRepoId(consumer)).id);
}
