import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamCityClient } from '../src/teamcity/client.js';
import { getBuildLog } from '../src/teamcity/logs.js';

const TOKEN = { kind: 'token', token: 't' } as const;
const BASE = 'https://tc.example.com';

const LOG = [
  '[10:00:00] : Build started',
  '[10:00:01] : [Step 1/2] compiling',
  '[10:00:02]W: [Step 1/2] warning: deprecated flag',
  '[10:00:03]E: [Step 2/2] error: tests failed',
  '[10:00:04] : [Step 2/2] exit code 1',
].join('\n');

function mockLogFetch(log = LOG) {
  return vi.fn().mockResolvedValue(new Response(log, { status: 200 }));
}

beforeEach(() => vi.restoreAllMocks());

describe('getBuildLog', () => {
  it('downloads the log for a numeric build id', async () => {
    const fetchMock = mockLogFetch();
    vi.stubGlobal('fetch', fetchMock);
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: '12345' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://tc.example.com/downloadBuildLog.html?buildId=12345');
    expect(res.totalLines).toBe(5);
    expect(res.returnedLines).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.text).toContain('0: [10:00:00] : Build started');
  });

  it('resolves non-numeric locators to an id via the REST API first', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 777 }), { headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(new Response(LOG, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: 'buildType:(id:X),number:42' });
    expect(fetchMock.mock.calls[0][0]).toContain('/app/rest/builds/buildType:(id:X),number:42');
    expect(fetchMock.mock.calls[1][0]).toContain('buildId=777');
    expect(res.buildId).toBe(777);
  });

  it('tail returns the last N lines with original numbering', async () => {
    vi.stubGlobal('fetch', mockLogFetch());
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: '1', tail: 2 });
    expect(res.returnedLines).toBe(2);
    expect(res.text).toBe('3: [10:00:03]E: [Step 2/2] error: tests failed\n4: [10:00:04] : [Step 2/2] exit code 1');
  });

  it('severity filter keeps matching lines only', async () => {
    vi.stubGlobal('fetch', mockLogFetch());
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: '1', severity: 'errors' });
    expect(res.returnedLines).toBe(1);
    expect(res.text).toContain('error: tests failed');
  });

  it('grep filter is case-insensitive', async () => {
    vi.stubGlobal('fetch', mockLogFetch());
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: '1', grep: 'COMPILING' });
    expect(res.returnedLines).toBe(1);
    expect(res.text).toContain('compiling');
  });

  it('startLine + lineCount pages through the log', async () => {
    vi.stubGlobal('fetch', mockLogFetch());
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: '1', startLine: 1, lineCount: 2 });
    expect(res.startLine).toBe(1);
    expect(res.returnedLines).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it('enforces maxChars with a truncation notice', async () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(100)}`).join('\n');
    vi.stubGlobal('fetch', mockLogFetch(long));
    const res = await getBuildLog(new TeamCityClient(BASE, TOKEN), { build: '1', maxChars: 1000 });
    expect(res.text.length).toBeLessThan(1200);
    expect(res.text).toContain('truncated');
    expect(res.truncated).toBe(true);
  });
});
