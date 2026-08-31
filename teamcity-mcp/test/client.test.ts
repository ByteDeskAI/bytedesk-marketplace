import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamCityClient, TeamCityApiError, paginate, collectionItems } from '../src/teamcity/client.js';

const TOKEN = { kind: 'token', token: 'tc-token-123' } as const;
const BASIC = { kind: 'basic', username: 'ryan', password: 's3cret' } as const;
const BASE = 'https://tc.example.com';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('restUrl', () => {
  it('builds token-auth URLs without the httpAuth prefix', () => {
    const c = new TeamCityClient(BASE, TOKEN);
    expect(c.restUrl('builds', { locator: 'status:FAILURE', fields: 'count' })).toBe(
      'https://tc.example.com/app/rest/builds?locator=status%3AFAILURE&fields=count',
    );
  });

  it('inserts /httpAuth for basic auth', () => {
    const c = new TeamCityClient(BASE, BASIC);
    expect(c.restUrl('builds')).toBe('https://tc.example.com/httpAuth/app/rest/builds');
  });

  it('strips leading slashes and a redundant app/rest prefix', () => {
    const c = new TeamCityClient(BASE, TOKEN);
    expect(c.restUrl('/app/rest/latest/projects/')).toBe('https://tc.example.com/app/rest/projects');
  });
});

describe('request', () => {
  it('sends Bearer header for token auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await new TeamCityClient(BASE, TOKEN).get('server');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tc-token-123');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('sends Basic header for basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await new TeamCityClient(BASE, BASIC).get('server');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('ryan:s3cret').toString('base64')}`,
    );
  });

  it('sends object bodies as JSON and string bodies as text/plain', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const c = new TeamCityClient(BASE, TOKEN);
    await c.post('buildQueue', { buildType: { id: 'X' } });
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(fetchMock.mock.calls[0][1].body).toBe('{"buildType":{"id":"X"}}');
    await c.put('builds/id:1/comment', 'hello');
    expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('text/plain');
    expect(fetchMock.mock.calls[1][1].headers.Accept).toBe('text/plain');
    expect(fetchMock.mock.calls[1][1].body).toBe('hello');
  });

  it('honors an explicit Accept override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await new TeamCityClient(BASE, TOKEN).put('some/text/field', 'value', {
      accept: 'application/json',
    });
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('application/json');
  });

  it('throws TeamCityApiError with status on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Incorrect username or password', { status: 401, statusText: 'Unauthorized' })),
    );
    const err = await new TeamCityClient(BASE, TOKEN).get('server').catch((e) => e);
    expect(err).toBeInstanceOf(TeamCityApiError);
    expect(err.status).toBe(401);
    expect(err.message).toContain('Incorrect username or password');
  });

  it('redacts supplied sensitive values from TeamCity errors', async () => {
    const secret = 'literal-secret-value';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`Rejected ${secret} and ${encodeURIComponent(secret)}`, {
          status: 400,
          statusText: 'Bad Request',
        }),
      ),
    );
    const err = await new TeamCityClient(BASE, TOKEN)
      .post('projects/id:X/secure/tokens', secret, { redactValues: [secret] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TeamCityApiError);
    expect(err.message).not.toContain(secret);
    expect(err.body).not.toContain(secret);
    expect(err.message).toContain('***');
  });

  it('getRootText prefixes /httpAuth for basic auth on root-relative paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('log text', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new TeamCityClient(BASE, BASIC).getRootText('/downloadBuildLog.html?buildId=1');
    expect(out).toBe('log text');
    expect(fetchMock.mock.calls[0][0]).toBe('https://tc.example.com/httpAuth/downloadBuildLog.html?buildId=1');
  });
});

describe('collectionItems', () => {
  it('detects the entity array regardless of key name', () => {
    expect(collectionItems({ count: 2, build: [1, 2] })).toEqual({ key: 'build', items: [1, 2] });
    expect(collectionItems({ count: 1, 'vcs-root': ['a'] })).toEqual({ key: 'vcs-root', items: ['a'] });
    expect(collectionItems({ count: 0 })).toEqual({ key: null, items: [] });
  });
});

describe('paginate', () => {
  it('follows nextHref across pages and reports truncation', async () => {
    const page1 = { count: 2, nextHref: '/app/rest/builds?count=2&start=2', build: [{ id: 1 }, { id: 2 }] };
    const page2 = { count: 1, build: [{ id: 3 }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));
    vi.stubGlobal('fetch', fetchMock);
    const c = new TeamCityClient(BASE, TOKEN);
    const res = await paginate(c, 'builds', { pageSize: 2, maxPages: 5 });
    expect(res.items.map((b) => (b as { id: number }).id)).toEqual([1, 2, 3]);
    expect(res.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('start=2');
  });

  it('marks truncated when more pages exist beyond maxPages', async () => {
    const page = { count: 1, nextHref: '/app/rest/builds?count=1&start=1', build: [{ id: 1 }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(page)));
    const c = new TeamCityClient(BASE, TOKEN);
    const res = await paginate(c, 'builds', { pageSize: 1, maxPages: 1 });
    expect(res.truncated).toBe(true);
    expect(res.nextStart).toBe(1);
  });
});
