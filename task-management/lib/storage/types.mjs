/**
 * Core types, at their current schema. Schema 0 is the legacy markdown frontmatter shape: no
 * `kind`, optional arrays absent. Schema 1 (current) guarantees `kind`, and `labels`/`comments`
 * arrays on tasks. Add an optional field without a bump; rename/retype/remove → bump + new upcaster.
 *
 * Extension point for other plugins (no edit here): import { register } from
 * "task-management/lib/storage/registry.mjs" and register("<owner>/<name>", {...}) at load time.
 * See docs/storage.md.
 */
import { register } from "./registry.mjs";

const need = (type, data) => {
  if (typeof data.id !== "string" || !data.id) throw new Error(`${type}: id is required`);
};

const entity = (type, kind, extra = () => ({})) =>
  register(type, {
    current: 1,
    validate: (d) => need(type, d),
    upcasters: { 0: (d) => ({ ...extra(d), ...d, kind: d.kind || kind }) },
  });

entity("tm/task", "task", () => ({ labels: [], comments: [] }));
entity("tm/epic", "epic");
entity("tm/adr", "adr");
entity("tm/sprint", "sprint");
entity("tm/capability", "capability");
// Plans and evidence manifests are opaque to the store: {id, ...} plus whatever the writer adds.
for (const t of ["tm/plan", "tm/evidence"]) {
  register(t, { current: 1, validate: (d) => need(t, d), upcasters: { 0: (d) => ({ ...d }) } });
}

/** Entity kind (KINDS in paths.mjs) ↔ registered type. */
export const typeOfKind = (kind) => `tm/${kind}`;
export const kindOfType = (type) => type.replace(/^tm\//, "");

/** The five kinds that are one-file-per-entity on the markdown store (plans/evidence are handled separately). */
export const ENTITY_TYPES = ["tm/epic", "tm/task", "tm/adr", "tm/sprint", "tm/capability"];
