// Persona allocation (TM-274, ADR-0030 part 3). A persona — the last segment of a session name — is
// unique within its scope: the team when there is one, else the repository. Uniqueness comes from
// this registry, never from a numeric suffix.
//
// The interface is three calls, so the NATS KV team registry (TM-279) can stand in for this one:
//   allocate(scope, agent) → persona   the agent's persona in scope; stable once held
//   release(scope, agent)  → boolean   give it up; false when the agent held none
//   holder(scope, persona) → agentId | null
//
// This is the local half: one JSON file per scope under the topology state root, every read-modify-
// write inside lockfile.mjs withLock, so concurrent allocators on one host cannot hand out one persona
// twice. ponytail: a host-local lock — two hosts sharing a team scope need the NATS KV registry.
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { withLock } from "./lockfile.mjs";
import { stateRoot } from "./repoid.mjs";
import { PART_CAPS, personaCandidates, slugPart } from "./session-names.mjs";
import { fail, invariant, readJson, writeJson } from "./util.mjs";

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
  const read = async (scope) => (await readJson(file(scope)).catch(() => null)) ?? { scope, holders: {} };
  const locked = async (scope, fn) => {
    invariant(typeof scope === "string" && scope, "TOPOLOGY_PERSONA_SCOPE", "A persona scope is required.");
    await mkdir(dir, { recursive: true });
    return withLock(`${file(scope)}.lock`, fn);
  };

  return {
    async allocate(scope, agent) {
      invariant(agent?.id, "TOPOLOGY_PERSONA_AGENT", "A persona is allocated to an agent with an id.");
      return locked(scope, async () => {
        const doc = await read(scope);
        const held = Object.entries(doc.holders).find(([, id]) => id === agent.id)?.[0];
        if (held) return held;
        // First name, then first-last once the first name is taken in this scope, then the agent's
        // own id: an identifier rather than a counter, and unique wherever the agent is.
        const persona = [...personaCandidates(agent), slugPart(agent.id, PART_CAPS.persona)].find((name) => name && !doc.holders[name]);
        if (!persona) fail("TOPOLOGY_PERSONA_EXHAUSTED", `No free persona for agent ${agent.id} in ${scope}.`, { scope, agent_id: agent.id });
        doc.holders[persona] = agent.id;
        await writeJson(file(scope), doc);
        return persona;
      });
    },
    async release(scope, agent) {
      return locked(scope, async () => {
        const doc = await read(scope);
        const held = Object.entries(doc.holders).filter(([, id]) => id === agent?.id).map(([name]) => name);
        for (const name of held) delete doc.holders[name];
        if (held.length) await writeJson(file(scope), doc);
        return held.length > 0;
      });
    },
    async holder(scope, persona) {
      return (await read(scope)).holders[persona] ?? null;
    },
  };
}
