/**
 * Read-only smoke check against a live TeamCity server.
 * Usage: TEAMCITY_URL=... TEAMCITY_TOKEN=... npm run smoke
 */
import { loadConfig } from '../src/config.js';
import { TeamCityClient, paginate } from '../src/teamcity/client.js';

const config = loadConfig();
const client = new TeamCityClient(config.teamcityUrl, config.auth);

let failures = 0;
async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`OK   ${name}: ${await fn()}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

await check('server info', async () => {
  const s = (await client.get('server', { fields: 'version,buildNumber,currentTime' })) as Record<string, unknown>;
  return `version=${s.version} build=${s.buildNumber} time=${s.currentTime}`;
});

await check('current user', async () => {
  const u = (await client.get('users/current', { fields: 'id,username,name' })) as Record<string, unknown>;
  return `id=${u.id} username=${u.username} name=${u.name}`;
});

await check('projects', async () => {
  const p = await paginate(client, 'projects', { fields: 'count,project(id,name)', pageSize: 100 });
  return `${p.count} projects${p.truncated ? ' (truncated)' : ''}`;
});

await check('recent builds', async () => {
  const b = await paginate(client, 'builds', {
    fields: 'count,build(id,number,status,buildTypeId)',
    pageSize: 5,
  });
  const first = b.items[0] as Record<string, unknown> | undefined;
  return `${b.count} fetched; latest=${first ? `#${first.number} ${first.status} (${first.buildTypeId})` : 'none'}`;
});

await check('agents', async () => {
  const a = await paginate(client, 'agents', { fields: 'count,agent(id,name,connected,authorized)' });
  return `${a.count} agents`;
});

await check('queue', async () => {
  const q = await paginate(client, 'buildQueue', { fields: 'count,build(id)' });
  return `${q.count} queued`;
});

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
