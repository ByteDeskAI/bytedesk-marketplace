// TM-316: tamper detection for the local NATS server config. A same-uid process cannot be stopped from editing
// nats-server.conf or signalling the server; it can be NOTICED and undone. The admin holder keeps the expected config
// text in memory (never on disk), re-reads the file every AO_TAMPER_INTERVAL_MS, and on a mismatch rewrites it, reloads
// the server and appends a `nats.tamper` event to <home>/tamper.jsonl. Events carry digests and public keys only.
// Residual (docs/adr/0003): the watcher is itself a same-uid process; killing it disarms detection until the next ensure.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TAMPER_INTERVAL_MS = 5000;
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const NKEY = /nkey:\s*([A-Z0-9]{56})/g;
const keysOf = (text) => new Set([...String(text).matchAll(NKEY)].map((m) => m[1]));
// A legacy password line must never reach the journal.
const redact = (line) => (/pass(word)?\s*[:=]/i.test(line) ? '<redacted>' : line.trim());

/** What changed between the expected text and what is on disk: digests, users by public key, changed lines (secrets redacted). */
export function summarizeChange(expected, actual) {
  const before = new Set(String(expected).split('\n'));
  const after = new Set(String(actual ?? '').split('\n'));
  const was = keysOf(expected); const now = keysOf(actual ?? '');
  return {
    before: { sha256: sha256(expected), bytes: Buffer.byteLength(expected) },
    after: actual == null ? null : { sha256: sha256(actual), bytes: Buffer.byteLength(actual) },
    usersAdded: [...now].filter((k) => !was.has(k)),
    usersRemoved: [...was].filter((k) => !now.has(k)),
    linesAdded: [...after].filter((l) => !before.has(l)).slice(0, 8).map(redact),
    linesRemoved: [...before].filter((l) => !after.has(l)).slice(0, 8).map(redact),
  };
}

/** Append one event. The journal is 0600, append-only by this code; a same-uid process can still edit it (see the ADR). */
export function journalTamper(home, event) {
  const line = JSON.stringify({ type: 'nats.tamper', ts: new Date().toISOString(), ...event });
  try { appendFileSync(join(home, 'tamper.jsonl'), `${line}\n`, { mode: 0o600 }); } catch { /* the repair matters more than the log */ }
  return line;
}

/** Events newer than `sinceMs` ago, newest last. */
export function readTamperEvents(home, { sinceMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  let text = '';
  try { text = readFileSync(join(home, 'tamper.jsonl'), 'utf8'); } catch { return []; }
  const events = [];
  for (const line of text.split('\n')) {
    try { const event = JSON.parse(line); if (event.type === 'nats.tamper' && now - Date.parse(event.ts) <= sinceMs) events.push(event); } catch { /* skip */ }
  }
  return events;
}
