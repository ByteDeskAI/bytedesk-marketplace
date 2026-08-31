/** Secret-safe project credential inventory and token creation tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { collectionItems, type TeamCityClient } from '../teamcity/client.js';
import { handler } from './util.js';

const secretSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('env'),
    name: z.string().regex(/^TEAMCITY_MCP_SECRET_[A-Z0-9_]+$/),
  }),
  z.object({ kind: z.literal('literal'), value: z.string().min(1) }),
]);

function records(value: unknown): Array<Record<string, unknown>> {
  return collectionItems(value).items.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object',
  );
}

function sshKeyMetadata(value: unknown): unknown[] {
  return records(value).map((key) => ({
    ...(typeof key.name === 'string' && { name: key.name }),
    ...(typeof key.fingerprint === 'string' && { fingerprint: key.fingerprint }),
    ...(typeof key.type === 'string' && { type: key.type }),
  }));
}

function parameterMetadata(value: unknown, scope: string): unknown[] {
  return records(value).map((property) => {
    const type = property.type;
    const rawValue =
      type && typeof type === 'object'
        ? (type as Record<string, unknown>).rawValue
        : undefined;
    return {
      name: property.name,
      scope,
      type: typeof rawValue === 'string' ? rawValue : 'configuration-parameter',
    };
  });
}

function vcsCredentialMetadata(value: unknown, scope: string): unknown[] {
  const roots = records(value);
  const output: unknown[] = [];
  for (const root of roots) {
    const properties = records(root.properties);
    for (const property of properties) {
      const name = typeof property.name === 'string' ? property.name : '';
      const raw = typeof property.value === 'string' ? property.value : '';
      const isSecret = /password|token|secret|credential/i.test(name);
      const reference = /^(credentialsJSON:|vault:|env\.)/.test(raw) ? raw : undefined;
      if (!isSecret && reference === undefined) continue;
      output.push({
        name,
        scope,
        type: 'vcs-root-property',
        ...(reference !== undefined && { reference }),
        ...(typeof root.id === 'string' && { vcsRootId: root.id }),
      });
    }
  }
  return output;
}

function versionedTokenMetadata(value: unknown, scope: string): unknown[] {
  return records(value).map((token) => ({
    ...(typeof token.name === 'string' && { name: token.name }),
    scope,
    type: 'versioned-settings-token',
    ...(typeof token.description === 'string' && { description: token.description }),
  }));
}

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_project_ssh_keys',
    {
      description: 'List SSH-key metadata for a project. Private key material is never returned.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
      },
    },
    handler(async (args) => {
      const response = await client.get(`projects/${args.project}/sshKeys`);
      const items = sshKeyMetadata(response);
      return { count: items.length, items };
    }),
  );

  server.registerTool(
    'inspect_project_vcs_credentials',
    {
      description:
        'Inspect credential metadata used by a project and, by default, its parent projects. ' +
        'Returns names, scopes, types, and references only; secret values are omitted.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        includeParents: z.boolean().optional().default(true),
        maxParentLevels: z.number().int().min(1).max(20).optional().default(20),
      },
    },
    handler(async (args) => {
      const credentials: unknown[] = [];
      const unavailableSources: Array<{ scope: string; source: string }> = [];
      const visited = new Set<string>();
      let locator = args.project;
      let level = 0;

      while (level < args.maxParentLevels) {
        const project = (await client.get(`projects/${locator}`, {
          fields: 'id,parentProjectId',
        })) as Record<string, unknown>;
        const projectId = typeof project.id === 'string' ? project.id : undefined;
        if (!projectId || visited.has(projectId)) break;
        visited.add(projectId);
        const scope = `project:${projectId}`;

        const sources = await Promise.allSettled([
          client.get(`projects/id:${projectId}/parameters`, {
            fields: 'count,property(name,type(rawValue))',
          }),
          client.get(`projects/id:${projectId}/sshKeys`),
          client.get('vcs-roots', {
            locator: `project:(id:${projectId})`,
            fields: 'count,vcs-root(id,name,properties(property(name,value)))',
          }),
          client.get(`projects/id:${projectId}/versionedSettings/tokens`),
        ]);
        const sourceValue = (index: number): unknown =>
          sources[index]?.status === 'fulfilled' ? sources[index].value : { count: 0 };
        const sourceNames = ['parameters', 'sshKeys', 'vcsRoots', 'versionedSettingsTokens'];
        sources.forEach((source, index) => {
          if (source.status === 'rejected') {
            unavailableSources.push({ scope, source: sourceNames[index] });
          }
        });

        credentials.push(
          ...parameterMetadata(sourceValue(0), scope),
          ...sshKeyMetadata(sourceValue(1)).map((key) => ({
            ...(key as object),
            scope,
            type: 'ssh-key',
          })),
          ...vcsCredentialMetadata(sourceValue(2), scope),
          ...versionedTokenMetadata(sourceValue(3), scope),
        );

        if (!args.includeParents || typeof project.parentProjectId !== 'string') break;
        locator = `id:${project.parentProjectId}`;
        level += 1;
      }

      return {
        count: credentials.length,
        projectsInspected: visited.size,
        items: credentials,
        unavailableSources,
      };
    }),
  );

  if (mode !== 'full') return;

  server.registerTool(
    'create_project_secure_token',
    {
      description:
        'Store a secret in TeamCity and return its opaque credentials reference. The supplied ' +
        'secret is never returned.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        secret: secretSource,
      },
    },
    handler(async (args) => {
      const environmentName =
        args.secret.kind === 'env' ? args.secret.name : undefined;
      const value =
        args.secret.kind === 'literal'
          ? args.secret.value
          : process.env[args.secret.name];
      if (!value) {
        throw new Error(`Environment variable ${environmentName} is not set.`);
      }
      const reference = await client.post(`projects/${args.project}/secure/tokens`, value, {
        accept: 'text/plain',
        contentType: 'text/plain',
        redactValues: [value],
      });
      if (typeof reference !== 'string' || !reference.startsWith('credentialsJSON:')) {
        throw new Error('TeamCity did not return a credentialsJSON reference.');
      }
      return { reference };
    }),
  );
}
