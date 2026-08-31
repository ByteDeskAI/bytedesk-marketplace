import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from '../src/tools/versioned-settings.js';

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

function fakeClient(responses: Record<string, unknown | unknown[]> = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown; opts?: unknown }> = [];
  const getCounts = new Map<string, number>();
  return {
    calls,
    get: vi.fn(async (path: string, opts?: unknown) => {
      calls.push({ method: 'GET', path, opts });
      const response = responses[path];
      if (!Array.isArray(response)) return response ?? {};
      const index = getCounts.get(path) ?? 0;
      getCounts.set(path, index + 1);
      return response[Math.min(index, response.length - 1)];
    }),
    post: vi.fn(async (path: string, body?: unknown, opts?: unknown) => {
      calls.push({ method: 'POST', path, body, opts });
      return { success: true };
    }),
    put: vi.fn(async (path: string, body?: unknown, opts?: unknown) => {
      calls.push({ method: 'PUT', path, body, opts });
      return { success: true };
    }),
  };
}

function parsed(result: unknown): unknown {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEAMCITY_MCP_SECRET_TEST_TOKEN;
});

describe('Versioned Settings tool registration', () => {
  it('registers four reads in read mode and all eight tools in full mode', () => {
    const readServer = fakeServer();
    register(readServer as never, fakeClient() as never, 'read');
    expect([...readServer.tools.keys()].sort()).toEqual([
      'get_project_versioned_settings',
      'get_project_versioned_settings_status',
      'list_project_versioned_settings_tokens',
      'wait_for_project_versioned_settings',
    ]);

    const fullServer = fakeServer();
    register(fullServer as never, fakeClient() as never, 'full');
    expect([...fullServer.tools.keys()]).toHaveLength(8);
    expect(fullServer.tools.has('configure_project_versioned_settings')).toBe(true);
    expect(fullServer.tools.has('load_project_versioned_settings')).toBe(true);
    expect(fullServer.tools.has('check_project_versioned_settings_changes')).toBe(true);
    expect(fullServer.tools.has('set_project_versioned_settings_token')).toBe(true);
  });
});

describe('Versioned Settings requests', () => {
  it('uses the canonical config and status endpoints', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'read');

    await server.tools.get('get_project_versioned_settings')!.cb({
      project: 'id:Demo',
      fields: 'format,vcsRootId',
    } as never);
    await server.tools.get('get_project_versioned_settings_status')!.cb({
      project: 'id:Demo',
    } as never);

    expect(client.calls).toEqual([
      {
        method: 'GET',
        path: 'projects/id:Demo/versionedSettings/config',
        opts: { fields: 'format,vcsRootId' },
      },
      {
        method: 'GET',
        path: 'projects/id:Demo/versionedSettings/status',
        opts: { fields: undefined },
      },
    ]);
  });

  it('omits server stack traces from status errors', async () => {
    const path = 'projects/id:Demo/versionedSettings/status';
    const server = fakeServer();
    const client = fakeClient({
      [path]: {
        type: 'error',
        versionedSettingsError: [
          {
            type: 'dsl',
            file: 'settings.kts',
            message: 'Compilation failed',
            stackTraceLines: ['sensitive server detail'],
          },
        ],
      },
    });
    register(server as never, client as never, 'read');

    const result = await server.tools.get('get_project_versioned_settings_status')!.cb({
      project: 'id:Demo',
    } as never);
    expect(parsed(result)).toEqual({
      type: 'error',
      versionedSettingsError: [
        { type: 'dsl', file: 'settings.kts', message: 'Compilation failed' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('sensitive server detail');
  });

  it('maps configuration fields to the TeamCity VersionedSettingsConfig schema', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');

    await server.tools.get('configure_project_versioned_settings')!.cb({
      project: 'id:Demo',
      format: 'kotlin',
      synchronizationMode: 'enabled',
      vcsRootId: 'Demo_Settings',
      allowUiEditing: false,
      importDecision: 'importFromVCS',
      storeSecureValuesOutsideVcs: true,
    } as never);

    expect(client.calls[0]).toEqual({
      method: 'PUT',
      path: 'projects/id:Demo/versionedSettings/config',
      body: {
        format: 'kotlin',
        synchronizationMode: 'enabled',
        vcsRootId: 'Demo_Settings',
        importDecision: 'importFromVCS',
        storeSecureValuesOutsideVcs: true,
        allowUIEditing: false,
      },
      opts: { fields: undefined },
    });
  });

  it('rejects an empty configuration rather than PUTting an empty entity', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');

    const result = await server.tools.get('configure_project_versioned_settings')!.cb({
      project: 'id:Demo',
    } as never);
    expect(result).toMatchObject({ isError: true });
    expect(client.calls).toHaveLength(0);
  });

  it('posts synchronization actions to their canonical endpoints', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');

    await server.tools.get('load_project_versioned_settings')!.cb({
      project: 'id:Demo',
      fields: 'project(id)',
    } as never);
    await server.tools.get('check_project_versioned_settings_changes')!.cb({
      project: 'id:Demo',
    } as never);

    expect(client.calls).toEqual([
      {
        method: 'POST',
        path: 'projects/id:Demo/versionedSettings/loadSettings',
        body: undefined,
        opts: { fields: 'project(id)' },
      },
      {
        method: 'POST',
        path: 'projects/id:Demo/versionedSettings/checkForChanges',
        body: undefined,
        opts: undefined,
      },
    ]);
  });
});

