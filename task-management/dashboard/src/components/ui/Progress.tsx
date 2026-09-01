/** done / total as a bar; the numbers stay in text beside it. */
export function Progress({ value, max = 1, tone, label }: { value: number; max?: number; tone?: "ok"; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="tm-progress" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label} data-tone={tone}>
      <div className="tm-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
