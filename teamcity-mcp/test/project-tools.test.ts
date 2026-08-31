import { afterEach, describe, expect, it, vi } from 'vitest';
import { register as registerProjects } from '../src/tools/projects.js';
import { register as registerProjectFeatures } from '../src/tools/project-features.js';
import { register as registerProjectCredentials } from '../src/tools/project-credentials.js';

type ToolEntry = { cb: (args: never) => Promise<unknown> };
type Call = { method: string; path: string; body?: unknown; opts?: unknown };

function fakeServer() {
  const tools = new Map<string, ToolEntry>();
  return {
    tools,
    registerTool(name: string, _config: unknown, cb: ToolEntry['cb']) {
      tools.set(name, { cb });
    },
  };
}

function fakeClient(
  responses: Record<string, unknown> = {},
  failures: Record<string, Error> = {},
) {
  const calls: Call[] = [];
  const invoke = async (method: string, path: string, body?: unknown, opts?: unknown) => {
    calls.push({ method, path, body, opts });
    if (failures[path]) throw failures[path];
    return responses[path] ?? { success: true };
  };
  return {
    calls,
    get: vi.fn((path: string, opts?: unknown) => invoke('GET', path, undefined, opts)),
    post: vi.fn((path: string, body?: unknown, opts?: unknown) =>
      invoke('POST', path, body, opts),
    ),
    put: vi.fn((path: string, body?: unknown, opts?: unknown) =>
      invoke('PUT', path, body, opts),
    ),
    delete: vi.fn((path: string, opts?: unknown) => invoke('DELETE', path, undefined, opts)),
  };
}

function resultJson(result: unknown): unknown {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text);
}

function errorText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

afterEach(() => {
  delete process.env.TEAMCITY_MCP_SECRET_TEST;
  vi.restoreAllMocks();
});

describe('project parameter tools', () => {
  it('registers parameter reads in read mode and mutations only in full mode', () => {
    const read = fakeServer();
    const full = fakeServer();
    const client = fakeClient();
    registerProjects(read as never, client as never, 'read');
    registerProjects(full as never, client as never, 'full');

    expect(read.tools.has('list_project_parameters')).toBe(true);
    expect(read.tools.has('get_project_parameter')).toBe(true);
    expect(read.tools.has('set_project_parameter')).toBe(false);
    expect(read.tools.has('delete_project')).toBe(false);
    expect(full.tools.has('set_project_parameter')).toBe(true);
    expect(full.tools.has('delete_project')).toBe(true);
  });

  it('reads parameter metadata without requesting values', async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerProjects(server as never, client as never, 'read');

    await server.tools.get('list_project_parameters')!.cb({ project: 'id:X' } as never);
    await server.tools.get('get_project_parameter')!.cb({
      project: 'id:X',
      name: 'env.A/B',
    } as never);

    expect(client.calls).toEqual([
      {
        method: 'GET',
        path: 'projects/id:X/parameters',
        body: undefined,
        opts: { fields: 'count,property(name,own,inherited,type(rawValue))' },
      },
      {
        method: 'GET',
        path: 'projects/id:X/parameters/env.A%2FB',
        body: undefined,
        opts: { fields: 'name,own,inherited,type(rawValue)' },
      },
    ]);
  });

  it('atomically PUTs one property and never echoes its value', async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerProjects(server as never, client as never, 'full');

    const result = await server.tools.get('set_project_parameter')!.cb({
      project: 'id:X',
      name: 'secure:api',
      value: 'do-not-echo',
      typeRawValue: "password display='hidden'",
    } as never);

    expect(client.calls).toEqual([
      {
        method: 'PUT',
        path: 'projects/id:X/parameters/secure%3Aapi',
        body: {
          name: 'secure:api',
          value: 'do-not-echo',
          type: { rawValue: "password display='hidden'" },
        },
        opts: { redactValues: ['do-not-echo'] },
      },
    ]);
    expect(JSON.stringify(resultJson(result))).not.toContain('do-not-echo');
  });

  it('requires exactly one value source and resolves allowed environment variables', async () => {
    process.env.TEAMCITY_MCP_SECRET_TEST = 'from-env';
    const server = fakeServer();
    const client = fakeClient();
    registerProjects(server as never, client as never, 'full');
    const tool = server.tools.get('set_project_parameter')!;

    const invalid = await tool.cb({ project: 'id:X', name: 'p' } as never);
    expect(errorText(invalid)).toContain('exactly one');
    await tool.cb({
      project: 'id:X',
      name: 'p',
      valueFromEnv: 'TEAMCITY_MCP_SECRET_TEST',
    } as never);
    expect(client.calls[0].body).toEqual({ name: 'p', value: 'from-env' });
  });
});

describe('project deletion', () => {
  it('refuses mismatched confirmation and non-empty projects before DELETE', async () => {
    const response = {
      id: 'Resolved',
      buildTypes: { count: 1 },
      templates: { count: 0 },
      projects: { count: 0 },
    };
    const server = fakeServer();
    const client = fakeClient({ 'projects/id:Alias': response });
    registerProjects(server as never, client as never, 'full');
    const tool = server.tools.get('delete_project')!;

    expect(errorText(await tool.cb({
      project: 'id:Alias',
      confirmProjectId: 'Wrong',
      allowNonEmpty: false,
    } as never))).toContain('does not match');
    expect(errorText(await tool.cb({
      project: 'id:Alias',
      confirmProjectId: 'Resolved',
      allowNonEmpty: false,
    } as never))).toContain('not empty');
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('deletes the resolved project ID after preflight', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'projects/id:X': {
        id: 'X',
        buildTypes: { count: 0 },
        templates: { count: 0 },
        projects: { count: 0 },
      },
    });
    registerProjects(server as never, client as never, 'full');
    await server.tools.get('delete_project')!.cb({
      project: 'id:X',
      confirmProjectId: 'X',
      allowNonEmpty: false,
    } as never);
    expect(client.calls.at(-1)).toMatchObject({ method: 'DELETE', path: 'projects/id:X' });
  });
});

