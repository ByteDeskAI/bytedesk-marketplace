import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * The lifted panel at the shell edge: a header that stays put, one body that scrolls, with
 * `overscroll-behavior: contain` so reaching the end never scrolls the board underneath.
 * Focus lands on the title on open; the caller returns it to the opener on close.
 */
export function Inspector({ title, meta, actions, onClose, children, wide, id }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; id?: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [id]);
  return (
    <aside className="tm-inspector" data-tm-drawer data-wide={wide || undefined} aria-label={typeof title === "string" ? title : "details"}>
      <header className="tm-inspector__head">
        <div className="tm-row">
          {meta}
          <span className="tm-grow" />
          {actions}
          <Button variant="ghost" size="sm" icon={<X size={16} />} aria-label="close" onClick={onClose} />
        </div>
        <h2 className="tm-inspector__title" ref={heading} tabIndex={-1}>{title}</h2>
      </header>
      <div className="tm-inspector__body">{children}</div>
    </aside>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="tm-inspector__section" aria-label={title}>
      <div className="tm-row">
        <span className="tm-caps">{title}</span>
        <span className="tm-grow" />
        {actions}
      </div>
      {children}
    </section>
  );
}
