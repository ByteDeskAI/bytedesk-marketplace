/**
 * The versioned envelope every stored value travels in (CONTRACT §1).
 *
 *   { type: "tm/task", schema: 3, id, data: {...}, meta: { actor, agent, ts, src, rev, reason, git } }
 *
 * This file only knows the shape. Which schema a type is at, and how to lift an old one, lives in
 * registry.mjs.
 */
export const ENVELOPE_KEYS = ["type", "schema", "id", "data", "meta"];

/** A value is an envelope when it names its type and carries an integer schema and an object of data. */
export function isEnvelope(v) {
  return Boolean(v) && typeof v === "object" && typeof v.type === "string" && Number.isInteger(v.schema) && v.data && typeof v.data === "object";
}

export function makeEnvelope(type, schema, id, data, meta = {}) {
  return { type, schema, id, data, meta };
}