describe('Versioned Settings status polling', () => {
  it('polls until the reported operation is complete', async () => {
    const path = 'projects/id:Demo/versionedSettings/status';
    const server = fakeServer();
    const client = fakeClient({
      [path]: [
        { type: 'info', message: 'Synchronization in progress' },
        { type: 'info', message: 'Settings loaded' },
      ],
    });
    register(server as never, client as never, 'read');

    const result = await server.tools.get('wait_for_project_versioned_settings')!.cb({
      project: 'id:Demo',
      timeoutSeconds: 0.1,
      intervalSeconds: 0.001,
    } as never);
    expect(parsed(result)).toEqual({
      completed: true,
      timedOut: false,
      status: { type: 'info', message: 'Settings loaded' },
    });
    expect(client.calls).toHaveLength(2);
  });

  it('returns the last status when polling times out', async () => {
    const path = 'projects/id:Demo/versionedSettings/status';
    const server = fakeServer();
    const client = fakeClient({ [path]: { type: 'info', message: 'Loading settings' } });
    register(server as never, client as never, 'read');

    const result = await server.tools.get('wait_for_project_versioned_settings')!.cb({
      project: 'id:Demo',
      timeoutSeconds: 0.005,
      intervalSeconds: 0.001,
    } as never);
    expect(parsed(result)).toMatchObject({
      completed: false,
      timedOut: true,
      status: { message: 'Loading settings' },
    });
  });
});

describe('Versioned Settings tokens', () => {
  it('removes token values from list results', async () => {
    const path = 'projects/id:Demo/versionedSettings/tokens';
    const server = fakeServer();
    const client = fakeClient({
      [path]: {
        versionedSettingsToken: [
          { name: 'credentialsJSON:abc', description: 'GitHub', value: 'must-not-leak' },
        ],
      },
    });
    register(server as never, client as never, 'read');

    const result = await server.tools.get('list_project_versioned_settings_tokens')!.cb({
      project: 'id:Demo',
    } as never);
    expect(parsed(result)).toEqual({
      versionedSettingsToken: [{ name: 'credentialsJSON:abc', description: 'GitHub' }],
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('posts the required token wrapper and returns metadata only', async () => {
    process.env.TEAMCITY_MCP_SECRET_TEST_TOKEN = 'super-secret';
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');

    const result = await server.tools.get('set_project_versioned_settings_token')!.cb({
      project: 'id:Demo',
      name: 'credentialsJSON:abc',
      description: 'GitHub',
      secret: { kind: 'env', name: 'TEAMCITY_MCP_SECRET_TEST_TOKEN' },
    } as never);

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'projects/id:Demo/versionedSettings/tokens',
      body: {
        versionedSettingsToken: [
          { name: 'credentialsJSON:abc', description: 'GitHub', value: 'super-secret' },
        ],
      },
      opts: { redactValues: ['super-secret'] },
    });
    expect(parsed(result)).toEqual({
      success: true,
      token: { name: 'credentialsJSON:abc', description: 'GitHub' },
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('fails closed when an environment-backed secret is unavailable', async () => {
    const server = fakeServer();
    const client = fakeClient();
    register(server as never, client as never, 'full');

    const result = await server.tools.get('set_project_versioned_settings_token')!.cb({
      project: 'id:Demo',
      name: 'credentialsJSON:abc',
      secret: { kind: 'env', name: 'TEAMCITY_MCP_SECRET_TEST_TOKEN' },
    } as never);
    expect(result).toMatchObject({ isError: true });
    expect(client.calls).toHaveLength(0);
  });
});
