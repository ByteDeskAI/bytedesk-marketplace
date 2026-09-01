import { useId, useState } from "react";

/**
 * A line over optional bars, 2 px stroke, no axes: a trend at a glance beside a number. The
 * value on hover appears in a tooltip; the current value is printed by the caller in ink.
 */
export function Sparkline({ points, bars, width = 150, height = 30, label }: { points: number[]; bars?: number[]; width?: number; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const n = Math.max(points.length, bars?.length ?? 0);
  if (n < 2) return <svg className="tm-chart" width={width} height={height} role="img" aria-label={`${label}: not enough data`} />;
  const max = Math.max(1, ...points, ...(bars ?? []));
  const x = (i: number) => (i / (n - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - (v / max) * (height - 4);
  const path = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const bw = Math.max(1, (width / n) * 0.5);
  return (
    <svg className="tm-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)}>
      <title id={`${id}-t`}>{label}</title>
      {bars?.map((v, i) => (
        <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={height - 1 - y(v)} rx={1} style={{ fill: "var(--tm-chart-2)", opacity: hover === i ? 1 : 0.55 }} />
      ))}
      <path d={path} fill="none" style={{ stroke: "var(--tm-chart-1)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
      {hover != null && <circle cx={x(hover)} cy={y(points[hover] ?? 0)} r={3} style={{ fill: "var(--tm-chart-1)", stroke: "var(--tm-surface)", strokeWidth: 2 }} />}
      {Array.from({ length: n }, (_, i) => (
        <rect key={`h${i}`} x={x(i) - width / n / 2} y={0} width={width / n} height={height} fill="transparent" onMouseEnter={() => setHover(i)}>
          <title>{`${label} · ${points[i] ?? 0}${bars ? ` / ${bars[i] ?? 0}` : ""}`}</title>
        </rect>
      ))}
    </svg>
  );
}
