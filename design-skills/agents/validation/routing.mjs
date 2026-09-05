import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A manual lexical selector, also exercised by CI. This never dispatches an
// agent, inspects a consumer tree, or grants permission to use mutating tools.
export function route(catalog, request) {
  assert.equal(typeof request.prompt, 'string', 'prompt must be a string');
  const prompt = ` ${normalize(request.prompt)} `;
  const scores = catalog.agents.map((agent) => ({
    agent,
    score: agent.triggers.filter((trigger) => prompt.includes(` ${normalize(trigger)} `)).length,
  }));
  const highest = Math.max(0, ...scores.map(({ score }) => score));
  if (!highest) return { status: 'unmatched' };
  const matches = scores.filter(({ score }) => score === highest);
  if (matches.length !== 1) {
    return { status: 'clarify', candidates: matches.map(({ agent }) => agent.name).sort() };
  }
  const { agent } = matches[0];
  return {
    status: 'suggested',
    agent: agent.name,
    mode: agent.mode,
    requiredSections: agent.requiredSections,
    execution: request.nativeAgentAvailable === true ? 'named-agent' : 'brief-only',
    writesAuthorized: false,
  };
}

export function verifyCatalog(catalog, agentDirectory, declaredAgents) {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.agents.length, 4);
  assert.equal(new Set(catalog.agents.map((agent) => agent.name)).size, 4);
  const files = catalog.agents.map((agent) => agent.file).sort();
  assert.deepEqual(files, readdirSync(agentDirectory).filter((file) => file.endsWith('.md')).sort());
  assert.deepEqual(files.map((file) => `./agents/${file}`), [...declaredAgents].sort());
  for (const agent of catalog.agents) {
    assert.equal(agent.file, `${agent.name}.md`);
    assert.match(agent.name, /^[a-z][a-z-]+$/);
    assert.ok(Array.isArray(agent.triggers) && agent.triggers.length > 0);
    for (const trigger of agent.triggers) {
      assert.equal(typeof trigger, 'string');
      assert.ok(normalize(trigger).length > 0);
    }
    assert.equal(new Set(agent.triggers.map(normalize)).size, agent.triggers.length);
    assert.equal(agent.mode, agent.name === 'consumer-migration-specialist' ? 'explicit-write' : 'read-only');
    if (agent.mode === 'read-only') assert.deepEqual(agent.tools, ['Read', 'Grep', 'Glob']);
    const bytes = readFileSync(join(agentDirectory, agent.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), agent.sha256, `${agent.name}: checksum mismatch`);
    const text = bytes.toString('utf8');
    assert.equal(text.match(/^name: (.+)$/m)?.[1], agent.name);
    assert.deepEqual(text.match(/^tools: (.+)$/m)?.[1].split(', '), agent.tools);
    assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]), agent.requiredSections);
    assert.match(text, /^model: inherit$/m);
    assert.doesNotMatch(text, /mcp__design-system__|design-system\.manifest\.json|design-system-profile|design-system-migrate/);
    for (const file of catalog.discovery.required) assert.ok(text.includes(file), `${agent.name}: discovery ${file}`);
    assert.ok(text.includes('say so and stop; `design-system-sync`'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const nativeAgentAvailable = args[0] === '--native-agent-available';
    if (nativeAgentAvailable) args.shift();
    if (args[0] === '--') args.shift();
    else if (args[0]?.startsWith('--')) throw new Error('Unknown option');
    if (args.length !== 1) throw new Error('Expected one quoted prompt');
    const readJSON = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
    const catalog = readJSON('./agent-catalog.json');
    const plugin = readJSON('../../.claude-plugin/plugin.json');
    verifyCatalog(catalog, fileURLToPath(new URL('../', import.meta.url)), plugin.agents);
    console.log(JSON.stringify(route(catalog, { prompt: args[0], nativeAgentAvailable }), null, 2));
  } catch (error) {
    console.error(`${error.message}\nUsage: node routing.mjs [--native-agent-available] -- "prompt"`);
    process.exitCode = 1;
  }
}

export function verifyGolden(catalog, scenarios) {
  for (const scenario of scenarios) {
    assert.deepEqual(route(catalog, scenario.request), scenario.expected, scenario.id);
  }
}
