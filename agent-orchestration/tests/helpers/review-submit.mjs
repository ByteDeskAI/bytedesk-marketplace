// TM-365: tests submit a verdict the way the reviewer does, through submitReviewVerdict, instead of
// faking a pane capture. `alive` is stubbed because test reviewer bindings name no real tmux pane.
// TM-427: the helper neither sets AO_AGENT_ID nor bypasses identity. Fixture bindings record
// panePid: process.pid, so the real pane-ancestry proof (requireReviewerCaller) passes; a test that
// simulates a forged caller passes `callerProc` (e.g. { pid: process.ppid }) in `extra`.
import { submitReviewVerdict } from '../../topology/lib/reviewer.mjs';

export async function submitVerdict(f, request, verdict = 'approve', findings = [], extra = {}) {
  return submitReviewVerdict({ consumer: f.consumer, home: f.home, env: f.env, request: request.nonce, verdict, findings, alive: async () => true, ...extra });
}
