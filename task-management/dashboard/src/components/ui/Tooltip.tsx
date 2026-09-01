import { useId, useState, type ReactNode } from "react";

/** Shown on hover and on focus, so the keyboard sees it too. Keep it to a phrase. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="tm-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-describedby={open ? id : undefined}>
      {children}
      {open && (
        <span className="tm-tip__bubble" role="tooltip" id={id}>
          {text}
        </span>
      )}
    </span>
  );
}
