/**
 * `tm cutover` — switch a board from the markdown store to NATS, only if the copy proves equal.
 *
 *   snapshot (inside migrate) → migrate → both-sides count/content check → set storage.backend=nats
 *
 * It refuses, and leaves config.json untouched, unless every type, the evidence blobs and the event
 * history compare equal. --dry-run runs the planning half and changes nothing.
 */
import { migrate } from "./migrate.mjs";
import { writeConfig } from "../store.mjs";

export async function cutover({ backend, p, dryRun = false, snapshotPath, log = () => {} }) {
  const report = await migrate({ backend, p, dryRun, snapshotPath, log });
  const planned = Object.values(report.types).every((t) => t.source === t.planned);
  const verdict = { ...report, switched: false, refused: null };
  if (dryRun) {
    verdict.refused = planned ? null : "dry run: some documents did not plan cleanly";
    verdict.wouldSwitch = planned;
    return verdict;
  }
  if (!report.ok) {
    verdict.refused = "count check failed — the destination does not equal the source; storage.backend not changed";
    return verdict;
  }
  writeConfig({ storage: { backend: "nats" } }, p);
  verdict.switched = true;
  return verdict;
}
