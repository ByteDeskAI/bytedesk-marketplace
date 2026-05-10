// SVG sparkline. Pure data → path; no animation, no axes. Used in StatCards
// for the "(24h)" trend visualization.

export interface SparklineProps {
  data: number[];
  height?: number;
  color?: string;
}

export function Sparkline({ data, height = 28, color = 'currentColor' }: SparklineProps) {
  if (data.length < 2) {
    return <svg class="sparkline" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" />;
  }
  const w = 100;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const points = data
    .map((d, i) => {
      const x = (i * step).toFixed(2);
      const y = (height - ((d - min) / range) * (height - 2) - 1).toFixed(2);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      class="sparkline"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        points={points}
      />
    </svg>
  );
}
