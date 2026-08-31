import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { paginate, type TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, handler, LOCATOR_HELP } from './util.js';

const GET_DESCRIPTION = [
  'Raw GET against ANY TeamCity REST endpoint — the unrestricted escape hatch covering the full API surface',
  '(~268 paths; see docs/api-catalog.md for the catalog, or /app/rest/swagger.json on the server).',
  '',
  '`path` is relative to /app/rest, e.g. "builds/id:12345" or "projects"',
  '(leading slashes and a leading "app/rest/" are stripped by the client).',
  '',
  LOCATOR_HELP,
  '',
  FIELDS_HELP,
  '',
  'Pagination: collections page at count=100 by default and the server caps unbounded scans at',
  'lookupLimit=5000. Set pageSize, maxPages, or all to auto-page; the result then becomes',
  '{ count, truncated, nextStart?, items } with the entity array flattened. Without them the raw',
  'JSON response is returned as-is.',
  '',
  'Discovery: GET path "<collection>/$help" (e.g. "builds/$help") lists the locator dimensions',
  'that endpoint supports.',
  '',
  'Examples:',
  '- Failed builds of a configuration: path "builds",',
  '  locator "buildType:(id:Deploy_Prod),status:FAILURE", fields "count,build(id,number,status)"',
  '- One build, projected: path "builds/id:12345", fields "id,number,status,finishDate"',
  '- Page through everything: path "changes", fields "change(id,version,comment)", all true',
].join('\n');

const POST_DESCRIPTION = [
  'Raw POST to ANY TeamCity REST endpoint (write — only registered in full mode).',
  '`path` is relative to /app/rest. `body`: an object is sent as application/json, a string as',
  'text/plain (override with contentType).',
  '',
  LOCATOR_HELP,
  '',
  FIELDS_HELP,
  '',
  'Full path list: docs/api-catalog.md or /app/rest/swagger.json on the server.',
  '',
  'Examples:',
  '- Trigger a build: path "buildQueue", body {"buildType":{"id":"X"}}',
  '  (optional "branchName", "properties":{"property":[{"name":"env.FOO","value":"bar"}]})',
  '- Cancel a build: path "builds/id:12345", body {"comment":"not needed","readdIntoQueue":false}',
  '- Tag a build: path "builds/id:12345/tags", body {"tag":[{"name":"release"}]}',
].join('\n');

const PUT_DESCRIPTION = [
  'Raw PUT to ANY TeamCity REST endpoint (write — only registered in full mode).',
  '`path` is relative to /app/rest. `body`: an object is sent as application/json, a string as',
  'text/plain (override with contentType). Most single-value endpoints want a plain string.',
  '',
  LOCATOR_HELP,
  '',
  FIELDS_HELP,
  '',
  'Full path list: docs/api-catalog.md or /app/rest/swagger.json on the server.',
  '',
  'Examples:',
  '- Set a parameter: path "buildTypes/id:X/parameters/env.FOO/value", body "bar"',
  '- Pin a build: path "builds/id:12345/pinInfo", body {"status":true,"comment":"keep"}',
  '- Authorize an agent: path "agents/id:3/authorizedInfo", body {"status":true}',
].join('\n');

const DELETE_DESCRIPTION = [
  'Raw DELETE against ANY TeamCity REST endpoint (write — only registered in full mode).',
  '`path` is relative to /app/rest.',
  '',
  LOCATOR_HELP,
  '',
  'Full path list: docs/api-catalog.md or /app/rest/swagger.json on the server.',
  '',
  'Examples:',
  '- Delete a build configuration: path "buildTypes/id:X"',
  '- Remove a queued build: path "buildQueue/id:12345"',
  '- Remove a project from an agent pool: path "agentPools/id:3/projects/id:X"',
].join('\n');

const pathParam = z
  .string()
  .describe(
    'Path after /app/rest, e.g. "builds/id:12345" or "projects". Leading slashes and a leading "app/rest/" are stripped.',
  );
const locatorParam = z
  .string()
  .optional()
  .describe(
    'TeamCity locator filter, sent as ?locator=. GET <collection>/$help lists the dimensions of an endpoint.',
  );
