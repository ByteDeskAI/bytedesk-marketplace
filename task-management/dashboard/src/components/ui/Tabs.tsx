import type { ReactNode } from "react";

export interface Tab { id: string; label: ReactNode; count?: number }

/** Roving tabs with arrow keys; the panel is the caller's, keyed by `value`. */
export function Tabs({ tabs, value, onChange, label }: { tabs: Tab[]; value: string; onChange: (id: string) => void; label: string }) {
  const i = Math.max(0, tabs.findIndex((t) => t.id === value));
  return (
    <div className="tm-tabs" role="tablist" aria-label={label} onKeyDown={(e) => {
      if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
      if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
    }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tm-tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && <span className="tm-chip" data-kind="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
