// TM-368: read TeamCity build status through its REST API (the endpoints teamcity-mcp uses).
// URL and token come from the environment (TEAMCITY_URL, TEAMCITY_TOKEN) or, for the URL only, from
// config; nothing is hardcoded and the token is sent only as a header, never logged or returned.
import { fail } from './util.mjs';

/** { url, token } or a named reason. The token is read from the environment only. */
export function teamcityTarget({ config = {}, env = process.env } = {}) {
  const url = env.TEAMCITY_URL || config.url || null;
  const token = env.TEAMCITY_TOKEN || null;
  if (!url) return { reason: 'no TeamCity URL: set TEAMCITY_URL or management.release.teamcity.url' };
  if (!token) return { reason: 'TEAMCITY_TOKEN is not set in this environment' };
  return { url: url.replace(/\/+$/, ''), token };
}

const sleep = ms => new Promise(done => setTimeout(done, ms));
const FIELDS = 'build(id,number,state,status,statusText,branchName,webUrl)';

export function teamcityClient({ url, token, fetchImpl = fetch }) {
  async function builds(buildType, count) {
    const target = new URL(`${url}/app/rest/builds`);
    target.searchParams.set('locator', `buildType:(id:${buildType}),branch:default:any,state:any,count:${count}`);
    target.searchParams.set('fields', FIELDS);
    const res = await fetchImpl(target, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) fail('TOPOLOGY_TEAMCITY', `TeamCity GET builds for ${buildType} answered ${res.status}.`);
    return ((await res.json())?.build || []).map(b => ({ ...b, id: Number(b.id) }));
  }
  return {
    /** The newest build id of this configuration before a release starts, or null. */
    async latestBuildId(buildType) { return (await builds(buildType, 1))[0]?.id ?? null; },
    /** The first build newer than `after`, once it has finished; { timeout: true } past the deadline. */
    async waitForBuild({ buildType, after = null, timeoutMs = 3_600_000, pollMs = 15_000, now = Date.now }) {
      const deadline = now() + timeoutMs;
      for (;;) {
        const fresh = (await builds(buildType, 20)).filter(b => after == null || b.id > after).sort((a, b) => a.id - b.id)[0] || null;
        if (fresh?.state === 'finished') return fresh;
        if (now() >= deadline) return { timeout: true, build: fresh };
        // ponytail: fixed interval; TeamCity has no build-finished push we can wait on without a webhook.
        await sleep(pollMs);
      }
    },
  };
}
