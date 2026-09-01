import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

/** One per screen. Shows the server's own words; never a generic "something went wrong". */
export function ErrorPanel({ title = "That did not work", detail, action }: { title?: string; detail?: string | null; action?: ReactNode }) {
  return (
    <div className="tm-error" role="alert">
      <AlertTriangle size={16} />
      <div className="tm-stack" style={{ gap: "var(--tm-s2)" }}>
        <strong>{title}</strong>
        {detail && <pre>{detail}</pre>}
        {action}
      </div>
    </div>
  );
}
