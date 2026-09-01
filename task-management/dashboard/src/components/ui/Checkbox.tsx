import type { ReactNode } from "react";

/** A criterion tick: the label strikes through when done, but stays readable. */
export function Checkbox({ checked, onChange, children, disabled, strike }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean; strike?: boolean }) {
  return (
    <label className="tm-check" data-done={(strike && checked) || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}
