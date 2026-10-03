// CONTRACT section 1: every value AO writes to KV or a stream is { type, schema, id, data, meta }.
// A reader that meets a higher schema than it knows passes the value through read-only.
const registry = new Map();

export function register(type, { current, validate = () => {}, upcasters = {} }) {
  registry.set(type, { current, validate, upcasters });
}

export function encode(type, id, data, meta = {}) {
  const entry = registry.get(type);
  if (!entry) throw Object.assign(new Error(`Unregistered envelope type ${type}`), { code: 'TOPOLOGY_ENVELOPE_TYPE' });
  entry.validate(data);
  return { type, schema: entry.current, id, data, meta: { actor: null, agent: null, ts: new Date().toISOString(), src: 'ao', rev: null, reason: null, ...meta } };
}

/** { current, data, readOnly }: older schemas are upcast, newer ones come back untouched and readOnly. */
export function decode(envelope) {
  const entry = registry.get(envelope?.type);
  if (!entry) return { current: false, data: envelope?.data ?? null, readOnly: true };
  if (envelope.schema > entry.current) return { current: false, data: envelope.data, readOnly: true };
  let data = envelope.data;
  for (let from = envelope.schema; from < entry.current; from += 1) data = entry.upcasters[from] ? entry.upcasters[from](data) : data;
  return { current: envelope.schema === entry.current, data, readOnly: false };
}

register('ao/handoff', { current: 1 });
register('ao/event', { current: 1 });
