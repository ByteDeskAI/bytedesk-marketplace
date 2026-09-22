import { spawn as spawnProcess } from 'node:child_process';
import { readFile as read } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This checks the producer's namespace/network handshake without loading a
// provider or changing host policy. Dependencies are injectable for safe tests.
export async function sandboxNetworkSmoke({ spawn = spawnProcess, readFile = read, timeoutMs = 10_000 } = {}) {
  const owned = [];
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Sandbox network smoke timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  const launch = (command, args, stdio) => {
    const child = spawn(command, args, { stdio, shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    const record = { child, command, stderr: '', stdout: '' };
    record.closed = new Promise(resolveClose => {
      child.once('error', error => resolveClose({ error: error.message }));
      child.once('close', (code, signal) => resolveClose({ code, signal }));
    });
    child.stderr.on('data', chunk => { record.stderr = (record.stderr + chunk).slice(-8192); });
    child.stdout?.on('data', chunk => { record.stdout = (record.stdout + chunk).slice(-8192); });
    owned.push(record);
    return record;
  };
  const failure = record => record.closed.then(outcome => {
    throw new Error(`${record.command} closed before readiness: ${JSON.stringify(outcome)}; ${record.stderr.trim()}`);
  });
  const waitFor = (promise, record) => Promise.race([promise, failure(record), deadline]);
  const readProfile = async pid => (await readFile(`/proc/${pid}/attr/current`, 'utf8')).trim();
  const observe = async promise => {
    let timer;
    try {
      return await Promise.race([promise.catch(() => 'unavailable'), new Promise(resolveObservation => {
        timer = setTimeout(() => resolveObservation('observation timed out'), 250);
      })]);
    } finally { clearTimeout(timer); }
  };
  let result;
  let failureMessage;
  try {
    const sandbox = launch('/usr/bin/bwrap', [
      '--info-fd', '3', '--block-fd', '4', '--unshare-all', '--die-with-parent', '--new-session',
      '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--clearenv',
      '--setenv', 'PATH', '/usr/bin:/bin', '--chdir', '/', '--', '/bin/sh', '-eu', '-c',
      'printf "child_profile="; cat /proc/self/attr/current; sed -n "s/^CapEff:[[:space:]]*/CapEff=/p" /proc/self/status',
    ], ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']);
    const info = await waitFor(new Promise((resolveInfo, rejectInfo) => {
      let body = '';
      sandbox.child.stdio[3].on('data', chunk => {
        body += chunk;
        if (body.length > 4096) return rejectInfo(new Error('Bubblewrap namespace record exceeded 4096 bytes.'));
        try {
          const parsed = JSON.parse(body);
          if (Number.isSafeInteger(parsed['child-pid']) && parsed['child-pid'] > 0) resolveInfo(parsed);
        } catch { /* The JSON record may arrive in multiple chunks. */ }
      });
      sandbox.child.stdio[3].once('end', () => rejectInfo(new Error('Bubblewrap ended its namespace stream without a child PID.')));
      sandbox.child.stdio[3].once('error', rejectInfo);
    }), sandbox);
    const network = launch('/usr/bin/slirp4netns', [
      '--configure', '--mtu=65520', '--disable-host-loopback', '--enable-sandbox',
      '--ready-fd=3', '--exit-fd=4', String(info['child-pid']), 'tap0',
    ], ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']);
    await waitFor(new Promise((resolveReady, rejectReady) => {
      network.child.stdio[3].once('data', resolveReady);
      network.child.stdio[3].once('end', () => rejectReady(new Error('slirp4netns ended its readiness stream without acknowledgement.')));
      network.child.stdio[3].once('error', rejectReady);
    }), network);
    const networkProfile = await Promise.race([readProfile(network.child.pid), deadline]);
    if (networkProfile !== 'slirp4netns (unconfined)') throw new Error(`slirp4netns did not enter its official executable profile: ${networkProfile}`);
    sandbox.child.stdio[4].end('1');
    const outcome = await Promise.race([sandbox.closed, failure(network), deadline]);
    if (outcome.code !== 0) throw new Error(`Bubblewrap smoke failed: ${JSON.stringify(outcome)}; ${sandbox.stderr.trim()}`);
    const expected = 'child_profile=bwrap//&unpriv_bwrap (enforce)\nCapEff=0000000000000000';
    if (sandbox.stdout.trim() !== expected) throw new Error(`Sandbox child did not prove its enforced profile and zero effective capabilities: ${sandbox.stdout.trim()}`);
    result = { output: expected, networkProfile };
  } catch (error) {
    const observations = await Promise.all(owned.map(async record => {
      const [profile, waitChannel] = await Promise.all([
        observe(readProfile(record.child.pid)),
        observe(readFile(`/proc/${record.child.pid}/wchan`, 'utf8').then(value => value.trim())),
      ]);
      return { command: record.command, pid: record.child.pid, stderr: record.stderr.trim(), profile, waitChannel };
    }));
    failureMessage = `${error.message}\nOwned smoke processes: ${JSON.stringify(observations)}`;
  } finally {
    clearTimeout(timeout);
    for (const record of owned) record.child.stdio[4]?.end();
    const cleanup = await Promise.all(owned.map(async record => {
      const wait = async milliseconds => {
        let timer;
        try { return await Promise.race([record.closed.then(() => true), new Promise(resolveWait => { timer = setTimeout(() => resolveWait(false), milliseconds); })]); }
        finally { clearTimeout(timer); }
      };
      if (record.child.exitCode !== null || record.child.signalCode !== null) return wait(1000);
      record.child.kill('SIGTERM');
      if (await wait(1000)) return true;
      record.child.kill('SIGKILL');
      return wait(1000);
    }));
    if (cleanup.some(closed => !closed)) failureMessage = `${failureMessage || ''}\nOwned sandbox smoke process failed to close after SIGKILL.`;
  }
  if (failureMessage) throw new Error(failureMessage);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.ImageOS !== 'ubuntu24') {
    console.error('Network prerequisite smoke is restricted to GitHub-hosted Ubuntu 24.04 jobs.');
    process.exitCode = 1;
  } else {
    sandboxNetworkSmoke().then(result => {
      process.stderr.write(`network_profile=${result.networkProfile}\n`);
      process.stdout.write(`${result.output}\n`);
    }, error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
