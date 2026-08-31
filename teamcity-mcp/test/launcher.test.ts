import { chmod, cp, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createInterface } from 'node:readline';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('teamcity-mcp launcher', () => {
  it.each([
    ['full', 71],
    ['read', 37],
  ] as const)('runs the committed bundle in %s mode with %d tools', async (mode, expectedCount) => {
    const child = spawn(join(process.cwd(), 'bin', 'teamcity-mcp'), ['--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TEAMCITY_URL: 'https://teamcity.invalid',
        TEAMCITY_TOKEN: 'test-token',
        TEAMCITY_MCP_MODE: mode,
        TEAMCITY_MCP_ENV: join(tmpdir(), 'teamcity-mcp-missing-env'),
      },
    });
    const lines = createInterface({ input: child.stdout });
    const responses = new Map<number, (message: Record<string, unknown>) => void>();
    lines.on('line', (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.id === 'number') responses.get(message.id)?.(message);
    });
    const rpc = (id: number, method: string, params: unknown) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5_000);
        responses.set(id, (message) => {
          clearTimeout(timer);
          responses.delete(id);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    try {
      const initialized = await rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'launcher-test', version: '1' },
      });
      expect(initialized).not.toHaveProperty('error');
      expect(initialized).toMatchObject({ result: { serverInfo: { version: '0.2.0' } } });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
      const listed = await rpc(2, 'tools/list', {});
      const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
      expect(tools).toHaveLength(expectedCount);
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'get_project_versioned_settings',
          'list_project_features',
          'inspect_vcs_root_connection',
        ]),
      );
    } finally {
      lines.close();
      child.kill();
    }
  });

  it('runs the shipped bundle without rebuilding when source files are newer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teamcity-mcp-launcher-'));
    temporaryRoots.push(root);

    const pluginRoot = join(root, 'plugin');
    const fakeBin = join(root, 'bin');
    await Promise.all([
      mkdir(join(pluginRoot, 'bin'), { recursive: true }),
      mkdir(join(pluginRoot, 'dist'), { recursive: true }),
      mkdir(join(pluginRoot, 'src'), { recursive: true }),
      mkdir(fakeBin, { recursive: true }),
    ]);

    await cp(join(process.cwd(), 'bin', 'teamcity-mcp'), join(pluginRoot, 'bin', 'teamcity-mcp'));
    await chmod(join(pluginRoot, 'bin', 'teamcity-mcp'), 0o755);
    await writeFile(join(pluginRoot, 'dist', 'bundle.cjs'), "process.stdout.write('shipped bundle\\n');\n");
    await writeFile(join(pluginRoot, 'src', 'index.ts'), '// extracted after the bundle\n');
    await writeFile(join(fakeBin, 'npm'), '#!/bin/sh\necho runtime-npm-invoked >&2\nexit 91\n');
    await chmod(join(fakeBin, 'npm'), 0o755);

    const now = Date.now() / 1000;
    await utimes(join(pluginRoot, 'dist', 'bundle.cjs'), now - 10, now - 10);
    await utimes(join(pluginRoot, 'src', 'index.ts'), now, now);

    const result = spawnSync(join(pluginRoot, 'bin', 'teamcity-mcp'), ['--probe'], {
      encoding: 'utf8',
      env: {
        HOME: root,
        PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        TEAMCITY_MCP_ENV: join(root, 'missing-env'),
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('shipped bundle\n');
    expect(result.stderr).not.toContain('runtime-npm-invoked');
  });

  it('fails clearly when the shipped bundle is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teamcity-mcp-launcher-'));
    temporaryRoots.push(root);

    const pluginRoot = join(root, 'plugin');
    await mkdir(join(pluginRoot, 'bin'), { recursive: true });
    await cp(join(process.cwd(), 'bin', 'teamcity-mcp'), join(pluginRoot, 'bin', 'teamcity-mcp'));
    await chmod(join(pluginRoot, 'bin', 'teamcity-mcp'), 0o755);

    const result = spawnSync(join(pluginRoot, 'bin', 'teamcity-mcp'), [], {
      encoding: 'utf8',
      env: {
        HOME: root,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        TEAMCITY_MCP_ENV: join(root, 'missing-env'),
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shipped bundle is missing');
    expect(result.stderr).toContain('reinstall the plugin');
  });
});
