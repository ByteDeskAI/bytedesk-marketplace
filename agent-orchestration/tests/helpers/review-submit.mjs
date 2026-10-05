// TM-365: tests submit a verdict the way the reviewer does, through submitReviewVerdict, instead of
// faking a pane capture. `alive` is stubbed because test reviewer bindings name no real tmux pane.
import { readReviewerRecord, submitReviewVerdict } from '../../topology/lib/reviewer.mjs';

export async function submitVerdict(f, request, verdict = 'approve', findings = [], extra = {}) {
  const record = await readReviewerRecord(f.consumer, f.env, f.home);
  return submitReviewVerdict({ consumer: f.consumer, home: f.home, env: { ...f.env, AO_AGENT_ID: record?.agent_id }, request: request.nonce, verdict, findings, alive: async () => true, ...extra });
}
