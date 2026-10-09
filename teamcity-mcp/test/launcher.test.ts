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
    ['lead', 38],
  ] as const)('runs the committed bundle in %s mode with %d tools', async (mode, expectedCount) => {
    const child = spawn(join(process.cwd(), 'bin', 'teamcity-mcp'), ['--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TEAMCITY_URL: 'https://teamcity.invalid',
        TEAMCITY_TOKEN: 'test-token',
        TEAMCITY_MCP_MODE: mode,
        TEAMCITY_MCP_PROJECT: 'ByteDesk_Test',
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
      expect(initialized).toMatchObject({ result: { serverInfo: { version: '0.3.0' } } });
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

  it('loads a per-repository profile instead of the user env, from the main checkout or a worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teamcity-mcp-launcher-'));
    temporaryRoots.push(root);

    const pluginRoot = join(root, 'plugin');
    const config = join(root, '.config', 'teamcity-mcp');
    const repo = join(root, 'design-system');
    const elsewhere = join(root, 'other-repo');
    await Promise.all([
      mkdir(join(pluginRoot, 'bin'), { recursive: true }),
      mkdir(join(pluginRoot, 'dist'), { recursive: true }),
      mkdir(join(config, 'repos'), { recursive: true }),
      mkdir(repo, { recursive: true }),
      mkdir(elsewhere, { recursive: true }),
    ]);
    await cp(join(process.cwd(), 'bin', 'teamcity-mcp'), join(pluginRoot, 'bin', 'teamcity-mcp'));
    await chmod(join(pluginRoot, 'bin', 'teamcity-mcp'), 0o755);
    await writeFile(
      join(pluginRoot, 'dist', 'bundle.cjs'),
      "process.stdout.write([process.env.TEAMCITY_TOKEN, process.env.TEAMCITY_MCP_MODE, process.env.TEAMCITY_MCP_PROJECT].join(' '));\n",
    );
    await writeFile(join(config, 'env'), 'TEAMCITY_TOKEN=operator-full\n');
    await writeFile(
      join(config, 'repos', 'design-system.env'),
      'TEAMCITY_TOKEN=lead-scoped\nTEAMCITY_MCP_MODE=lead\nTEAMCITY_MCP_PROJECT=ByteDesk_DesignSystem\n',
    );
    const git = (cwd: string, ...args: string[]) =>
      expect(spawnSync('git', args, { cwd, encoding: 'utf8' }).status).toBe(0);
    git(repo, 'init', '-q');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
    git(repo, 'worktree', 'add', '-q', join(root, 'wt'));
    git(elsewhere, 'init', '-q');

    const run = (cwd: string) =>
      spawnSync(join(pluginRoot, 'bin', 'teamcity-mcp'), ['--probe'], {
        cwd,
        encoding: 'utf8',
        env: { HOME: root, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
      }).stdout;

    expect(run(repo)).toBe('lead-scoped lead ByteDesk_DesignSystem');
    expect(run(join(root, 'wt'))).toBe('lead-scoped lead ByteDesk_DesignSystem');
    expect(run(elsewhere)).toBe('operator-full  ');
    expect(run(root)).toBe('operator-full  ');
  });
});
