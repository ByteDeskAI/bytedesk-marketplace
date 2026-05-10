// ToolLatencyHistogram — Phase 12.x (feature #10). Renders horizontal
// bars of per-tool p50 latency from TicketStats.tool_latency_ms.
//
// TODO(server): the transcript stream does not yet populate
// `tool_latency_ms`. Once tool_use → tool_result pairing lands on the
// server, this molecule will start receiving data with no client change.

const SCALE_MAX_MS = 2000;

export interface ToolLatencyHistogramProps {
  data?: Record<string, number>;
}

export function ToolLatencyHistogram({ data }: ToolLatencyHistogramProps) {
  const entries = Object.entries(data ?? {})
    .filter(([, ms]) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section class="tool-latency">
      <h4 class="tool-latency__title">Tool latency (p50)</h4>
      {entries.length === 0 ? (
        <div class="tool-latency__empty">
          No latency samples yet. Populated once tool_use/tool_result pairs
          stream in.
        </div>
      ) : (
        <ul class="tool-latency__list">
          {entries.map(([tool, ms]) => {
            const pct = Math.min(100, (ms / SCALE_MAX_MS) * 100);
            return (
              <li key={tool} class="tool-latency__row">
                <span class="tool-latency__name" title={tool}>{tool}</span>
                <div class="tool-latency__bar-wrap">
                  <div
                    class="tool-latency__bar"
                    style={{ width: `${pct}%` }}
                    aria-label={`${tool} ${Math.round(ms)} ms`}
                  />
                </div>
                <span class="tool-latency__ms">{Math.round(ms)} ms</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
