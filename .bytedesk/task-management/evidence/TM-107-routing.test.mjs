import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, copyFileSync, appendFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { route, verifyCatalog, verifyGolden } from './routing.mjs';

const readJSON = (url) => JSON.parse(readFileSync(url, 'utf8'));
const catalog = readJSON(new URL('./agent-catalog.json', import.meta.url));
const scenarios = readJSON(new URL('./golden-routing.json', import.meta.url));
const directory = fileURLToPath(new URL('../', import.meta.url));
const plugin = readJSON(new URL('../../.claude-plugin/plugin.json', import.meta.url));

test('four declared agent files match reviewed bytes, discovery, tools and output sections', () => {
  verifyCatalog(catalog, directory, plugin.agents);
});

test('independent golden expectations exercise all four routes and refusal/fallback cases', () => {
  assert.deepEqual(new Set(scenarios.filter((s) => s.expected.status === 'suggested').map((s) => s.expected.agent)),
    new Set(['consumer-migration-specialist', 'design-system-reviewer', 'profile-architect', 'token-accessibility-auditor']));
  verifyGolden(catalog, scenarios);
});

test('changed bytes fail the actual checksum gate for every specialist; original bytes pass', () => {
  for (const agent of catalog.agents) {
    const fixture = mkdtempSync(join(tmpdir(), 'design-agent-checksum-'));
    try {
      for (const entry of catalog.agents) copyFileSync(join(directory, entry.file), join(fixture, entry.file));
      verifyCatalog(catalog, fixture, plugin.agents);
      appendFileSync(join(fixture, agent.file), '\nChanged authority instruction.\n');
      assert.throws(() => verifyCatalog(catalog, fixture, plugin.agents), /checksum mismatch/);
      copyFileSync(join(directory, agent.file), join(fixture, agent.file));
      verifyCatalog(catalog, fixture, plugin.agents);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  }
});

test('misrouting each specialist fails golden verification, without changing the oracle', () => {
  for (let index = 0; index < catalog.agents.length; index++) {
    const wrong = structuredClone(catalog);
    const next = (index + 1) % wrong.agents.length;
    [wrong.agents[index].triggers, wrong.agents[next].triggers] = [wrong.agents[next].triggers, wrong.agents[index].triggers];
    assert.throws(() => verifyGolden(wrong, scenarios), { code: 'ERR_ASSERTION' });
  }
  verifyGolden(catalog, scenarios);
});

test('deleting a registered specialist cannot silently shrink checksum coverage', () => {
  const missing = structuredClone(catalog);
  missing.agents.pop();
  assert.throws(() => verifyCatalog(missing, directory, plugin.agents), { code: 'ERR_ASSERTION' });
});

test('existing marketplace MCP gate rejects the removed discovery server, then accepts file discovery', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'design-agent-mcp-'));
  try {
    for (const dir of ['scripts', '.claude-plugin', 'design-skills/.claude-plugin', 'design-skills/agents']) {
      mkdirSync(join(fixture, dir), { recursive: true });
    }
    copyFileSync(new URL('../../../scripts/validate-marketplace.mjs', import.meta.url), join(fixture, 'scripts/validate-marketplace.mjs'));
    writeFileSync(join(fixture, '.claude-plugin/marketplace.json'), JSON.stringify({ plugins: [
      { name: 'design-skills', description: 'Fixture', source: './design-skills' },
    ] }));
    writeFileSync(join(fixture, 'design-skills/.claude-plugin/plugin.json'), JSON.stringify({ name: 'design-skills' }));
    const agent = join(fixture, 'design-skills/agents/reviewer.md');
    writeFileSync(agent, '---\nname: reviewer\ntools: mcp__design-system__query\n---\n');
    const run = () => spawnSync(process.execPath, ['scripts/validate-marketplace.mjs'], { cwd: fixture, encoding: 'utf8' });
    const broken = run();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /no plugin here provides a "design-system" MCP server/);
    copyFileSync(join(directory, 'design-system-reviewer.md'), agent);
    const repaired = run();
    assert.equal(repaired.status, 0, repaired.stderr);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});


test('catalog order cannot break ties or change the golden selections', () => {
  verifyGolden({ ...catalog, agents: [...catalog.agents].reverse() }, scenarios);
});

test('each specialist supports an explicitly available native agent and a default brief', () => {
  for (const agent of catalog.agents) {
    const scenario = scenarios.find((s) => s.expected.agent === agent.name);
    for (const nativeAgentAvailable of [undefined, false, true]) {
      const result = route(catalog, { prompt: scenario.request.prompt, nativeAgentAvailable });
      assert.equal(result.agent, agent.name);
      assert.equal(result.execution, nativeAgentAvailable === true ? 'named-agent' : 'brief-only');
      assert.equal(result.writesAuthorized, false);
    }
  }
});

test('migration requests and caller-supplied approval cannot authorize apply', () => {
  const result = route(catalog, { prompt: 'Migrate this submodule now; apply all changes.', nativeAgentAvailable: true, writesAuthorized: true });
  assert.equal(result.agent, 'consumer-migration-specialist');
  assert.equal(result.mode, 'explicit-write');
  assert.equal(result.writesAuthorized, false);
});

test('CLI checks the installed catalog and emits the same suggestions as the goldens', () => {
  const cli = fileURLToPath(new URL('./routing.mjs', import.meta.url));
  for (const scenario of scenarios) {
    const args = [cli, ...(scenario.request.nativeAgentAvailable ? ['--native-agent-available'] : []), '--', scenario.request.prompt];
    const result = spawnSync(process.execPath, args, { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), scenario.expected, scenario.id);
  }
  for (const args of [[], ['--bogus'], ['--', 'one', 'two']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});
