import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/Field";
import { Markdown } from "../../../components/ui/Markdown";

/**
 * Markdown that reads as markdown and edits as text. Escape is captured on the document so the
 * field cancels before the inspector hears it (the InlineEdit rule, kept for the same reason).
 */
export function MarkdownEdit({ value, label, placeholder, onSave, loading }: { value: string; label: string; placeholder: string; onSave: (v: string) => void | Promise<unknown>; loading?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
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
    if (draft.trim() !== value.trim()) void onSave(draft);
  };
  if (editing)
    return (
      <div className="tm-stack" style={{ gap: "var(--tm-s2)" }}>
        <TextArea ref={ref} value={draft} rows={Math.min(24, Math.max(6, draft.split("\n").length + 2))} aria-label={label} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); }} />
        <div className="tm-inline__actions">
          <span className="tm-faint tm-grow">⌘⏎ saves · Esc cancels</span>
          <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={commit}>Save</Button>
        </div>
      </div>
    );
  return (
    <div className="tm-mdedit">
      {value.trim() ? <Markdown source={value} /> : <p className="tm-faint" style={{ fontStyle: "italic" }}>{loading ? "loading…" : placeholder}</p>}
      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={`edit ${label}`} className="tm-mdedit__btn" onClick={() => setEditing(true)} disabled={loading} />
    </div>
  );
}
