import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * Native <dialog>: focus trap, Escape and the backdrop come from the platform. `inert` on #root
 * keeps the board behind it out of the tab order and the accessibility tree.
 */
export function Modal({ open, onClose, title, children, footer, size }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; size?: "lg" | "bare" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const root = document.getElementById("root");
    if (open && !d.open) {
      d.showModal();
      root?.setAttribute("inert", "");
    } else if (!open && d.open) {
      d.close();
      root?.removeAttribute("inert");
    }
    return () => root?.removeAttribute("inert");
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="tm-modal"
      data-size={size}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // The shell listens for Escape on window and may preventDefault, which cancels the
      // platform close; own the key here so a dialog always closes on Escape.
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="tm-stack" style={{ gap: 0, maxHeight: "inherit" }} onClick={(e) => e.stopPropagation()}>
          {title && (
            <div className="tm-modal__head">
              <h2>{title}</h2>
              <Button variant="ghost" size="sm" icon={<X size={16} />} aria-label="close" onClick={onClose} />
            </div>
          )}
          <div className="tm-modal__body">{children}</div>
          {footer && <div className="tm-modal__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
