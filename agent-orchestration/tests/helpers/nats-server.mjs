// Shared isolated-test prerequisite; never starts or replaces the host broker.
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { dirname, join } from 'node:path';
const execFileAsync = promisify(execFile);
const version = 'v2.15.0';
async function matching(path) {
  try { return (await execFileAsync(path, ['--version'], { timeout: 5000 })).stdout.trim() === `nats-server: ${version}`; }
  catch { return false; }
}

export async function natsServerBin() {
  if (process.env.AO_NATS_SERVER) return process.env.AO_NATS_SERVER;
  const cacheRoot = join(os.homedir(), '.cache', 'ao-orch', 'test-brokers');
  const cached = join(cacheRoot, `nats-server-${version}`);
  if (await matching(cached)) return cached;
  await mkdir(cacheRoot, { recursive: true });
  // Private archive and same-filesystem publication prevent fresh-CI races.
  const scratch = await mkdtemp(join(cacheRoot, '.install-'));
  try {
    const candidate = join(scratch, 'nats-server');
    const legacy = join(dirname(cacheRoot), 'nats-server');
    if (await matching(legacy)) await copyFile(legacy, candidate);
    else {
      const archive = join(scratch, 'server.tar.gz');
      const response = await fetch(`https://github.com/nats-io/nats-server/releases/download/${version}/nats-server-${version}-linux-amd64.tar.gz`);
      if (!response.ok) throw new Error(`nats-server download failed: ${response.status}`);
      await pipeline(response.body, createWriteStream(archive));
      await execFileAsync('tar', ['-xzf', archive, '-C', scratch]);
      await copyFile(join(scratch, `nats-server-${version}-linux-amd64`, 'nats-server'), candidate);
    }
    await chmod(candidate, 0o755);
    if (!await matching(candidate)) throw new Error('NATS test prerequisite version does not match');
    await rename(candidate, cached);
    return cached;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
