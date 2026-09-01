import { useEffect, useId, useRef, useState } from "react";
import { Chip } from "./Chip";
import { TextField } from "./Field";

export interface ComboboxProps {
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
  /** Allow a value not in `options` (labels). */
  creatable?: boolean;
  placeholder?: string;
  label: string;
  /** Group options visually — `decision:*` roles vs free labels. */
  chipKind?: "label" | "plain";
}

/** Multi-select listbox with roving focus and typed filtering. Values render as removable chips. */
export function Combobox({ values, options, onChange, creatable, placeholder = "add…", label, chipKind = "label" }: ComboboxProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = options.filter((o) => !values.includes(o) && o.toLowerCase().includes(q.toLowerCase()));
  const canCreate = creatable && q.trim() && !options.includes(q.trim()) && !values.includes(q.trim());
  const rows = canCreate ? [...shown, q.trim()] : shown;
  useEffect(() => setCursor(0), [q, open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const pick = (v: string) => {
    onChange([...values, v]);
    setQ("");
    setOpen(false);
  };
  return (
    <div className="tm-combo" ref={root}>
      {values.length > 0 && (
        <div className="tm-combo__values" style={{ marginBottom: "var(--tm-s2)" }}>
          {values.map((v) => (
            <Chip key={v} kind={chipKind} onRemove={() => onChange(values.filter((x) => x !== v))}>{v}</Chip>
          ))}
        </div>
      )}
      <TextField
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        value={q}
        placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && rows[cursor]) { e.preventDefault(); pick(rows[cursor]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
          else if (e.key === "Backspace" && !q && values.length) onChange(values.slice(0, -1));
        }}
      />
      {open && rows.length > 0 && (
        <ul className="tm-combo__list" role="listbox" id={`${id}-list`}>
          {rows.map((o, i) => (
            <li key={o} role="option" aria-selected={i === cursor} className="tm-combo__opt" onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setCursor(i)}>
              {canCreate && i === rows.length - 1 ? <><span className="tm-faint">add</span> {o}</> : o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