describe('project feature tools', () => {
  it('uses canonical feature collection and entity endpoints', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'projects/id:X/projectFeatures/id:F': { id: 'F', type: 'versionedSettings' },
    });
    registerProjectFeatures(server as never, client as never, 'full');

    await server.tools.get('list_project_features')!.cb({ project: 'id:X' } as never);
    await server.tools.get('create_project_feature')!.cb({
      project: 'id:X',
      id: 'F',
      type: 'versionedSettings',
      properties: { enabled: 'true' },
    } as never);
    await server.tools.get('delete_project_feature')!.cb({
      project: 'id:X',
      feature: 'id:F',
      confirmFeatureId: 'F',
    } as never);

    expect(client.calls.find((call) => call.method === 'POST')).toMatchObject({
      path: 'projects/id:X/projectFeatures',
      body: {
        id: 'F',
        type: 'versionedSettings',
        properties: { property: [{ name: 'enabled', value: 'true' }] },
      },
    });
    expect(client.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: 'projects/id:X/projectFeatures/id:F',
    });
  });

  it('requires exact resolved feature confirmation', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'projects/id:X/projectFeatures/id:F': { id: 'F' },
    });
    registerProjectFeatures(server as never, client as never, 'full');
    const result = await server.tools.get('delete_project_feature')!.cb({
      project: 'id:X',
      feature: 'id:F',
      confirmFeatureId: 'Other',
    } as never);
    expect(errorText(result)).toContain('does not match');
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
});

describe('project credential tools', () => {
  it('returns only SSH-key metadata', async () => {
    const server = fakeServer();
    const client = fakeClient({
      'projects/id:X/sshKeys': {
        sshKey: [{ name: 'deploy', fingerprint: 'SHA256:abc', privateKey: 'never' }],
      },
    });
    registerProjectCredentials(server as never, client as never, 'read');
    const result = await server.tools.get('list_project_ssh_keys')!.cb({ project: 'id:X' } as never);
    expect(resultJson(result)).toEqual({
      count: 1,
      items: [{ name: 'deploy', fingerprint: 'SHA256:abc' }],
    });
    expect(JSON.stringify(resultJson(result))).not.toContain('never');
  });

  it('creates a secure token with text negotiation without echoing the secret', async () => {
    const server = fakeServer();
    const client = fakeClient({ 'projects/id:X/secure/tokens': 'credentialsJSON:uuid' });
    registerProjectCredentials(server as never, client as never, 'full');
    const result = await server.tools.get('create_project_secure_token')!.cb({
      project: 'id:X',
      secret: { kind: 'literal', value: 'do-not-echo' },
    } as never);

    expect(client.calls[0]).toEqual({
      method: 'POST',
      path: 'projects/id:X/secure/tokens',
      body: 'do-not-echo',
      opts: {
        accept: 'text/plain',
        contentType: 'text/plain',
        redactValues: ['do-not-echo'],
      },
    });
    expect(resultJson(result)).toEqual({ reference: 'credentialsJSON:uuid' });
  });

  it('aggregates metadata across parents and tolerates an unavailable source', async () => {
    const responses = {
      'projects/id:Child': { id: 'Child', parentProjectId: 'Parent' },
      'projects/id:Parent': { id: 'Parent' },
      'projects/id:Child/parameters': {
        property: [{ name: 'secure:token', type: { rawValue: 'password' }, value: 'never' }],
      },
      'projects/id:Child/versionedSettings/tokens': { token: [{ name: 'github' }] },
      'projects/id:Parent/parameters': { property: [] },
      'projects/id:Parent/sshKeys': { sshKey: [{ name: 'parent-key' }] },
      'projects/id:Parent/versionedSettings/tokens': { token: [] },
      'vcs-roots': {
        'vcs-root': [
          {
            id: 'Root',
            properties: {
              property: [
                { name: 'secure:password', value: 'credentialsJSON:uuid' },
                { name: 'url', value: 'https://example.invalid/repo.git' },
              ],
            },
          },
        ],
      },
    };
    const client = fakeClient(responses, {
      'projects/id:Child/sshKeys': new Error('unavailable'),
    });
    const server = fakeServer();
    registerProjectCredentials(server as never, client as never, 'read');
    const result = await server.tools.get('inspect_project_vcs_credentials')!.cb({
      project: 'id:Child',
      includeParents: true,
      maxParentLevels: 20,
    } as never);
    const json = resultJson(result) as { projectsInspected: number; items: unknown[] };

    expect(json.projectsInspected).toBe(2);
    expect(JSON.stringify(json)).not.toContain('never');
    expect(JSON.stringify(json)).not.toContain('example.invalid');
    expect(JSON.stringify(json)).toContain('credentialsJSON:uuid');
    expect(JSON.stringify(json)).toContain('parent-key');
  });
});
