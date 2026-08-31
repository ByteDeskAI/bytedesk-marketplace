import type { TeamCityAuth } from '../config.js';

export interface RequestOptions {
  /** TeamCity locator string, sent as ?locator= (e.g. "status:FAILURE,branch:default:any"). */
  locator?: string;
  /** Partial-response projection, sent as ?fields= (e.g. "count,build(id,number,status)"). */
  fields?: string;
  /** Extra query parameters. Undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Accept header. Defaults to application/json. */
  accept?: string;
  /** Content-Type for the request body. Defaults to application/json when body is an object. */
  contentType?: string;
  /** Sensitive values to remove from TeamCity error responses. Never sent to TeamCity. */
  redactValues?: string[];
}

export interface BinaryResult {
  data: Buffer;
  contentType: string;
}

export class TeamCityApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`TeamCity ${status} ${statusText}: ${body.slice(0, 500)}`);
    this.name = 'TeamCityApiError';
  }
}

/**
 * Thin async wrapper over the TeamCity REST API.
 *
 * Paths passed to verb methods are relative to `/app/rest` (leading slashes and a leading
 * `app/rest/` are stripped). For basic auth the `/httpAuth` prefix is inserted automatically.
 * Server-root-relative paths (e.g. `/downloadBuildLog.html`) go through `getRootText`.
 */
export class TeamCityClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: TeamCityAuth,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** New client identical to this one but authenticating with a different bearer token. */
  withToken(token: string): TeamCityClient {
    return new TeamCityClient(this.baseUrl, { kind: 'token', token });
  }

  get(path: string, opts: RequestOptions = {}): Promise<unknown> {
    return this.request('GET', path, undefined, opts);
  }

  post(path: string, body?: unknown, opts: RequestOptions = {}): Promise<unknown> {
    return this.request('POST', path, body, opts);
  }

  put(path: string, body?: unknown, opts: RequestOptions = {}): Promise<unknown> {
    return this.request('PUT', path, body, opts);
  }

  delete(path: string, opts: RequestOptions = {}): Promise<unknown> {
    return this.request('DELETE', path, undefined, opts);
  }

  /** GET that always returns the body as text (for text/plain field endpoints). */
  async getText(path: string, opts: RequestOptions = {}): Promise<string> {
    return (await this.request('GET', path, undefined, { ...opts, accept: 'text/plain' }, true)) as string;
  }

  /** GET a server-root-relative path (e.g. /downloadBuildLog.html?buildId=1) as text. */
  async getRootText(path: string): Promise<string> {
    const res = await fetch(this.rootUrl(path), { headers: this.headers('text/plain') });
    if (!res.ok) throw await this.apiError(res, this.rootUrl(path));
    return res.text();
  }

  /** GET a binary resource (artifact download). Path is /app/rest-relative. */
  async getBinary(path: string, opts: RequestOptions = {}): Promise<BinaryResult> {
    const url = this.restUrl(path, opts);
    const res = await fetch(url, {
      headers: this.headers(opts.accept ?? 'application/octet-stream'),
    });
    if (!res.ok) throw await this.apiError(res, url);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /** URL for an /app/rest-relative path. Exported for passthrough tooling/tests. */
  restUrl(path: string, opts: RequestOptions = {}): string {
    const clean = path
      .replace(/^\/+/, '')
      .replace(/^app\/rest\/(latest\/)?/, '')
      .replace(/\/+$/, '');
    const base = `${this.baseUrl}${this.authPrefix()}/app/rest/${clean}`;
    const params = new URLSearchParams();
    if (opts.locator) params.set('locator', opts.locator);
    if (opts.fields) params.set('fields', opts.fields);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private rootUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    const needsPrefix =
      this.auth.kind === 'basic' && !p.startsWith('/httpAuth') && !p.startsWith('/guestAuth');
    return `${this.baseUrl}${needsPrefix ? '/httpAuth' : ''}${p}`;
  }

  private authPrefix(): string {
    return this.auth.kind === 'basic' ? '/httpAuth' : '';
  }

  private headers(accept: string, contentType?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: accept };
    if (this.auth.kind === 'token' && this.auth.token) {
      h.Authorization = `Bearer ${this.auth.token}`;
    } else if (this.auth.kind === 'basic') {
      h.Authorization = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
    }
    if (contentType) h['Content-Type'] = contentType;
    return h;
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions,
    asText = false,
  ): Promise<unknown> {
    const url = this.restUrl(path, opts);
    const defaultAccept = typeof body === 'string' ? 'text/plain' : 'application/json';
    const headers = this.headers(opts.accept ?? defaultAccept);
    let payload: string | undefined;
    if (body !== undefined) {
      if (typeof body === 'string') {
        payload = body;
        headers['Content-Type'] = opts.contentType ?? 'text/plain';
      } else {
        payload = JSON.stringify(body);
        headers['Content-Type'] = opts.contentType ?? 'application/json';
      }
    }
    const res = await fetch(url, { method, headers, body: payload });
    if (!res.ok) throw await this.apiError(res, url, opts.redactValues);
    if (res.status === 204) return { success: true };
    const text = await res.text();
    if (asText || !text) return text;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return JSON.parse(text);
    // Some TeamCity endpoints return JSON without the right content-type; try, else return text.
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async apiError(
    res: Response,
    url: string,
    redactValues: string[] = [],
  ): Promise<TeamCityApiError> {
    // Never leak credentials: URLSearchParams values can't contain the token (it travels in
    // headers), but be defensive about bodies echoing auth data.
    let body = (await res.text().catch(() => '')).replace(/Bearer \S+/g, 'Bearer ***');
    for (const value of redactValues) {
      if (!value) continue;
      body = body.split(value).join('***');
      try {
        body = body.split(encodeURIComponent(value)).join('***');
      } catch {
        // Ignore values that cannot be URI encoded; the literal form was already removed.
      }
    }
    return new TeamCityApiError(res.status, res.statusText, body, url);
  }
}

