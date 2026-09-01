import type { ReactNode } from "react";

/** A headline number with its label; the number is mono, the label is ink. */
export function KpiTile({ label, value, delta, tone, children }: { label: string; value: ReactNode; delta?: ReactNode; tone?: "ok" | "bad"; children?: ReactNode }) {
  return (
    <div className="tm-kpi">
      <span className="tm-kpi__label">{label}</span>
      <span className="tm-kpi__value">{value}</span>
      {delta && <span className="tm-kpi__delta" data-tone={tone}>{delta}</span>}
      {children}
    </div>
  );
}
export const KpiRow = ({ children }: { children: ReactNode }) => <div className="tm-kpis">{children}</div>;
