import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { sandboxArguments, startAcpProxy } from "../../src/provider-sandbox.mjs";
import { AUTH_BOOTSTRAP_PROMPT } from "../../src/runtime/bootstrap.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("write provider sandboxes make only the worktree writable and remount Git metadata read-only", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-sandbox-test-"));
  const workspace = join(root, "workspace");
  const commonGitDir = join(root, "consumer.git");
  const sandboxTempDir = join(root, "temp");
  const brokerControlDir = join(root, "broker-control");
  try {
    await Promise.all([mkdir(workspace), mkdir(commonGitDir), mkdir(sandboxTempDir), mkdir(brokerControlDir)]);
    await writeFile(join(workspace, ".git"), `gitdir: ${join(commonGitDir, "worktrees", "fixture")}\n`);
    const args = await sandboxArguments({ providerId: "codex", pluginRoot: "/plugin", workspacePath: workspace, commonGitDir, sandboxTempDir, brokerControlDir, providerExecutable: "/usr/bin/true", permissionProfile: "write" });
    assert.deepEqual(args.slice(0, 6), ["--unshare-all", "--die-with-parent", "--new-session", "--tmpfs", "/", "--proc"]);
    assert.equal(args.includes("--share-net"), false, "the provider must not share the host network namespace");
    assert.equal(args.some((value, index) => value === "--ro-bind" && args[index + 1] === "/"), false, "host root must never be mounted");
    assert.equal(args.includes("--dev-bind"), false, "host devices must never be inherited");
    assert.ok(args.includes("--dev"), "sandbox receives a fresh minimal /dev");
    assert.ok(args.includes("--clearenv"), "ambient environment must be cleared");
    assert.equal(args.includes("AO_FAKE_FORBIDDEN_PATH"), false, "untrusted ambient variables must not cross the boundary");
    assert.equal(args.includes(join(os.homedir(), ".codex", "auth.json")), false, "host credential files must never be mounted into the provider namespace");
    const sandboxEnvKeys = args.flatMap((value, index) => value === "--setenv" ? [args[index + 1]] : []);
    for (const proxyKey of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) {
      assert.equal(sandboxEnvKeys.includes(proxyKey), false, `${proxyKey} must not expose credential-bearing proxy URLs through process argv`);
    }
    assert.ok(args.includes(join(brokerControlDir, "resolv.conf")), "DNS control file comes from the broker-only directory");
    assert.equal(args.includes(join(sandboxTempDir, "network", "resolv.conf")), false, "provider scratch is never reused for broker control files");
    const workspaceBind = args.findIndex((value, index) => value === "--bind" && args[index + 1] === workspace);
    const sandboxRuntimeRoot = "/agent-orchestration-runtime";
    const scratchBind = args.findIndex((value, index) => value === "--bind" && args[index + 1] === sandboxTempDir && args[index + 2] === sandboxRuntimeRoot);
    const providerHomeRoot = join(sandboxRuntimeRoot, "provider-home");
    const providerHome = join(providerHomeRoot, "codex");
    const providerHomeRootMount = args.findIndex((value, index) => value === "--bind" && args[index + 2] === providerHomeRoot);
    const providerHomeMount = args.findIndex((value, index) => value === "--bind" && args[index + 2] === providerHome);
    const providerAuth = join(providerHome, "auth.json");
    const providerAuthReadOnly = args.findIndex((value, index) => value === "--ro-bind" && args[index + 2] === providerAuth);
    const markerReadOnly = args.findIndex((value, index) => value === "--ro-bind" && args[index + 1] === join(workspace, ".git"));
    const commonReadOnly = args.findIndex((value, index) => value === "--ro-bind" && args[index + 1] === commonGitDir);
    assert.ok(workspaceBind > 0 && scratchBind > workspaceBind && providerHomeRootMount > scratchBind && providerHomeMount > providerHomeRootMount && providerAuthReadOnly > providerHomeMount, "every writable auth ancestor must be an unrenameable mountpoint before the exact read-only auth mount");
    assert.equal(args.includes(sandboxTempDir), true);
    assert.equal(args.some((value) => value.startsWith("/dev/shm/agent-orchestration-") && value !== sandboxTempDir), false, "sandbox destinations must not expose broker tmpfs ancestry");
    assert.match(args[providerAuthReadOnly + 1], new RegExp(`^${brokerControlDir}/provider-home/`));
    assert.ok(markerReadOnly > providerAuthReadOnly && commonReadOnly > markerReadOnly);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sandbox execution revalidates provider-specific executable authority", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-sandbox-authority-test-"));
  const workspace = join(root, "workspace");
  const commonGitDir = join(root, "consumer.git");
  const sandboxTempDir = join(root, "temp");
  const brokerControlDir = join(root, "broker-control");
  const untrustedExecutable = join(root, "grok");
  try {
    await Promise.all([mkdir(workspace), mkdir(commonGitDir), mkdir(sandboxTempDir), mkdir(brokerControlDir)]);
    await Promise.all([
      writeFile(join(workspace, ".git"), `gitdir: ${join(commonGitDir, "worktrees", "fixture")}\n`),
      writeFile(untrustedExecutable, "#!/bin/sh\nexit 0\n"),
    ]);
    await chmod(untrustedExecutable, 0o755);
    await assert.rejects(
      () => sandboxArguments({ providerId: "grok-build", pluginRoot: "/plugin", workspacePath: workspace, commonGitDir, sandboxTempDir, brokerControlDir, providerExecutable: untrustedExecutable, permissionProfile: "write" }),
      { code: "AO_PROVIDER_EXECUTABLE_UNTRUSTED" },
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ACP proxy revokes bootstrap before releasing pipelined prompts and disambiguates colliding IDs", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const child = { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} };
  const childMessages = [];
  const outputMessages = [];
  const order = [];
  child.stdin.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n").filter(Boolean)) {
      const message = JSON.parse(line);
      childMessages.push(message);
      order.push(`child:${message.method ?? ("result" in message ? "result" : "error")}:${message.id}`);
    }
  });
  output.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n").filter(Boolean)) {
      const message = JSON.parse(line);
      outputMessages.push(message);
      order.push(`output:${message.method ?? ("result" in message ? "result" : "error")}:${message.id}`);
    }
  });
  let releaseRevocation;
  const proxyDone = startAcpProxy(child, async () => {
    order.push("revoke:start");
    await new Promise((resolve) => { releaseRevocation = resolve; });
    order.push("revoke:end");
  }, { inputStream: input, outputStream: output });

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { prompt: [{ type: "text", text: AUTH_BOOTSTRAP_PROMPT }] } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: "task input" }] } })}\n`);
  await settle();
  assert.deepEqual(childMessages.map((message) => message.method), ["session/new"]);

  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "fs/read_text_file", params: {} })}\n`);
  await settle();
  assert.equal(outputMessages.at(-1).method, "fs/read_text_file");
  assert.equal(releaseRevocation, undefined, "a provider request with a colliding ID is not the session response");

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: "denied" } })}\n`);
  await settle();
  assert.equal(childMessages.at(-1).result.content, "denied");

  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sessionId: "session-1" } })}\n`);
  await settle();
  assert.equal(releaseRevocation, undefined);
  assert.equal(outputMessages.some((message) => message.result?.sessionId === "session-1"), true);
  assert.deepEqual(childMessages.filter((message) => message.method === "session/prompt").map((message) => message.id), [2]);

  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "fs/read_text_file", params: {} })}\n`);
  await settle();
  assert.equal(outputMessages.at(-1).method, "fs/read_text_file");
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: "denied" } })}\n`);
  await settle();
  assert.equal(childMessages.at(-1).result.content, "denied");

  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } })}\n`);
  await settle();
  assert.equal(typeof releaseRevocation, "function");
  assert.equal(childMessages.some((message) => message.id === 3), false);
  assert.equal(outputMessages.some((message) => message.result?.stopReason === "end_turn"), false);

  releaseRevocation();
  await settle();
  await settle();
  const revokeEnd = order.indexOf("revoke:end");
  const bootstrapResponse = order.indexOf("output:result:2");
  const releasedPrompt = order.indexOf("child:session/prompt:3");
  assert.ok(revokeEnd >= 0 && bootstrapResponse > revokeEnd && releasedPrompt > bootstrapResponse, order.join(" -> "));

  child.stdout.end();
  input.end();
  await proxyDone;
});

test("ACP proxy rejects prompts before any session establishment", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let killed = false;
  const child = { stdin: new PassThrough(), stdout: new PassThrough(), kill() { killed = true; } };
  const proxyDone = startAcpProxy(child, async () => {}, { inputStream: input, outputStream: output });
  input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: {} })}\n`);
  await settle();
  child.stdout.end();
  await assert.rejects(proxyDone, (error) => error?.code === "AO_SESSION_NOT_ESTABLISHED");
  assert.equal(killed, true);
});
