import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { TextArea, TextField } from "./Field";

/**
 * Text that becomes a field on click and goes back on Enter/blur; Escape cancels.
 *
 * Escape is captured on the document, not the field: an inspector or dialog above listens for
 * Escape too, and by the time a bubbling handler ran the drawer was already gone. Capture runs
 * first, stops propagation, and the field alone closes (TaskDrawer.tsx:204-265, kept).
 */
export function InlineEdit({ value, onSave, multiline, placeholder = "empty — click to write", mono, label, className }: { value: string; onSave: (v: string) => void | Promise<unknown>; multiline?: boolean; placeholder?: string; mono?: boolean; label: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setDraft(value);
      setEditing(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editing, value]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) void onSave(draft.trim());
  };
  if (!editing)
    return (
      <button type="button" className={["tm-inline", className].filter(Boolean).join(" ")} data-empty={!value || undefined} aria-label={`edit ${label}`} onClick={() => setEditing(true)} style={mono ? { fontFamily: "var(--tm-mono)", fontSize: "var(--tm-text-mono)" } : undefined}>
        {value || placeholder}
      </button>
    );
  return (
    <div className="tm-stack" style={{ gap: "var(--tm-s2)" }}>
      {multiline ? (
        <TextArea ref={ref} value={draft} mono={mono} rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))} aria-label={label} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); }} />
      ) : (
        <TextField ref={ref} value={draft} mono={mono} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      )}
      {multiline && (
        <div className="tm-inline__actions">
          <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={commit}>Save</Button>
        </div>
      )}
    </div>
  );
}
