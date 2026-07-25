import Tooltip from "@atlaskit/tooltip";
import { token } from "@atlaskit/tokens";

interface Point {
  day: string;
  remaining: number;
  done: number;
}

/** Burndown line over throughput bars. Inline SVG — a chart library for 150px is not a trade. */
export function Sparkline({ series }: { series: Point[] }) {
  if (!series.length) return null;
  const W = 150;
  const H = 30;
  const step = W / Math.max(1, series.length - 1);
  const top = Math.max(1, ...series.map((d) => d.remaining));
  const peak = Math.max(1, ...series.map((d) => d.done));
  const y = (v: number) => H - (v / top) * (H - 3) - 1;
  const line = series.map((d, i) => `${(i * step).toFixed(1)},${y(d.remaining).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const shipped = series.reduce((n, d) => n + d.done, 0);

  return (
    <Tooltip content={`${last.remaining} open · ${shipped} closed in ${series.length} days`}>
      <svg
        width={W}
        height={H}
        viewBox={`-3 0 ${W + 6} ${H}`}
        role="img"
        aria-label={`remaining work over ${series.length} days, now ${last.remaining}`}
        style={{ display: "block" }}
      >
        {series.map((d, i) =>
          d.done ? (
            <rect
              key={d.day}
              x={i * step - 2}
              y={H - (d.done / peak) * 10}
              width={4}
              height={(d.done / peak) * 10}
              fill={token("color.icon.success")}
              opacity={0.55}
            />
          ) : null,
        )}
        <polyline
          points={line}
          fill="none"
          stroke={token("color.icon.brand")}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={W} cy={y(last.remaining)} r={2} fill={token("color.icon.brand")} />
      </svg>
    </Tooltip>
  );
}