export interface PageOptions extends RequestOptions {
  /** Items per page (TeamCity `count`). Default 100. */
  pageSize?: number;
  /** Max pages to fetch. Default 1. Hard cap 50 even with `all`. */
  maxPages?: number;
  /** Keep paging until no nextHref (bounded by maxPages). */
  all?: boolean;
}

export interface PagedResult<T = unknown> {
  items: T[];
  /** Total items returned in this result. */
  count: number;
  /** True when the server indicated more pages exist beyond what was fetched. */
  truncated: boolean;
  /** Value to pass as `start` to fetch the next page, when truncated. */
  nextStart?: number;
}

const META_KEYS = new Set(['count', 'href', 'nextHref', 'prevHref', 'start', 'lookupLimit']);

/** Extract the entity array from a TeamCity collection response. */
export function collectionItems(res: unknown): { key: string | null; items: unknown[] } {
  if (Array.isArray(res)) return { key: null, items: res };
  if (res && typeof res === 'object') {
    for (const [k, v] of Object.entries(res as Record<string, unknown>)) {
      if (Array.isArray(v) && !META_KEYS.has(k)) return { key: k, items: v };
    }
  }
  return { key: null, items: [] };
}

/**
 * Fetch one or more pages of a TeamCity collection endpoint and flatten the entity array.
 * Follows `start`-based paging using the server's nextHref as the more-pages signal.
 */
export async function paginate<T = unknown>(
  client: TeamCityClient,
  path: string,
  opts: PageOptions = {},
): Promise<PagedResult<T>> {
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.all ? Math.max(opts.maxPages ?? 50, 1) : (opts.maxPages ?? 1);
  const items: T[] = [];
  let start = Number(opts.query?.start ?? 0) || 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const res = (await client.get(path, {
      ...opts,
      query: { ...opts.query, count: pageSize, start },
    })) as Record<string, unknown>;
    const pageItems = collectionItems(res).items as T[];
    items.push(...pageItems);

    const nextHref = typeof res?.nextHref === 'string' ? res.nextHref : undefined;
    if (!nextHref) {
      truncated = false;
      return { items, count: items.length, truncated };
    }
    // Derive the next offset from nextHref when possible; fall back to start + pageSize.
    const m = /[?&]start=(\d+)/.exec(nextHref);
    start = m ? Number(m[1]) : start + pageSize;
    truncated = true;
  }

  return { items, count: items.length, truncated, nextStart: start };
}
