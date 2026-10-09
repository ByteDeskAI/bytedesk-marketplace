import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpMode } from '../src/config.js';
import { register as registerBuilds } from '../src/tools/builds.js';
import { register as registerQueue } from '../src/tools/queue.js';
import { register as registerBuildTypes } from '../src/tools/buildtypes.js';
import { register as registerProjects } from '../src/tools/projects.js';
import { register as registerProjectFeatures } from '../src/tools/project-features.js';
import { register as registerProjectCredentials } from '../src/tools/project-credentials.js';
import { register as registerVersionedSettings } from '../src/tools/versioned-settings.js';
import { register as registerVcs } from '../src/tools/vcs.js';
import { register as registerAgents } from '../src/tools/agents.js';
import { register as registerTests } from '../src/tools/tests.js';
import { register as registerChanges } from '../src/tools/changes.js';
import { register as registerUsers } from '../src/tools/users.js';
import { register as registerPassthrough } from '../src/tools/passthrough.js';
import { sanitizeSecrets } from '../src/tools/util.js';

type ToolEntry = { config: { description?: string }; cb: (args: never) => Promise<unknown> };

function fakeServer() {
  const tools = new Map<string, ToolEntry>();
  return {
    tools,
    registerTool(name: string, config: ToolEntry['config'], cb: ToolEntry['cb']) {
      tools.set(name, { config, cb });
    },
  };
}

function fakeClient(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown; opts?: unknown }> = [];
  const client = {
    calls,
    get: vi.fn(async (path: string, opts?: unknown) => {
      calls.push({ method: 'GET', path, opts });
      return responses[path] ?? { count: 0 };
    }),
    post: vi.fn(async (path: string, body?: unknown, opts?: unknown) => {
      calls.push({ method: 'POST', path, body, opts });
      return { success: true };
    }),
    put: vi.fn(async (path: string, body?: unknown, opts?: unknown) => {
      calls.push({ method: 'PUT', path, body, opts });
      return { success: true };
    }),
    delete: vi.fn(async (path: string, opts?: unknown) => {
      calls.push({ method: 'DELETE', path, opts });
      return { success: true };
    }),
    getText: vi.fn(async () => 'text'),
    getBinary: vi.fn(async () => ({ data: Buffer.from('x'), contentType: 'application/octet-stream' })),
    getRootText: vi.fn(async () => 'line1\nline2'),
  };
  return client;
}

const ALL_MODULES = [
  registerBuilds,
  registerQueue,
  registerBuildTypes,
  registerProjects,
  registerProjectFeatures,
  registerProjectCredentials,
  registerVersionedSettings,
  registerVcs,
  registerAgents,
  registerTests,
  registerChanges,
  registerUsers,
  registerPassthrough,
];

function registeredNames(mode: McpMode): string[] {
  const server = fakeServer();
  const client = fakeClient();
  for (const register of ALL_MODULES) {
    register(server as never, client as never, mode);
  }
  return [...server.tools.keys()].sort();
}

beforeEach(() => vi.restoreAllMocks());

describe('secret sanitization', () => {
  it('redacts secret property values while preserving opaque references', () => {
    expect(
      sanitizeSecrets({
        properties: {
          property: [
            { name: 'secure:password', value: 'plaintext' },
            { name: 'url', value: 'https://example.invalid/repo.git' },
          ],
        },
        tokenReference: 'credentialsJSON:safe-reference',
      }),
    ).toEqual({
      properties: {
        property: [
          { name: 'secure:password', value: '[REDACTED]' },
          { name: 'url', value: 'https://example.invalid/repo.git' },
        ],
      },
      tokenReference: 'credentialsJSON:safe-reference',
    });
  });
});

