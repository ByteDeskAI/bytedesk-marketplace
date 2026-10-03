/**
 * Schema registry (CONTRACT §1). Pluggable on purpose: core registers tm/* below, and any other
 * plugin calls `register("<owner>/<name>", …)` for its own types without editing this package.
 *
 *   register(type, { current, validate(data), upcasters: { [fromSchema]: (data) => data } })
 *   decode(envelope) -> { current:boolean, data, readOnly:boolean }
 *   encode(type, data, meta) -> envelope
 *
 * Rules enforced here:
 *   - an older schema is lifted one step at a time through `upcasters[from]` (→ from+1);
 *   - a HIGHER schema than this code knows, or a type nobody registered, is read-only passthrough:
 *     `readOnly: true`, `data` returned untouched, and `assertWritable` refuses a write over it —
 *     rewriting it would drop fields this version has never heard of;
 *   - encode always writes `current` and keeps every field in `data` (unknown ones included).
 *     Upcasters must return `{ ...data, … }` for the same reason.
 */
import { makeEnvelope } from "./envelope.mjs";

const types = new Map();

export class ReadOnlySchemaError extends Error {
  constructor(type, id, schema, current) {
    super(
      current === undefined
        ? `${type} ${id}: type is not registered here — refusing to write; it is read-only until a plugin registers it.`
        : `${type} ${id}: stored at schema ${schema}, this version writes ${current} — refusing to write (a downgrade would destroy fields). Update task-management, then retry.`,
    );
    this.name = "ReadOnlySchemaError";
    this.code = "READ_ONLY_SCHEMA";
  }
}

export function register(type, spec) {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(type)) throw new Error(`type must be "<owner>/<name>", got "${type}"`);
  const { current, validate = () => {}, upcasters = {} } = spec || {};
  if (!Number.isInteger(current) || current < 0) throw new Error(`${type}: current must be a non-negative integer`);
  for (let from = 0; from < current; from += 1) {
    if (typeof upcasters[from] !== "function") throw new Error(`${type}: no upcaster from schema ${from} (current is ${current})`);
  }
  const prior = types.get(type);
  // Never edit an old upcaster: re-registering is allowed only if it can only add (a higher current).
  if (prior && current < prior.current) throw new Error(`${type}: cannot lower current schema ${prior.current} → ${current}`);
  types.set(type, { current, validate, upcasters });
  return type;
}

export const registered = (type) => types.get(type);
export const registeredTypes = () => [...types.keys()];

export function decode(envelope) {
  const t = types.get(envelope.type);
  if (!t) return { current: false, data: envelope.data, readOnly: true };
  if (envelope.schema > t.current) return { current: false, data: envelope.data, readOnly: true };
  let data = envelope.data;
  for (let s = envelope.schema; s < t.current; s += 1) data = t.upcasters[s](data);
  return { current: envelope.schema === t.current, data, readOnly: false };
}

export function encode(type, data, meta = {}) {
  const t = types.get(type);
  if (!t) throw new Error(`unregistered type ${type} — register() it first`);
  t.validate(data);
  return makeEnvelope(type, t.current, data.id, data, meta);
}

/** Throws ReadOnlySchemaError when `stored` (an envelope or null) must not be overwritten. */
export function assertWritable(stored) {
  if (!stored) return;
  const t = types.get(stored.type);
  if (!t) throw new ReadOnlySchemaError(stored.type, stored.id);
  if (stored.schema > t.current) throw new ReadOnlySchemaError(stored.type, stored.id, stored.schema, t.current);
}
