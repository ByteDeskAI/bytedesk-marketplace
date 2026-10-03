// TM-310 round 6: the committed bundles are what the services path (agent-orchestration -> dist/cli.cjs) actually runs. A
// stale one carries its own old nats-local and rewrites state.json in the password format beside the topology code.
// AO_DIST_DIR points the check elsewhere, to show the failure on a stale bundle.
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dist = process.env.AO_DIST_DIR || join(root, 'dist');
const MARKERS = ['adminPub', 'STATE_SCHEMA', 'credential-holder.cjs', 'holderIdentity'];

for (const name of ['cli.cjs', 'mcp.cjs']) {
  test(`dist/${name} carries the TM-310 credential code (run \`npm run build\` after changing topology/lib)`, async () => {
    const text = await readFile(join(dist, name), 'utf8');
    const missing = MARKERS.filter((marker) => !text.includes(marker));
    assert.deepEqual(missing, [], `${join(dist, name)} is stale: missing ${missing.join(', ')}. Run \`npm run build\` in agent-orchestration and commit dist/.`);
  });
}

test('dist/credential-holder.cjs exists: a bundle must not be spawned as its own holder', async () => {
  await access(join(dist, 'credential-holder.cjs')).catch(() => assert.fail(`${join(dist, 'credential-holder.cjs')} is missing. Run \`npm run build\`.`));
});
