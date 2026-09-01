import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismiss, useToasts } from "../../lib/toast";
import { Button } from "./Button";

const ICON = { ok: CheckCircle2, bad: XCircle, warn: AlertTriangle, info: Info };

/** The visible half of a write result; LiveRegion speaks the same text. */
export function Toasts() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="tm-toasts">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div key={t.id} className="tm-toast" data-tone={t.tone} role="status">
            <Icon size={16} style={{ color: `var(--tm-${t.tone === "info" ? "info" : t.tone})`, flex: "none", marginTop: 2 }} />
            <div className="tm-toast__body">
              <div className="tm-toast__title">{t.title}</div>
              {t.detail && <div className="tm-muted">{t.detail}</div>}
            </div>
            <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="dismiss" onClick={() => dismiss(t.id)} />
          </div>
        );
      })}
    </div>
  );
}
