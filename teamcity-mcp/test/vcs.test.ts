import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/tools/vcs.js';

type ToolEntry = { cb: (args: never) => Promise<unknown> };

function fakeServer() {
  const tools = new Map<string, ToolEntry>();
  return {
    tools,
    registerTool(name: string, _config: unknown, cb: ToolEntry['cb']) {
      tools.set(name, { cb });
    },
  };
}

function fakeClient(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown; opts?: unknown }> = [];
  return {
    calls,
    get: vi.fn(async (path: string, opts?: unknown) => {
      calls.push({ method: 'GET', path, opts });
      return responses[`GET ${path}`] ?? responses[path] ?? { count: 0 };
    }),
    post: vi.fn(async (path: string, body?: unknown, opts?: unknown) => {
      calls.push({ method: 'POST', path, body, opts });
      return responses[`POST ${path}`] ?? { success: true };
    }),
    put: vi.fn(async (path: string, body?: unknown, opts?: unknown) => {
      calls.push({ method: 'PUT', path, body, opts });
      return { success: true };
    }),
    delete: vi.fn(async (path: string, opts?: unknown) => {
      calls.push({ method: 'DELETE', path, opts });
      return { success: true };
    }),
  };
}

function parseResult(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('VCS tool registration', () => {
  it('exposes only read tools in read mode', () => {
    const server = fakeServer();
    register(server as never, fakeClient() as never, 'read');
    expect([...server.tools.keys()].sort()).toEqual([
      'get_vcs_root',
      'inspect_vcs_root_connection',
      'list_vcs_roots',
    ]);
  });

  it('exposes all seven tools in full mode', () => {
    const server = fakeServer();
    register(server as never, fakeClient() as never, 'full');
    expect([...server.tools.keys()]).toHaveLength(7);
    expect(server.tools.has('create_vcs_root')).toBe(true);
    expect(server.tools.has('update_vcs_root')).toBe(true);
    expect(server.tools.has('delete_vcs_root')).toBe(true);
    expect(server.tools.has('attach_vcs_root_to_build_config')).toBe(true);
  });
});

describe('VCS tool behavior', () => {
  it('gets and sanitizes a VCS root', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'vcs-roots/id:Root': {
        id: 'Root',
        properties: { property: [{ name: 'secure:password', value: 'credentialsJSON:abc' }] },
      },
    });
    register(server as never, client as never, 'read');
    const result = parseResult(
      await server.tools.get('get_vcs_root')!.cb({ vcsRoot: 'id:Root' } as never),
    );
    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'vcs-roots/id:Root' });
    expect(JSON.stringify(result)).not.toContain('credentialsJSON:abc');
    expect(JSON.stringify(result)).toContain('[REDACTED]');
  });

  it('inspects instances with the root locator', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'vcs-root-instances': {
        count: 1,
        'vcs-root-instance': [{ id: '39', vcsRootId: 'Root' }],
      },
      'vcs-root-instances/id:39': {
        id: '39',
        vcsRootId: 'Root',
        repositoryState: { branchName: 'main' },
      },
    });
    register(server as never, client as never, 'read');
    const result = parseResult(
      await server.tools.get('inspect_vcs_root_connection')!.cb({
        vcsRoot: 'Root',
        includeRepositoryState: true,
      } as never),
    );
    expect(client.calls[0]).toMatchObject({
      method: 'GET',
      path: 'vcs-root-instances',
      opts: { locator: 'vcsRoot:(id:Root)' },
    });
    expect(client.calls[1]).toMatchObject({
      method: 'GET',
      path: 'vcs-root-instances/id:39',
    });
    expect(result).toMatchObject({ count: 1 });
  });

  it('creates a Git root with an existing credential reference', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'POST vcs-roots': { id: 'Root', properties: { property: [] } },
    });
    register(server as never, client as never, 'full');
    await server.tools.get('create_vcs_root')!.cb({
      project: 'Project',
      id: 'Root',
      name: 'Main',
      url: 'https://example.test/repo.git',
      defaultBranch: 'refs/heads/main',
      branchSpecification: '+:refs/heads/*\n+:refs/tags/(v*)',
      checkout: {
        agentCleanPolicy: 'ON_BRANCH_CHANGE',
        submoduleCheckout: 'CHECKOUT',
        useAlternates: 'AUTO',
      },
      authentication: {
        method: 'password',
        username: 'git',
        password: { kind: 'reference', value: 'credentialsJSON:ref' },
      },
    } as never);
    expect(client.calls).toHaveLength(1);
    const create = client.calls[0];
    expect(create).toMatchObject({
      method: 'POST',
      path: 'vcs-roots',
      body: {
        id: 'Root',
        vcsName: 'jetbrains.git',
        project: { id: 'Project' },
      },
    });
    expect(create.body).toMatchObject({
      properties: {
        property: expect.arrayContaining([
          { name: 'authMethod', value: 'PASSWORD' },
          { name: 'username', value: 'git' },
          { name: 'teamcity:branchSpec', value: '+:refs/heads/*\n+:refs/tags/(v*)' },
          { name: 'agentCleanPolicy', value: 'ON_BRANCH_CHANGE' },
          { name: 'submoduleCheckout', value: 'CHECKOUT' },
          { name: 'useAlternates', value: 'AUTO' },
          { name: 'secure:password', value: 'credentialsJSON:ref' },
        ]),
      },
    });
  });

  it('stores env access tokens before creating a Git root', async () => {
    vi.stubEnv('TEAMCITY_MCP_SECRET_GITHUB', 'plain-secret');
    const server = fakeServer();
    const client = fakeClient({
      'POST projects/Project/secure/tokens': 'credentialsJSON:scrambled',
      'POST vcs-roots': { id: 'Root' },
    });
    register(server as never, client as never, 'full');
    await server.tools.get('create_vcs_root')!.cb({
      project: 'Project',
      id: 'Root',
      name: 'Main',
      url: 'https://example.test/repo.git',
      defaultBranch: 'refs/heads/main',
      authentication: {
        method: 'accessToken',
        token: { kind: 'env', name: 'TEAMCITY_MCP_SECRET_GITHUB' },
      },
    } as never);
    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'projects/Project/secure/tokens',
      body: 'plain-secret',
      opts: {
        accept: 'text/plain',
        contentType: 'text/plain',
        redactValues: ['plain-secret'],
      },
    });
    expect(client.calls[1].body).toMatchObject({
      properties: {
        property: expect.arrayContaining([
          { name: 'authMethod', value: 'ACCESS_TOKEN' },
          { name: 'tokenId', value: 'credentialsJSON:scrambled' },
        ]),
      },
    });
  });

  it('updates only field/property endpoints with text negotiation', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');
    await server.tools.get('update_vcs_root')!.cb({
      vcsRoot: 'id:Root',
      name: 'Renamed',
      setProperties: { authMethod: 'PASSWORD', 'secure:password': 'credentialsJSON:ref' },
      removeProperties: ['username'],
    } as never);
    expect(client.calls).toEqual([
      {
        method: 'PUT',
        path: 'vcs-roots/id:Root/name',
        body: 'Renamed',
        opts: { accept: 'text/plain', contentType: 'text/plain' },
      },
      {
        method: 'PUT',
        path: 'vcs-roots/id:Root/properties/authMethod',
        body: 'PASSWORD',
        opts: { accept: 'text/plain', contentType: 'text/plain' },
      },
      {
        method: 'PUT',
        path: 'vcs-roots/id:Root/properties/secure%3Apassword',
        body: 'credentialsJSON:ref',
        opts: {
          accept: 'text/plain',
          contentType: 'text/plain',
          redactValues: ['credentialsJSON:ref'],
        },
      },
      {
        method: 'DELETE',
        path: 'vcs-roots/id:Root/properties/username',
        opts: { accept: 'text/plain' },
      },
    ]);
    expect(client.calls.some((call) => call.path === 'vcs-roots/id:Root')).toBe(false);
    expect(client.calls.some((call) => call.path.endsWith('/properties'))).toBe(false);
  });

  it('rotates VCS authentication through a project-scoped secure token', async () => {
    vi.stubEnv('TEAMCITY_MCP_SECRET_ROTATED', 'rotated-secret');
    const server = fakeServer();
    const client = fakeClient({
      'vcs-roots/id:Root': { id: 'Root', project: { id: 'Project' } },
      'POST projects/Project/secure/tokens': 'credentialsJSON:rotated',
    });
    register(server as never, client as never, 'full');
    await server.tools.get('update_vcs_root')!.cb({
      vcsRoot: 'id:Root',
      authentication: {
        method: 'password',
        username: 'x-access-token',
        password: { kind: 'env', name: 'TEAMCITY_MCP_SECRET_ROTATED' },
      },
    } as never);
    expect(client.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: 'vcs-roots/id:Root' }),
      expect.objectContaining({
        method: 'POST',
        path: 'projects/Project/secure/tokens',
        body: 'rotated-secret',
      }),
      expect.objectContaining({
        method: 'PUT',
        path: 'vcs-roots/id:Root/properties/secure%3Apassword',
        body: 'credentialsJSON:rotated',
      }),
    ]));
  });

  it('refuses deletion when the confirmation does not match', async () => {
    const server = fakeServer();
    const client = fakeClient({ 'vcs-roots/id:Root': { id: 'Root' } });
    register(server as never, client as never, 'full');
    const result = await server.tools.get('delete_vcs_root')!.cb({
      vcsRoot: 'id:Root',
      confirmVcsRootId: 'Other',
      force: false,
    } as never);
    expect(result).toMatchObject({ isError: true });
    expect(client.calls).toHaveLength(1);
  });

  it('refuses active instances unless force is true', async () => {
    const responses = {
      'vcs-roots/id:Root': { id: 'Root' },
      'vcs-root-instances': { count: 1, 'vcs-root-instance': [{ id: '7' }] },
    };
    const server = fakeServer();
    const client = fakeClient(responses);
    register(server as never, client as never, 'full');
    const refused = await server.tools.get('delete_vcs_root')!.cb({
      vcsRoot: 'id:Root',
      confirmVcsRootId: 'Root',
      force: false,
    } as never);
    expect(refused).toMatchObject({ isError: true });
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);

    const forcedServer = fakeServer();
    const forcedClient = fakeClient(responses);
    register(forcedServer as never, forcedClient as never, 'full');
    const forced = parseResult(
      await forcedServer.tools.get('delete_vcs_root')!.cb({
        vcsRoot: 'id:Root',
        confirmVcsRootId: 'Root',
        force: true,
      } as never),
    );
    expect(forced).toMatchObject({ success: true, vcsRootId: 'Root', forced: true });
    expect(forcedClient.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: 'vcs-roots/id:Root',
    });
  });

  it('attaches a single VcsRootEntry entity', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');
    await server.tools.get('attach_vcs_root_to_build_config')!.cb({
      buildType: 'id:Build',
      vcsRootId: 'Root',
      checkoutRules: '+:.',
    } as never);
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: 'buildTypes/id:Build/vcs-root-entries',
      body: {
        id: 'Root',
        'vcs-root': { id: 'Root' },
        'checkout-rules': '+:.',
      },
    });
    expect(client.calls[0].body).not.toHaveProperty('vcs-root-entry');
  });
});
