import type { ReactNode } from "react";

/** Says what would fill the space and how. `tone="ok"` is a good empty (doctor: nothing wrong). */
export function EmptyState({ icon, title, children, action, tone }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div className="tm-empty" data-tone={tone} role="status">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
