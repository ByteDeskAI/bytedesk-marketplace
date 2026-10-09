import { z } from 'zod';

/**
 * full = every tool; read = read-only tools; lead = read-only tools plus a trigger_build that
 * refuses any build configuration outside `project` and any deploy configuration.
 */
export type McpMode = 'full' | 'read' | 'lead';
export type McpTransport = 'http' | 'stdio';

export interface TeamCityAuth {
  kind: 'token' | 'basic';
  token?: string;
  username?: string;
  password?: string;
}

export interface Config {
  teamcityUrl: string;
  auth: TeamCityAuth;
  perRequestAuth: boolean;
  mode: McpMode;
  /** TeamCity project id a lead may trigger builds in (lead mode only). */
  project?: string;
  transport: McpTransport;
  host: string;
  port: number;
  mcpAuthToken?: string;
  stateless: boolean;
}

const envSchema = z.object({
  TEAMCITY_URL: z.string().url(),
  TEAMCITY_TOKEN: z.string().optional(),
  TEAMCITY_USERNAME: z.string().optional(),
  TEAMCITY_PASSWORD: z.string().optional(),
  TEAMCITY_PER_REQUEST_AUTH: z.string().optional(),
  TEAMCITY_MCP_MODE: z.enum(['full', 'read', 'lead']).optional(),
  TEAMCITY_MCP_PROJECT: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/, 'TEAMCITY_MCP_PROJECT must be a TeamCity project id')
    .optional(),
  HOST: z.string().optional(),
  PORT: z.string().optional(),
  MCP_AUTH_TOKEN: z.string().optional(),
  MCP_STATELESS: z.string().optional(),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).optional(),
});

const truthy = (v: string | undefined): boolean =>
  v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);

  const perRequestAuth = truthy(parsed.TEAMCITY_PER_REQUEST_AUTH);
  const transport: McpTransport = parsed.MCP_TRANSPORT ?? 'http';
  if (transport === 'stdio' && perRequestAuth) {
    throw new Error('TEAMCITY_PER_REQUEST_AUTH requires the HTTP transport (stdio has no headers)');
  }

  let auth: TeamCityAuth;
  if (parsed.TEAMCITY_TOKEN) {
    auth = { kind: 'token', token: parsed.TEAMCITY_TOKEN };
  } else if (parsed.TEAMCITY_USERNAME && parsed.TEAMCITY_PASSWORD) {
    auth = {
      kind: 'basic',
      username: parsed.TEAMCITY_USERNAME,
      password: parsed.TEAMCITY_PASSWORD,
    };
  } else if (perRequestAuth) {
    // Credentials arrive per-request from the MCP client; server holds none.
    auth = { kind: 'token', token: undefined };
  } else {
    throw new Error(
      'Set TEAMCITY_TOKEN, or TEAMCITY_USERNAME + TEAMCITY_PASSWORD, ' +
        'or enable TEAMCITY_PER_REQUEST_AUTH=true',
    );
  }

  const mode = parsed.TEAMCITY_MCP_MODE ?? 'full';
  if (mode === 'lead' && !parsed.TEAMCITY_MCP_PROJECT) {
    throw new Error('TEAMCITY_MCP_MODE=lead requires TEAMCITY_MCP_PROJECT (the project id it may trigger in)');
  }

  const host = parsed.HOST ?? '127.0.0.1';
  const mcpAuthToken = parsed.MCP_AUTH_TOKEN;
  if (transport === 'http' && !LOOPBACK.has(host) && !mcpAuthToken) {
    throw new Error(
      `HOST=${host} is not loopback: MCP_AUTH_TOKEN is required to protect the MCP endpoint`,
    );
  }

  return {
    teamcityUrl: parsed.TEAMCITY_URL.replace(/\/+$/, ''),
    auth,
    perRequestAuth,
    mode,
    project: mode === 'lead' ? parsed.TEAMCITY_MCP_PROJECT : undefined,
    transport,
    host,
    port: parsed.PORT ? Number(parsed.PORT) : 3000,
    mcpAuthToken,
    stateless: truthy(parsed.MCP_STATELESS),
  };
}