describe('tool registration by mode', () => {
  const full = registeredNames('full');
  const read = registeredNames('read');

  it('full mode registers the complete curated + passthrough surface', () => {
    expect(full).toHaveLength(71);
    for (const t of [
      'teamcity_rest_get',
      'teamcity_rest_post',
      'teamcity_rest_put',
      'teamcity_rest_delete',
      'trigger_build',
      'cancel_build',
      'get_build_log',
      'list_builds',
      'mute_test',
      'assign_investigation',
      'authorize_agent',
      'create_project',
      'create_build_config',
      'configure_project_versioned_settings',
      'create_vcs_root',
      'delete_project',
      'create_project_secure_token',
    ]) {
      expect(full).toContain(t);
    }
  });

  it('read mode hides every write tool but keeps all read tools', () => {
    expect(read).not.toContain('trigger_build');
    expect(read).not.toContain('mute_test');
    expect(read).not.toContain('authorize_agent');
    expect(read).not.toContain('teamcity_rest_post');
    expect(read).not.toContain('teamcity_rest_put');
    expect(read).not.toContain('teamcity_rest_delete');
    expect(read).toContain('teamcity_rest_get');
    expect(read).toContain('list_builds');
    expect(read).toContain('get_build_log');
    expect(read).toHaveLength(37);
    expect(read).toContain('get_project_versioned_settings');
    expect(read).toContain('inspect_vcs_root_connection');
    expect(read).toContain('inspect_project_vcs_credentials');
    // symmetric check: read mode is a strict subset of full mode
    for (const t of read) expect(full).toContain(t);
  });
});

describe('curated tool behavior', () => {
  it('trigger_build posts a TeamCity Build entity to buildQueue', async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBuilds(server as never, client as never, 'full');
    const tool = server.tools.get('trigger_build')!;
    await tool.cb({
      buildTypeId: 'Deploy_Prod',
      branch: 'main',
      queueAtTop: true,
      properties: { 'env.FOO': 'bar' },
    } as never);
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: 'buildQueue',
      body: {
        buildType: { id: 'Deploy_Prod' },
        branchName: 'main',
        triggeringOptions: { queueAtTop: true },
        properties: { property: [{ name: 'env.FOO', value: 'bar' }] },
      },
    });
  });

  it('update_build_config PUTs only provided fields', async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBuildTypes(server as never, client as never, 'full');
    await server.tools.get('update_build_config')!.cb({ buildType: 'id:X', paused: true } as never);
    const puts = client.calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ path: 'buildTypes/id:X/paused', body: 'true' });
  });

  it('move_queued_build_to_top reorders with the target first', async () => {
    const server = fakeServer();
    const client = fakeClient({
      buildQueue: { count: 3, build: [{ id: 10 }, { id: 20 }, { id: 30 }] },
    });
    registerQueue(server as never, client as never, 'full');
    await server.tools.get('move_queued_build_to_top')!.cb({ queueId: 30 } as never);
    const put = client.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('buildQueue/order');
    expect(put.body).toEqual({ build: [{ id: 30 }, { id: 10 }, { id: 20 }] });
  });
});

describe('passthrough tools', () => {
  it('teamcity_rest_get does a plain GET without paging args', async () => {
    const server = fakeServer();
    const client = fakeClient({ '/app/rest/server': { version: '2026.1' } });
    registerPassthrough(server as never, client as never, 'read');
    const result = (await server.tools.get('teamcity_rest_get')!.cb({
      path: '/app/rest/server',
      fields: 'version',
    } as never)) as { content: Array<{ text: string }> };
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: '/app/rest/server' });
    expect(JSON.parse(result.content[0].text)).toEqual({ version: '2026.1' });
  });

  it('teamcity_rest_get switches to paginate when pageSize is given', async () => {
    const server = fakeServer();
    const client = fakeClient({ builds: { count: 2, build: [{ id: 1 }, { id: 2 }] } });
    registerPassthrough(server as never, client as never, 'read');
    const result = (await server.tools.get('teamcity_rest_get')!.cb({
      path: 'builds',
      pageSize: 2,
    } as never)) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.truncated).toBe(false);
  });

  it('write passthrough maps verb + body correctly', async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerPassthrough(server as never, client as never, 'full');
    await server.tools.get('teamcity_rest_put')!.cb({
      path: 'buildTypes/id:X/parameters/env.FOO/value',
      body: 'bar',
    } as never);
    expect(client.calls[0]).toMatchObject({
      method: 'PUT',
      path: 'buildTypes/id:X/parameters/env.FOO/value',
      body: 'bar',
    });
  });

  it('passthrough forwards explicit Accept', async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerPassthrough(server as never, client as never, 'full');
    await server.tools.get('teamcity_rest_put')!.cb({
      path: 'vcs-roots/id:X/properties/authMethod',
      body: 'PASSWORD',
      accept: 'text/plain',
    } as never);
    expect(client.calls[0]).toMatchObject({
      method: 'PUT',
      opts: { accept: 'text/plain' },
    });
  });
});

