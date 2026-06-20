/**
 * Named ByteDesk development agents — roster + routing hints.
 * Used by scripts/dev/agent-dispatch.mjs.
 * Distinct from scripts/lib/agent-dispatch.mjs (Omnigent goal payload builder).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveMarketplacePlugin } from "./resolve-marketplace-plugin.mjs";

/** @typedef {{ slug: string, name: string, summary: string, skills: string[], triggers: string[], definition: string }} Agent */

/** @type {Agent[]} */
export const AGENTS = [
  {
    slug: "platform-builder",
    name: "Platform Builder",
    summary: "TDD-first feature implementation across platform services and Web.",
    skills: ["bytedesk-software-engineer", "bytedesk-feature-start", "bytedesk-dba", "bytedesk-tool-action-engineer"],
    triggers: ["implement", "add endpoint", "consumer", "migration", "build the", "fix bug", "BDP-"],
    definition: "platform-dev/agents/platform-builder.md",
  },
  {
    slug: "lifecycle-operator",
    name: "Lifecycle Operator",
    summary: "Worktree, localDev, ship, land, cleanup — never raw git/gh.",
    skills: ["bytedesk-worktree-operator", "bytedesk-pr-ready"],
    triggers: ["worktree", "ship", "land", "localdev", "cleanup", "merged", "status", "test worktree"],
    definition: "platform-dev/agents/lifecycle-operator.md",
  },
  {
    slug: "architecture-modeler",
    name: "Architecture Modeler",
    summary: "C4 diagrams, partition decomposition, Structurizr drift co-commit.",
    skills: ["bytedesk-architecture-sync", "bytedesk-architecture-decompose", "bytedesk-architect"],
    triggers: ["structurizr", "workspace.dsl", "diagram", "C4", "partition", "architecture-sync", "decompose"],
    definition: "platform-dev/agents/architecture-modeler.md",
  },
  {
    slug: "ui-proof-runner",
    name: "UI Proof Runner",
    summary: "Browser smoke for ByteDesk.Web — agent-browser via bytedesk-browser-test.",
    skills: ["bytedesk-browser-test", "bytedesk-design", "bytedesk-atomize"],
    triggers: ["browser smoke", "screenshot", "render", "UI proof", "workflow surface page", "tsx"],
    definition: "platform-dev/agents/ui-proof-runner.md",
  },
  {
    slug: "workflow-runtime-verifier",
    name: "Workflow Runtime Verifier",
    summary: "Office workflow DB/API/harness/runtime proof end-to-end.",
    skills: ["bytedesk-workflow-runtime-smoke", "bytedesk-maya-workflow-router", "bytedesk-workflow-epic-integrator"],
    triggers: ["workflow", "harness", "bundled workflow", "office workflow", "Maya route", "/sources"],
    definition: "platform-dev/agents/workflow-runtime-verifier.md",
  },
  {
    slug: "goal-orchestrator",
    name: "Goal Orchestrator",
    summary: "Goal docs, manifests, run_goals batches, Jira epic alignment.",
    skills: ["goals", "plan_goal", "plan_epic", "run_goals", "bytedesk-jira-task"],
    triggers: ["/goal", "run goals", "plan.json", "goal board", "epic", "manifest"],
    definition: "platform-dev/agents/goal-orchestrator.md",
  },
  {
    slug: "grounding-analyst",
    name: "Grounding Analyst",
    summary: "Session start, recent commits/PRs/Jira, catch-up before coding.",
    skills: ["bytedesk-ground", "bytedesk-session-start", "bytedesk-confluence"],
    triggers: ["ground", "catch me up", "what changed", "session start", "morning standup", "where did I leave"],
    definition: "platform-dev/agents/grounding-analyst.md",
  },
  {
    slug: "integration-reviewer",
    name: "Integration Reviewer",
    summary: "Pre-PR architect review, architecture-sync audit, integration-branch fan-in.",
    skills: ["bytedesk-architect", "bytedesk-pr-ready", "bytedesk-integration-branch-operator", "bytedesk-architecture-sync"],
    triggers: ["review plan", "architect review", "pr-ready", "integration branch", "holes in this", "audit"],
    definition: "platform-dev/agents/integration-reviewer.md",
  },
];

const bySlug = new Map(AGENTS.map((a) => [a.slug, a]));

/**
 * Resolve agent markdown — marketplace platform-dev/agents first, then repo .claude/agents.
 * @param {Agent} agent
 * @param {string} platformRoot
 */
export function resolveAgentDefinitionPath(agent, platformRoot) {
  const pluginRoot = resolveMarketplacePlugin("platform-dev");
  if (pluginRoot) {
    const pluginPath = join(pluginRoot, "agents", `${agent.slug}.md`);
    if (existsSync(pluginPath)) return pluginPath;
  }
  return join(platformRoot, agent.definition);
}

/** @param {string} slug */
export function getAgent(slug) {
  return bySlug.get(String(slug || "").trim().toLowerCase()) ?? null;
}

/** @param {string} text */
export function suggestAgents(text = "") {
  const lower = String(text).toLowerCase();
  const scored = AGENTS.map((agent) => {
    let score = 0;
    for (const t of agent.triggers) {
      if (lower.includes(t.toLowerCase())) score += t.length > 6 ? 3 : 2;
    }
    for (const s of agent.skills) {
      if (lower.includes(s.replace("bytedesk-", ""))) score += 1;
    }
    return { agent, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.agent);
}