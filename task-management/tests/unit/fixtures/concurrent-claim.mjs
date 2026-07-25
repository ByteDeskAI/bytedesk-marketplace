/**
 * One process claiming one task, used by lock.test.mjs to produce a real
 * cross-process race. Adds a claim via read-modify-write inside withLock; without
 * the lock, simultaneous runs clobber each other and claims go missing.
 */
import { paths } from "../../../lib/paths.mjs";
import { state, withLock, writeState } from "../../../lib/store.mjs";

const [root, name] = process.argv.slice(2);
const p = paths(root);

withLock(p, () => {
  const claims = { ...state(p).claims };
  // Widen the window the race lives in, so an unlocked implementation reliably fails.
  const until = Date.now() + 30;
  while (Date.now() < until) {
    /* spin */
  }
  claims[name] = { session: name, ts: new Date().toISOString() };
  writeState({ claims }, p);
});

process.stdout.write(`${name}\n`);
