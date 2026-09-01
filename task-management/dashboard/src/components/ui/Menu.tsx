import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem { label: ReactNode; onSelect: () => void; tone?: "bad"; icon?: ReactNode; disabled?: boolean }

/** A button that opens a list. Escape and outside-click close; arrows move. */
export function Menu({ trigger, items, align = "end", label }: { trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: (MenuItem | "sep")[]; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const els = [...(root.current?.querySelectorAll<HTMLElement>(".tm-menu__item:not(:disabled)") ?? [])];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", key, true);
    root.current?.querySelector<HTMLElement>(".tm-menu__item")?.focus();
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <div className="tm-menu" ref={root}>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div className="tm-menu__list" role="menu" aria-label={label} data-align={align}>
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="tm-menu__sep" role="separator" />
            ) : (
              <button key={i} type="button" role="menuitem" className="tm-menu__item" data-tone={it.tone} disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect(); }}>
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