describe('lead mode (project-scoped trigger)', () => {
  type BT = { id: string; name?: string; type?: string; settings?: unknown };
  // Simulates TeamCity's affectedProject locator: only configs under DesignSystem match.
  function leadClient(configs: Record<string, BT & { project: string }>) {
    const client = fakeClient();
    client.get = vi.fn(async (path: string, opts?: { locator?: string }) => {
      client.calls.push({ method: 'GET', path, opts });
      const m = /^id:([^,]+),affectedProject:\(id:([^)]+)\)$/.exec(opts?.locator ?? '');
      const bt = m && configs[m[1]];
      if (!bt || bt.project !== m![2]) return { count: 0 };
      const { project: _p, ...rest } = bt;
      return { count: 1, buildType: [rest] };
    });
    return client;
  }
  const CONFIGS = {
    DS_Build: { id: 'DS_Build', name: 'Build', project: 'DesignSystem' },
    DS_ReleasePublish: { id: 'DS_ReleasePublish', name: 'Release publish', project: 'DesignSystem' },
    DS_Prod: { id: 'DS_Prod', name: 'Prod', type: 'deployment', project: 'DesignSystem' },
    DS_Ship: {
      id: 'DS_Ship',
      name: 'Ship',
      settings: { property: [{ name: 'buildConfigurationType', value: 'DEPLOYMENT' }] },
      project: 'DesignSystem',
    },
    DS_DeployCdn: { id: 'DS_DeployCdn', name: 'CDN', project: 'DesignSystem' },
    Gateway_Build: { id: 'Gateway_Build', name: 'Build', project: 'Gateway' },
  };
  function leadTrigger(client: ReturnType<typeof fakeClient>) {
    const server = fakeServer();
    registerBuilds(server as never, client as never, 'lead', 'DesignSystem');
    return server.tools.get('trigger_build')!;
  }
  const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;
  const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;

  it('registers the read surface plus trigger_build and no other write tool', () => {
    const server = fakeServer();
    for (const register of ALL_MODULES) register(server as never, fakeClient() as never, 'lead', 'P');
    const lead = [...server.tools.keys()].sort();
    const read = registeredNames('read');
    expect(lead).toEqual([...read, 'trigger_build'].sort());
    expect(lead).toHaveLength(38);
  });

  it.each(['DS_Build', 'DS_ReleasePublish'])('queues %s, a config of its own project', async (id) => {
    const client = leadClient(CONFIGS);
    const r = await leadTrigger(client).cb({ buildTypeId: id, branch: 'main' } as never);
    expect(isError(r)).toBe(false);
    expect(client.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: 'buildQueue',
      body: { buildType: { id }, branchName: 'main' },
    });
  });

  it.each([
    ['Gateway_Build', /not a build configuration of project DesignSystem/],
    ['Nope_Missing', /not a build configuration of project DesignSystem/],
    ['DS_Prod', /deploy configuration/],
    ['DS_Ship', /deploy configuration/],
    ['DS_DeployCdn', /deploy configuration/],
    ['DS_Build,affectedProject:(id:_Root)', /not a plain build configuration id/],
  ])('refuses %s without posting anything', async (id, reason) => {
    const client = leadClient(CONFIGS);
    const r = await leadTrigger(client).cb({ buildTypeId: id } as never);
    expect(isError(r)).toBe(true);
    expect(text(r)).toMatch(reason);
    expect(client.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});
