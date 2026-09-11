// Repository enrollment: the one provider-neutral answer to "is agent orchestration switched on for
// this repository?" (TM-167). It is keyed on the canonical repository (the common Git directory),
// so every linked worktree of one repository gets the same answer.
//
// SEAM: committed before the TM-167 workers start, so lead recovery can build against this contract
// while the resolver itself is implemented. The exported names, parameters and return shapes are
// the contract; the body of resolveEnrollment is expected to be replaced. Nothing calls this yet.
import { homedir } from "node:os";
import { readLeadRegistration } from "./lead.mjs";
import { canonicalRepoId, repositoryConsumer } from "./repoid.mjs";

/**
 * @returns {Promise<{ enrolled: boolean,
 *   source: "repo-config" | "project-plugin" | "lead-registration" | "disabled" | "none",
 *   repo_id: string, root: string, reason?: string }>}
 */
export async function resolveEnrollment({ consumer, env = process.env, home = homedir() }) {
  const root = await repositoryConsumer(consumer);
  const identity = await canonicalRepoId(root);
  const lead = await readLeadRegistration({ consumer: root, env, home });
  return lead
    ? { enrolled: true, source: "lead-registration", repo_id: identity.id, root }
    : { enrolled: false, source: "none", repo_id: identity.id, root };
}

/**
 * Start the canonical per-repository supervisor if, and only if, the repository is enrolled.
 * Never fatal, never launches an agent, and lists no tmux server itself.
 * @returns {Promise<{ enrollment: object, supervision: object }>}
 */
export async function activateRepository({ consumer, env = process.env, home = homedir(), reason = "unspecified", ...options }) {
  const enrollment = await resolveEnrollment({ consumer, env, home });
  if (!enrollment.enrolled) return { enrollment, reason, supervision: { started: false, reason: "not-enrolled" } };
  try {
    const { startRepositorySupervision } = await import("./supervision.mjs");
    return { enrollment, reason, supervision: await startRepositorySupervision({ ...options, consumer: enrollment.root, env, home }) };
  } catch (error) {
    return { enrollment, reason, supervision: { started: false, error: error.message } };
  }
}
