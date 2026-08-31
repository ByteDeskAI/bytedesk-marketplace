/** Project Versioned Settings tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import type { RequestOptions, TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, handler } from './util.js';

const secretSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('env'),
    name: z
      .string()
      .regex(
        /^TEAMCITY_MCP_SECRET_[A-Z0-9_]+$/,
        'Environment variable must start with TEAMCITY_MCP_SECRET_',
      )
      .describe('Server environment variable containing the secret.'),
  }),
  z.object({
    kind: z.literal('literal'),
    value: z.string().min(1).describe('Secret value. Prefer an env source to keep it out of transcripts.'),
  }),
]);

type SecretSource = z.infer<typeof secretSourceSchema>;

function projectPath(project: string, suffix: string): string {
  return `projects/${project}/versionedSettings/${suffix}`;
}

function resolveSecret(source: SecretSource): string {
  if (source.kind === 'literal') return source.value;
  const value = process.env[source.name];
  if (!value) throw new Error(`Secret environment variable ${source.name} is not set or is empty.`);
  return value;
}

function sanitizeTokens(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const record = response as Record<string, unknown>;
  const tokens = Array.isArray(record.versionedSettingsToken)
    ? record.versionedSettingsToken.map((token) => {
        if (!token || typeof token !== 'object') return token;
        const { value: _value, ...safe } = token as Record<string, unknown>;
        return safe;
      })
    : [];
  return {
    ...record,
    versionedSettingsToken: tokens,
  };
}

function sanitizeStatus(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const record = response as Record<string, unknown>;
  if (!Array.isArray(record.versionedSettingsError)) return response;
  return {
    ...record,
    versionedSettingsError: record.versionedSettingsError.map((error) => {
      if (!error || typeof error !== 'object') return error;
      const { stackTraceLines: _stackTraceLines, ...safe } = error as Record<string, unknown>;
      return safe;
    }),
  };
}

function statusIsPending(status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  const record = status as Record<string, unknown>;
  if (Array.isArray(record.versionedSettingsError) && record.versionedSettingsError.length > 0) {
    return false;
  }
  if (/^(error|failure|failed|warning)$/i.test(String(record.type ?? ''))) return false;
  const text = `${String(record.type ?? '')} ${String(record.message ?? '')}`.toLowerCase();
  return /\b(pending|running|processing|in[ -]?progress|checking|loading|synchronizing)\b/.test(text);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'get_project_versioned_settings',
    {
      description: 'Get the Versioned Settings configuration for a project.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      client.get(projectPath(args.project, 'config'), { fields: args.fields }),
    ),
  );

  server.registerTool(
    'get_project_versioned_settings_status',
    {
      description:
        'Get the result and current state of the most recent Versioned Settings update.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      sanitizeStatus(
        await client.get(projectPath(args.project, 'status'), { fields: args.fields }),
      ),
    ),
  );

  server.registerTool(
    'wait_for_project_versioned_settings',
    {
      description:
        'Poll Versioned Settings status until TeamCity no longer reports an in-progress state or the timeout expires.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        timeoutSeconds: z
          .number()
          .positive()
          .max(300)
          .optional()
          .default(60)
          .describe('Maximum wait in seconds (default 60, maximum 300).'),
        intervalSeconds: z
          .number()
          .positive()
          .max(10)
          .optional()
          .default(2)
          .describe('Polling interval in seconds (default 2, maximum 10).'),
      },
    },
    handler(async (args) => {
      const timeoutMs = args.timeoutSeconds * 1000;
      const intervalMs = args.intervalSeconds * 1000;
      const deadline = Date.now() + timeoutMs;
      let status: unknown;

      do {
        status = await client.get(projectPath(args.project, 'status'));
        if (!statusIsPending(status)) {
          return { completed: true, timedOut: false, status: sanitizeStatus(status) };
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(intervalMs, remaining));
      } while (Date.now() < deadline);

      return { completed: false, timedOut: true, status: sanitizeStatus(status) };
    }),
  );

  server.registerTool(
    'list_project_versioned_settings_tokens',
    {
      description:
        'List Versioned Settings credential-token metadata. Secret values are always omitted.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        status: z.string().optional().describe('Optional TeamCity token status filter.'),
      },
    },
    handler(async (args) =>
      sanitizeTokens(
        await client.get(projectPath(args.project, 'tokens'), {
          query: { status: args.status },
        }),
      ),
    ),
  );

  if (mode !== 'full') return;

  server.registerTool(
    'configure_project_versioned_settings',
    {
      description:
        'Configure a project\'s Versioned Settings. Supply at least one setting to change.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        portableDsl: z.boolean().optional(),
        vcsRootId: z.string().optional().describe('ID of the VCS root that stores settings.'),
        settingsPath: z.string().optional().describe('Path within the VCS root.'),
        buildSettingsMode: z
          .enum(['alwaysUseCurrent', 'useFromVCS'])
          .optional()
          .describe('Whether builds use current TeamCity settings or settings loaded from VCS.'),
        showSettingsChanges: z.boolean().optional(),
        synchronizationMode: z
          .enum(['enabled', 'disabled'])
          .optional()
          .describe('Enable or disable synchronization with the settings VCS root.'),
        importDecision: z
          .enum(['importFromVCS', 'overrideInVCS'])
          .optional()
          .describe('Initial conflict decision when both TeamCity and VCS contain settings.'),
        allowUiEditing: z.boolean().optional().describe('Allow project settings edits via UI/REST.'),
        applyChangesInDependenciesAndVcsSettings: z.boolean().optional(),
        storeSecureValuesOutsideVcs: z.boolean().optional(),
        format: z.enum(['kotlin', 'xml']).optional().describe('Versioned settings format.'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) => {
      const {
        project,
        fields,
        allowUiEditing,
        ...provided
      } = args;
      const config = {
        ...provided,
        ...(allowUiEditing !== undefined ? { allowUIEditing: allowUiEditing } : {}),
      } as Record<string, unknown>;
      for (const key of Object.keys(config)) {
        if (config[key] === undefined) delete config[key];
      }
      if (Object.keys(config).length === 0) {
        throw new Error('At least one Versioned Settings field must be supplied.');
      }
      return client.put(projectPath(project, 'config'), config, { fields });
    }),
  );

  server.registerTool(
    'load_project_versioned_settings',
    {
      description: 'Load settings from VCS and override the current project settings.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      client.post(projectPath(args.project, 'loadSettings'), undefined, { fields: args.fields }),
    ),
  );

  server.registerTool(
    'check_project_versioned_settings_changes',
    {
      description: 'Schedule an immediate check for Versioned Settings changes in VCS.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
      },
    },
    handler(async (args) => client.post(projectPath(args.project, 'checkForChanges'))),
  );

  server.registerTool(
    'set_project_versioned_settings_token',
    {
      description:
        'Supply a secret for a Versioned Settings credentialsJSON token without returning its value.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        name: z.string().min(1).describe('Token name, usually credentialsJSON:<id>.'),
        description: z.string().optional().describe('Human-readable token description.'),
        secret: secretSourceSchema,
      },
    },
    handler(async (args) => {
      const value = resolveSecret(args.secret);
      // `redactValues` is consumed by clients that support exact-value error redaction. Keeping
      // it as a structural extension preserves compatibility with older TeamCityClient versions.
      const requestOptions: RequestOptions & { redactValues: string[] } = {
        redactValues: [value],
      };
      await client.post(projectPath(args.project, 'tokens'), {
        versionedSettingsToken: [
          {
            name: args.name,
            ...(args.description !== undefined ? { description: args.description } : {}),
            value,
          },
        ],
      }, requestOptions);
      return {
        success: true,
        token: {
          name: args.name,
          ...(args.description !== undefined ? { description: args.description } : {}),
        },
      };
    }),
  );
}
