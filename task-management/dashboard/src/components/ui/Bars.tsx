import { useId, useState } from "react";

export interface Bar { label: string; value: number; tone?: string }

/**
 * Horizontal bars, one series: thin marks with a 4 px rounded data-end, a 2 px surface gap,
 * labels in ink, values direct-labelled at the end. Sequential magnitude → one hue.
 */
export function Bars({ rows, label, height = 22, max: maxIn, format = String }: { rows: Bar[]; label: string; height?: number; max?: number; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(1, maxIn ?? Math.max(...rows.map((r) => r.value)));
  const labelW = 120;
  const width = 480;
  const total = rows.length * (height + 2);
  if (!rows.length) return null;
  return (
    <svg className="tm-chart" viewBox={`0 0 ${width} ${total}`} role="img" aria-labelledby={`${id}-t`} preserveAspectRatio="none" style={{ height: total }}>
      <title id={`${id}-t`}>{label}</title>
      {rows.map((r, i) => {
        const w = Math.max(2, ((width - labelW - 56) * r.value) / max);
        const yy = i * (height + 2);
        return (
          <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <text x={labelW - 8} y={yy + height / 2 + 4} textAnchor="end" style={{ fill: "var(--tm-ink-2)" }}>{r.label}</text>
            <rect x={labelW} y={yy + 3} width={w} height={height - 6} rx={3} style={{ fill: r.tone ? `var(--tm-status-${r.tone})` : "var(--tm-chart-1)", opacity: hover == null || hover === i ? 1 : 0.5 }}>
              <title>{`${r.label}: ${format(r.value)}`}</title>
            </rect>
            <text x={labelW + w + 6} y={yy + height / 2 + 4} style={{ fill: "var(--tm-ink)" }}>{format(r.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}
