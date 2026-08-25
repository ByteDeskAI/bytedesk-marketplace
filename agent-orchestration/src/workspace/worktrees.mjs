import { lstat, mkdir, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { atomicWriteJson, git, isPathWithin, newId, readJson, sha256 } from "../util.mjs";
import { invariant } from "../errors.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function orchestrationWorktreeRoot(repository) {
  const repoName = basename(repository.checkoutRoot).replace(/[^A-Za-z0-9._-]/g, "-");
  return resolve(dirname(repository.checkoutRoot), `.${repoName}-worktrees`, "agent-orchestration", repository.repositoryKey);
}

export function orchestrationWorktreePath(repository, runId, taskId = "primary") {
  invariant(SAFE_ID.test(runId), "AO_INVALID_RUN_ID", "runId contains unsafe characters.");
  invariant(SAFE_ID.test(taskId), "AO_INVALID_TASK_ID", "taskId contains unsafe characters.");
  return join(orchestrationWorktreeRoot(repository), runId, taskId);
}

export function orchestrationOwnershipPath(repository, runId, taskId = "primary") {
  return join(dirname(orchestrationWorktreePath(repository, runId, taskId)), ".broker-ownership", `${taskId}.json`);
}

function registeredWorktreePaths(porcelain) {
  return porcelain.split("\0")
    .filter((record) => record.startsWith("worktree "))
    .map((record) => record.slice("worktree ".length));
}

function assertOwnershipRecord(record, workspace, expectedPath, expectedOwnershipPath) {
  invariant(record
    && record.schemaVersion === 1
    && record.nonce === workspace.ownership.nonce
    && record.repositoryKey === workspace.repositoryKey
    && record.runId === workspace.runId
    && record.taskId === workspace.taskId
    && record.path === expectedPath
    && record.ownershipPath === expectedOwnershipPath
    && record.baseSha === workspace.baseSha
    && record.gitMarkerHash === workspace.gitMarkerHash
    && record.gitAdminDir === workspace.gitAdminDir,
  "AO_WORKSPACE_OWNERSHIP_MISMATCH", "Workspace ownership metadata does not match the broker record.");
}