const fieldsParam = z
  .string()
  .optional()
  .describe('Partial-response projection, sent as ?fields=, e.g. "count,build(id,number,status)".');
const queryParam = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('Extra query parameters, e.g. {"start":100,"count":10}.');
const bodyParam = z
  .unknown()
  .optional()
  .describe('Request body: an object is sent as application/json, a string as text/plain.');
const contentTypeParam = z
  .string()
  .optional()
  .describe('Explicit Content-Type for the body (default application/json for objects, text/plain for strings).');
const acceptParam = z
  .string()
  .optional()
  .describe('Explicit Accept response media type (defaults to text/plain for string writes and application/json otherwise).');

interface RestGetArgs {
  path: string;
  locator?: string;
  fields?: string;
  query?: Record<string, string | number | boolean>;
  pageSize?: number;
  maxPages?: number;
  all?: boolean;
  accept?: string;
}

interface RestWriteArgs {
  path: string;
  body?: unknown;
  locator?: string;
  fields?: string;
  query?: Record<string, string | number | boolean>;
  contentType?: string;
  accept?: string;
}

interface RestDeleteArgs {
  path: string;
  locator?: string;
  fields?: string;
  query?: Record<string, string | number | boolean>;
  accept?: string;
}

/**
 * Register the raw REST passthrough tools. `teamcity_rest_get` is available in every mode;
 * the write verbs (post/put/delete) are registered only in full mode.
 */
export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'teamcity_rest_get',
    {
      description: GET_DESCRIPTION,
      inputSchema: {
        path: pathParam,
        locator: locatorParam,
        fields: fieldsParam,
        query: queryParam,
        pageSize: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Items per page (TeamCity count, default 100). Setting pageSize, maxPages, or all switches to paginated mode.',
          ),
        maxPages: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Max pages to fetch (default 1, hard cap 50).'),
        all: z
          .boolean()
          .optional()
          .describe('Keep paging until the server stops returning nextHref (bounded by maxPages, default 50).'),
        accept: acceptParam,
      },
    },
    handler(async (args: RestGetArgs) => {
      const { path, locator, fields, query, pageSize, maxPages, all, accept } = args;
      if (pageSize !== undefined || maxPages !== undefined || all !== undefined) {
        const page = await paginate(client, path, { locator, fields, query, pageSize, maxPages, all, accept });
        return {
          count: page.count,
          truncated: page.truncated,
          ...(page.nextStart !== undefined ? { nextStart: page.nextStart } : {}),
          items: page.items,
        };
      }
      return client.get(path, { locator, fields, query, accept });
    }),
  );

  if (mode !== 'full') return;

  server.registerTool(
    'teamcity_rest_post',
    {
      description: POST_DESCRIPTION,
      inputSchema: {
        path: pathParam,
        body: bodyParam,
        locator: locatorParam,
        fields: fieldsParam,
        query: queryParam,
        contentType: contentTypeParam,
        accept: acceptParam,
      },
    },
    handler(async (args: RestWriteArgs) => {
      const { path, body, locator, fields, query, contentType, accept } = args;
      return client.post(path, body, { locator, fields, query, contentType, accept });
    }),
  );

  server.registerTool(
    'teamcity_rest_put',
    {
      description: PUT_DESCRIPTION,
      inputSchema: {
        path: pathParam,
        body: bodyParam,
        locator: locatorParam,
        fields: fieldsParam,
        query: queryParam,
        contentType: contentTypeParam,
        accept: acceptParam,
      },
    },
    handler(async (args: RestWriteArgs) => {
      const { path, body, locator, fields, query, contentType, accept } = args;
      return client.put(path, body, { locator, fields, query, contentType, accept });
    }),
  );

  server.registerTool(
    'teamcity_rest_delete',
    {
      description: DELETE_DESCRIPTION,
      inputSchema: {
        path: pathParam,
        locator: locatorParam,
        fields: fieldsParam,
        query: queryParam,
        accept: acceptParam,
      },
    },
    handler(async (args: RestDeleteArgs) => {
      const { path, locator, fields, query, accept } = args;
      return client.delete(path, { locator, fields, query, accept });
    }),
  );
}
