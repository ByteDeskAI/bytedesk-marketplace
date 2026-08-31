import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamCityClient } from '../teamcity/client.js';
import type { McpMode } from '../config.js';

/** Successful tool result carrying pretty-printed JSON. */
export function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Error tool result (isError per MCP spec). */
export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

/** Wrap a tool handler with uniform error mapping. */
export function handler<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return jsonResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
}

/**
 * Registration signature shared by every tools/*.ts module. `mode` is 'full' or 'read';
 * modules must skip write tools when mode === 'read'.
 */
export type RegisterTools = (
  server: McpServer,
  client: TeamCityClient,
  mode: McpMode,
) => void;

export const LOCATOR_HELP =
  'TeamCity locator DSL: comma-separated dimension:value filters, e.g. ' +
  '"status:FAILURE,branch:default:any". Nest with parentheses: "buildType:(id:X)". ' +
  'Common build dims: id, number, buildType, project, status(SUCCESS|FAILURE|ERROR), ' +
  'state(queued|running|finished), running, finished, personal, pinned, tag, branch, user, ' +
  'revision, startDate/finishDate, defaultFilter(false to include personal/non-default), ' +
  'count, start, lookupLimit. Append /$help as the locator to any collection to list its dims.';

export const FIELDS_HELP =
  'TeamCity partial-response syntax, e.g. "count,build(id,number,status,buildTypeId)". ' +
  'Lists return basic fields by default; always project only what you need.';

/** Whether a TeamCity property/key name conventionally carries secret material. */
export function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes('reference')) return false;
  return (
    lower.startsWith('secure:') ||
    /(^|[._:-])(password|secret|token)($|[._:-])/.test(lower) ||
    lower === 'accesstoken'
  );
}

/** Recursively redact secret-shaped values while preserving safe names and references. */
export function sanitizeSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSecrets);
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const propertyName = typeof source.name === 'string' ? source.name : undefined;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === 'value' && propertyName && isSensitiveName(propertyName)) {
      out[key] = '[REDACTED]';
    } else if (isSensitiveName(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = sanitizeSecrets(child);
    }
  }
  return out;
}
