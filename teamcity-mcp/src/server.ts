import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamCityClient } from './teamcity/client.js';
import type { McpMode } from './config.js';
import { register as registerBuilds } from './tools/builds.js';
import { register as registerQueue } from './tools/queue.js';
import { register as registerBuildTypes } from './tools/buildtypes.js';
import { register as registerProjects } from './tools/projects.js';
import { register as registerProjectFeatures } from './tools/project-features.js';
import { register as registerProjectCredentials } from './tools/project-credentials.js';
import { register as registerVersionedSettings } from './tools/versioned-settings.js';
import { register as registerVcs } from './tools/vcs.js';
import { register as registerAgents } from './tools/agents.js';
import { register as registerTests } from './tools/tests.js';
import { register as registerChanges } from './tools/changes.js';
import { register as registerUsers } from './tools/users.js';
import { register as registerPassthrough } from './tools/passthrough.js';

const REGISTRARS = [
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

/** Build a fresh McpServer with every tool module registered (mode-gated). */
export function createMcpServer(client: TeamCityClient, mode: McpMode): McpServer {
  const server = new McpServer(
    { name: 'teamcity-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );
  for (const register of REGISTRARS) register(server, client, mode);
  return server;
}
