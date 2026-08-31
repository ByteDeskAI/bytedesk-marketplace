/** Typed VCS-root administration tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { collectionItems, paginate, type TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, LOCATOR_HELP, handler } from './util.js';

const textOptions = { accept: 'text/plain', contentType: 'text/plain' } as const;

const secretSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('reference'),
    value: z
      .string()
      .regex(/^credentialsJSON:[A-Za-z0-9-]+$/, 'Expected a credentialsJSON reference.')
      .describe('Existing TeamCity credentialsJSON reference.'),
  }),
  z.object({
    kind: z.literal('env'),
    name: z
      .string()
      .regex(/^TEAMCITY_MCP_SECRET_[A-Z0-9_]+$/)
      .describe('Server environment variable whose name starts TEAMCITY_MCP_SECRET_.'),
  }),
  z.object({
    kind: z.literal('literal'),
    value: z.string().min(1).describe('Secret value. Prefer reference or env to avoid transcripts.'),
  }),
]);

const authentication = z.discriminatedUnion('method', [
  z.object({ method: z.literal('anonymous') }),
  z.object({
    method: z.literal('password'),
    username: z.string().min(1),
    password: secretSource,
  }),
  z.object({ method: z.literal('accessToken'), token: secretSource }),
  z.object({
    method: z.literal('teamcitySshKey'),
    keyName: z.string().min(1),
    username: z.string().min(1).optional(),
  }),
]);

type SecretSource = z.infer<typeof secretSource>;
type Authentication = z.infer<typeof authentication>;

function sensitiveName(name: string): boolean {
  return /(^secure:|password|secret|token|credential)/i.test(name);
}

/** Redact secure property values without hiding safe credential-reference metadata. */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const propertyIsSensitive = typeof input.name === 'string' && sensitiveName(input.name);
  return Object.fromEntries(
    Object.entries(input).map(([key, item]) => {
      if (
        (propertyIsSensitive && key === 'value') ||
        (sensitiveName(key) && key !== 'name' && key !== 'tokenId')
      ) {
        return [key, '[REDACTED]'];
      }
      return [key, sanitize(item)];
    }),
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Secret environment variable ${name} is not set or is empty.`);
  return value;
}

async function credentialReference(
  client: TeamCityClient,
  project: string,
  source: SecretSource,
): Promise<string> {
  if (source.kind === 'reference') return source.value;
  const secret = source.kind === 'env' ? requiredEnv(source.name) : source.value;
  const result = await client.post(`projects/${project}/secure/tokens`, secret, {
    ...textOptions,
    redactValues: [secret],
  });
  if (typeof result !== 'string' || !result.startsWith('credentialsJSON:')) {
    throw new Error('TeamCity returned no credentialsJSON reference.');
  }
  return result;
}

async function authenticationProperties(
  client: TeamCityClient,
  project: string | undefined,
  auth: Authentication,
): Promise<Record<string, string>> {
  switch (auth.method) {
    case 'anonymous':
      return { authMethod: 'ANONYMOUS' };
    case 'password': {
      if (auth.password.kind !== 'reference' && !project) {
        throw new Error('The VCS root project could not be resolved for secure-token creation.');
      }
      return {
        authMethod: 'PASSWORD',
        username: auth.username,
        'secure:password': await credentialReference(client, project ?? '', auth.password),
      };
    }
    case 'accessToken': {
      if (auth.token.kind !== 'reference' && !project) {
        throw new Error('The VCS root project could not be resolved for secure-token creation.');
      }
      return {
        authMethod: 'ACCESS_TOKEN',
        tokenId: await credentialReference(client, project ?? '', auth.token),
      };
    }
    case 'teamcitySshKey':
      return {
        authMethod: 'TEAMCITY_SSH_KEY',
        teamcitySshKey: auth.keyName,
        ...(auth.username !== undefined ? { username: auth.username } : {}),
      };
  }
}

function propertyList(properties: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(properties).map(([name, value]) => ({ name, value }));
}

function rootId(root: unknown): string | undefined {
  if (!root || typeof root !== 'object') return undefined;
  const id = (root as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_vcs_roots',
    {
      description:
        'List configured VCS roots. Suggested fields: "count,vcs-root(id,name,type,projectId)".',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().int().min(1).optional().default(100),
        maxPages: z.number().int().min(1).optional(),
        all: z.boolean().optional(),
      },
    },
    handler(async (args) =>
      sanitize(
        await paginate(client, 'vcs-roots', {
          locator: args.locator,
          fields: args.fields,
          pageSize: args.pageSize,
          maxPages: args.maxPages,
          all: args.all,
        }),
      ),
    ),
  );

  server.registerTool(
    'get_vcs_root',
    {
      description: 'Get one VCS root definition. Secure property values are always redacted.',
      inputSchema: {
        vcsRoot: z.string().describe('VCS root locator, e.g. "id:Project_Main".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      sanitize(await client.get(`vcs-roots/${args.vcsRoot}`, { fields: args.fields })),
    ),
  );

  server.registerTool(
    'inspect_vcs_root_connection',
    {
      description:
        'Inspect the instances and current/previous connection-check status for a VCS root.',
      inputSchema: {
        vcsRoot: z.string().describe('VCS root ID (without an id: prefix).'),
        includeRepositoryState: z.boolean().optional().default(true),
        fields: z
          .string()
          .optional()
          .default(
            'count,vcs-root-instance(id,vcsRootId,name,status,statusText,lastChecked,lastVersion)',
          )
          .describe(FIELDS_HELP),
      },
    },
    handler(async (args) => {
      const response = await client.get('vcs-root-instances', {
        locator: `vcsRoot:(id:${args.vcsRoot})`,
        fields: args.fields,
      });
      const items = collectionItems(response).items as Array<Record<string, unknown>>;
      if (!args.includeRepositoryState) return sanitize(response);
      const detailed = await Promise.all(
        items.map(async (item) => {
          if (typeof item.id !== 'string' && typeof item.id !== 'number') return item;
          return client.get(`vcs-root-instances/id:${item.id}`, {
            fields:
              'id,name,vcsRootId,lastVersion,lastChecked,status,statusText,repositoryState',
          });
        }),
      );
      return sanitize({ count: detailed.length, items: detailed });
    }),
  );

  if (mode !== 'full') return;

  server.registerTool(
    'create_vcs_root',
    {
      description:
        'Create a Git VCS root. Env/literal credentials are first stored as TeamCity secure tokens.',
      inputSchema: {
        project: z.string().min(1).describe('Owning TeamCity project ID.'),
        id: z.string().min(1).describe('New VCS root ID.'),
        name: z.string().min(1).describe('Display name.'),
        url: z.string().min(1).describe('Git repository URL.'),
        defaultBranch: z.string().min(1).optional().default('refs/heads/main'),
        branchSpecification: z.string().optional(),
        checkout: z
          .object({
            agentCleanPolicy: z.string().optional(),
            agentCleanFilesPolicy: z.string().optional(),
            submoduleCheckout: z.string().optional(),
            useAlternates: z.string().optional(),
            ignoreKnownHosts: z.boolean().optional(),
            usernameStyle: z.string().optional(),
          })
          .optional()
          .describe('Git checkout, cleanup, submodule, and host-key policy.'),
        authentication: authentication.optional().default({ method: 'anonymous' }),
        properties: z
          .record(z.string())
          .optional()
          .describe('Additional Git VCS properties. Typed fields take precedence.'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) => {
      const properties: Record<string, string> = { ...(args.properties ?? {}) };
      properties.url = args.url;
      properties.branch = args.defaultBranch;
      if (args.branchSpecification !== undefined) {
        properties['teamcity:branchSpec'] = args.branchSpecification;
      }
      for (const [name, value] of Object.entries(args.checkout ?? {})) {
        if (value !== undefined) properties[name] = String(value);
      }

      Object.assign(
        properties,
        await authenticationProperties(client, args.project, args.authentication),
      );

      return sanitize(
        await client.post(
          'vcs-roots',
          {
            id: args.id,
            name: args.name,
            vcsName: 'jetbrains.git',
            project: { id: args.project },
            properties: { property: propertyList(properties) },
          },
          { fields: args.fields },
        ),
      );
    }),
  );

  server.registerTool(
    'update_vcs_root',
    {
      description:
        'Update VCS root fields and individual properties using supported text/plain endpoints.',
      inputSchema: {
        vcsRoot: z.string().describe('VCS root locator, e.g. "id:Project_Main".'),
        name: z.string().min(1).optional(),
        authentication: authentication.optional(),
        setProperties: z.record(z.string()).optional(),
        removeProperties: z.array(z.string().min(1)).optional(),
      },
    },
    handler(async (args) => {
      const desiredProperties: Record<string, string> = { ...(args.setProperties ?? {}) };
      if (args.authentication !== undefined) {
        const needsProject =
          (args.authentication.method === 'password' &&
            args.authentication.password.kind !== 'reference') ||
          (args.authentication.method === 'accessToken' &&
            args.authentication.token.kind !== 'reference');
        let projectId: string | undefined;
        if (needsProject) {
          const root = (await client.get(`vcs-roots/${args.vcsRoot}`, {
            fields: 'id,project(id),projectId',
          })) as Record<string, unknown>;
          const project = root.project;
          projectId =
            project && typeof project === 'object' &&
            typeof (project as Record<string, unknown>).id === 'string'
              ? ((project as Record<string, unknown>).id as string)
              : typeof root.projectId === 'string'
                ? root.projectId
                : undefined;
        }
        Object.assign(
          desiredProperties,
          await authenticationProperties(client, projectId, args.authentication),
        );
      }
      const setNames = new Set(Object.keys(desiredProperties));
      const overlap = (args.removeProperties ?? []).find((name) => setNames.has(name));
      if (overlap) throw new Error(`Property ${overlap} cannot be both set and removed.`);

      const updatedFields: string[] = [];
      const setProperties: string[] = [];
      const removedProperties: string[] = [];
      if (args.name !== undefined) {
        await client.put(`vcs-roots/${args.vcsRoot}/name`, args.name, textOptions);
        updatedFields.push('name');
      }
      for (const [name, value] of Object.entries(desiredProperties)) {
        await client.put(
          `vcs-roots/${args.vcsRoot}/properties/${encodeURIComponent(name)}`,
          value,
          {
            ...textOptions,
            ...(sensitiveName(name) ? { redactValues: [value] } : {}),
          },
        );
        setProperties.push(name);
      }
      for (const name of args.removeProperties ?? []) {
        await client.delete(
          `vcs-roots/${args.vcsRoot}/properties/${encodeURIComponent(name)}`,
          { accept: 'text/plain' },
        );
        removedProperties.push(name);
      }
      return { success: true, updatedFields, setProperties, removedProperties };
    }),
  );

  server.registerTool(
    'delete_vcs_root',
    {
      description:
        'Delete a VCS root after exact-ID confirmation. Refuses roots with instances unless forced.',
      inputSchema: {
        vcsRoot: z.string().describe('VCS root locator, e.g. "id:Project_Main".'),
        confirmVcsRootId: z.string().describe('Exact resolved VCS root ID to confirm deletion.'),
        force: z.boolean().optional().default(false),
      },
    },
    handler(async (args) => {
      const root = await client.get(`vcs-roots/${args.vcsRoot}`, { fields: 'id' });
      const resolvedId = rootId(root);
      if (!resolvedId) throw new Error('TeamCity did not return the resolved VCS root ID.');
      if (args.confirmVcsRootId !== resolvedId) {
        throw new Error(`Deletion confirmation must exactly match VCS root ID ${resolvedId}.`);
      }
      const instances = await client.get('vcs-root-instances', {
        locator: `vcsRoot:(id:${resolvedId})`,
        fields: 'count,vcs-root-instance(id,name,vcs-root-id)',
      });
      const items = collectionItems(instances).items;
      const reportedCount =
        instances && typeof instances === 'object'
          ? Number((instances as Record<string, unknown>).count ?? 0)
          : 0;
      const activeCount = Math.max(items.length, Number.isFinite(reportedCount) ? reportedCount : 0);
      if (activeCount > 0 && !args.force) {
        throw new Error(
          `VCS root ${resolvedId} has ${activeCount} active instance(s); retry with force:true to delete.`,
        );
      }
      await client.delete(`vcs-roots/id:${resolvedId}`);
      return { success: true, vcsRootId: resolvedId, forced: args.force && activeCount > 0 };
    }),
  );

  server.registerTool(
    'attach_vcs_root_to_build_config',
    {
      description: 'Attach one existing VCS root to a build configuration with optional checkout rules.',
      inputSchema: {
        buildType: z.string().describe('Build configuration locator, e.g. "id:Build_Main".'),
        vcsRootId: z.string().min(1).describe('VCS root ID.'),
        checkoutRules: z.string().optional(),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      sanitize(
        await client.post(
          `buildTypes/${args.buildType}/vcs-root-entries`,
          {
            id: args.vcsRootId,
            'vcs-root': { id: args.vcsRootId },
            ...(args.checkoutRules !== undefined && { 'checkout-rules': args.checkoutRules }),
          },
          { fields: args.fields },
        ),
      ),
    ),
  );
}