export async function gitMetadataFingerprint(repository) {
  const [refs, config] = await Promise.all([
    git(repository.checkoutRoot, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
    git(repository.checkoutRoot, ["config", "--null", "--list"]),
  ]);
  return sha256(`${refs.stdout}\n${config.stdout}`);
}

export async function createOrchestrationWorktree(repository, { runId, taskId = "primary", baseSha = repository.baseSha }) {
  invariant(repository.dirty === false, "AO_CONSUMER_DIRTY", "A clean consumer repository is required before worktree creation.");
  const root = orchestrationWorktreeRoot(repository);
  const worktreePath = orchestrationWorktreePath(repository, runId, taskId);
  await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 });
  await git(repository.checkoutRoot, ["worktree", "add", "--detach", "--", worktreePath, baseSha], { timeoutMs: 120_000 });
  const actualPath = await realpath(worktreePath);
  invariant(isPathWithin(root, actualPath), "AO_WORKTREE_ESCAPE", "Git created a worktree outside the consumer-derived orchestration root.");
  const [{ stdout: head }, { stdout: commonGitDir }, { stdout: gitDir }] = await Promise.all([
    git(actualPath, ["rev-parse", "HEAD"]),
    git(actualPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(actualPath, ["rev-parse", "--path-format=absolute", "--git-dir"]),
  ]);
  invariant(head === baseSha, "AO_WORKTREE_HEAD_MISMATCH", "Created worktree does not match the requested base SHA.");
  invariant(await realpath(commonGitDir) === repository.commonGitDir, "AO_WORKTREE_REPOSITORY_MISMATCH", "Created worktree belongs to a different repository.");
  const actualGitDir = await realpath(gitDir);
  const worktreeAdminRoot = await realpath(join(repository.commonGitDir, "worktrees"));
  invariant(isPathWithin(worktreeAdminRoot, actualGitDir) && actualGitDir !== worktreeAdminRoot, "AO_WORKTREE_REPOSITORY_MISMATCH", "Created worktree lacks a dedicated Git administration entry.");
  const gitMarker = await readFile(join(actualPath, ".git"));
  const ownershipPath = orchestrationOwnershipPath(repository, runId, taskId);
  const ownershipNonce = newId("workspace");
  const workspace = {
    path: actualPath,
    root,
    baseSha,
    runId,
    taskId,
    repositoryKey: repository.repositoryKey,
    gitMarkerHash: sha256(gitMarker),
    gitMetadataFingerprint: await gitMetadataFingerprint(repository),
    gitAdminDir: actualGitDir,
    ownership: { nonce: ownershipNonce, path: ownershipPath },
  };
  try {
    await mkdir(dirname(ownershipPath), { recursive: true, mode: 0o700 });
    await atomicWriteJson(ownershipPath, {
      schemaVersion: 1,
      nonce: ownershipNonce,
      repositoryKey: repository.repositoryKey,
      runId,
      taskId,
      path: actualPath,
      ownershipPath,
      baseSha,
      gitMarkerHash: workspace.gitMarkerHash,
      gitAdminDir: actualGitDir,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    await git(repository.checkoutRoot, ["worktree", "remove", "--force", "--", actualPath], { timeoutMs: 120_000 }).catch(() => {});
    throw error;
  }
  return workspace;
}

export async function removeOrchestrationWorktree(repository, workspace) {
  const root = orchestrationWorktreeRoot(repository);
  invariant(workspace.repositoryKey === repository.repositoryKey, "AO_FOREIGN_WORKTREE", "Workspace ownership does not match the consumer repository.");
  invariant(typeof workspace.runId === "string" && SAFE_ID.test(workspace.runId), "AO_INVALID_RUN_ID", "Workspace is missing a safe broker run ID.");
  invariant(typeof workspace.taskId === "string" && SAFE_ID.test(workspace.taskId), "AO_INVALID_TASK_ID", "Workspace is missing a safe broker task ID.");
  invariant(typeof workspace.path === "string", "AO_UNSAFE_WORKTREE_REMOVAL", "Workspace is missing its broker-derived path.");
  invariant(typeof workspace.ownership?.nonce === "string" && workspace.ownership.nonce.length > 0 && typeof workspace.ownership.path === "string", "AO_WORKSPACE_OWNERSHIP_MISSING", "Workspace is missing its broker ownership record.");

  const expectedPath = orchestrationWorktreePath(repository, workspace.runId, workspace.taskId);
  const expectedOwnershipPath = orchestrationOwnershipPath(repository, workspace.runId, workspace.taskId);
  invariant(resolve(workspace.path) === expectedPath && isPathWithin(root, expectedPath) && expectedPath !== root, "AO_UNSAFE_WORKTREE_REMOVAL", "Workspace path does not match its exact consumer-derived run path.");
  invariant(resolve(workspace.ownership.path) === expectedOwnershipPath, "AO_WORKSPACE_OWNERSHIP_MISMATCH", "Workspace ownership record path does not match its exact broker-derived path.");

  const [workspaceInfo, ownershipInfo] = await Promise.all([
    lstat(expectedPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
    lstat(expectedOwnershipPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
  ]);
  if (!workspaceInfo) {
    if (ownershipInfo) {
      invariant(ownershipInfo.isFile(), "AO_WORKSPACE_OWNERSHIP_MISMATCH", "Workspace ownership metadata must be a regular file.");
      const record = await readJson(expectedOwnershipPath);
      assertOwnershipRecord(record, workspace, expectedPath, expectedOwnershipPath);
      await unlink(expectedOwnershipPath);
    }
    return { removed: false, reason: "already_removed" };
  }

  invariant(workspaceInfo.isDirectory() && !workspaceInfo.isSymbolicLink(), "AO_UNSAFE_WORKTREE_REMOVAL", "Workspace path must be the exact registered worktree directory.");
  invariant(ownershipInfo?.isFile(), "AO_WORKSPACE_OWNERSHIP_MISSING", "The broker ownership record is required before worktree removal.");
  const record = await readJson(expectedOwnershipPath);
  assertOwnershipRecord(record, workspace, expectedPath, expectedOwnershipPath);

  const actualPath = await realpath(expectedPath);
  invariant(actualPath === expectedPath, "AO_UNSAFE_WORKTREE_REMOVAL", "Workspace path resolves away from its exact broker-derived path.");
  const markerInfo = await lstat(join(actualPath, ".git"));
  invariant(markerInfo.isFile(), "AO_GIT_METADATA_CHANGED", "The worktree .git marker was replaced before cleanup.");
  invariant(sha256(await readFile(join(actualPath, ".git"))) === workspace.gitMarkerHash, "AO_GIT_METADATA_CHANGED", "The worktree .git marker changed before cleanup.");
  const [{ stdout: commonGitDir }, { stdout: head }, { stdout: gitDir }, { stdout: worktreeList }] = await Promise.all([
    git(actualPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(actualPath, ["rev-parse", "HEAD"]),
    git(actualPath, ["rev-parse", "--path-format=absolute", "--git-dir"]),
    git(repository.checkoutRoot, ["worktree", "list", "--porcelain", "-z"]),
  ]);
  invariant(await realpath(commonGitDir) === repository.commonGitDir, "AO_FOREIGN_WORKTREE", "Refusing to remove a worktree registered to another repository.");
  invariant(head === workspace.baseSha, "AO_WORKTREE_HEAD_MISMATCH", "Refusing to remove a worktree whose HEAD no longer matches its broker base SHA.");
  invariant(await realpath(gitDir) === workspace.gitAdminDir, "AO_WORKSPACE_OWNERSHIP_MISMATCH", "Refusing to remove a worktree with a different Git administration entry.");
  const registeredPaths = await Promise.all(registeredWorktreePaths(worktreeList).map((path) => realpath(path).catch(() => resolve(path))));
  invariant(registeredPaths.includes(actualPath), "AO_FOREIGN_WORKTREE", "Refusing to remove a worktree not registered at the exact broker path.");
  try {
    await git(repository.checkoutRoot, ["worktree", "remove", "--force", "--", actualPath], { timeoutMs: 120_000 });
  } catch (error) {
    const stillExists = await lstat(expectedPath).then(() => true, (failure) => failure?.code === "ENOENT" ? false : Promise.reject(failure));
    if (stillExists) throw error;
    await unlink(expectedOwnershipPath).catch((failure) => { if (failure?.code !== "ENOENT") throw failure; });
    return { removed: false, reason: "already_removed" };
  }
  await unlink(expectedOwnershipPath).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  return { removed: true };
}
