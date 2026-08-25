# Gateway visualization contract

Gateway visualizations explain live host, session, transfer, deployment, and agent state.
They are operational instruments, not decorative dashboard graphics. This contract is
shared by browser and native clients.

## 1. When to visualize

Use a chart when shape, rate, comparison, distribution, or change over time matters.
Use a table or value when an exact current fact is the task.

Good chart subjects:

- CPU, memory, disk, network, and process history;
- terminal/session capacity and occupancy;
- transfer throughput and queue depth;
- deploy, watchdog, and incident timelines;
- agent run duration, tool activity, and fleet state;
- storage or project composition where comparison matters.

Do not chart a single value merely to fill space. Do not replace actionable status with
a gauge.

## 2. Token contract

Use:

- `color.chart.series-1` through `series-8` in order;
- `color.chart.grid`, `axis`, `plot`, and `selection`;
- semantic success, warning, and danger only for thresholds or outcomes;
- `stroke.chart` for the primary series;
- `size.chart.point` for markers;
- `size.chart.minimum-height` as the minimum useful plot height.

Series colors are identity within one visualization, not global meaning. A blue series in
one chart does not imply the same metric in another.

## 3. Non-color distinction

Every multi-series chart uses at least one additional distinction:

- direct labels;
- marker shapes;
- line dash;
- line width;
- fill pattern;
- ordered legend with values.

Warnings and thresholds include a word, icon, or labeled line. Never depend on red versus
green alone.

## 4. Axes and grids

- Prefer zero baselines when comparing magnitude; disclose truncated axes when needed.
- Time moves left to right.
- Grid lines use `color.chart.grid` and remain quieter than data.
- Axis labels use `color.chart.axis`; units appear once per axis or value group.
- Avoid more precision than the source data supports.
- Human-readable units and raw values are both available in detail.
- Use mono numerals for machine values where alignment matters.

## 5. Live data

A live visualization has four explicit freshness states:

- **Live** — new samples arrive within the declared interval.
- **Paused** — user intentionally stopped or inspected history.
- **Stale** — last sample is retained beyond the freshness threshold.
- **Disconnected** — transport is unavailable.

The plot may retain historical data in stale/disconnected states, but an overlay or
header label must prevent it from appearing current. Reconnection must not erase the
visible time context without user intent.

Do not animate every sample. Transition only when it improves tracking and disable
non-essential motion for reduced-motion users.

## 6. Sampling and aggregation

The server remains authoritative for sample timestamps. Clients may downsample for
rendering but must preserve:

- minimum and maximum;
- first and last;
- spikes relevant to thresholds;
- gaps and missing data;
- the selected inspection point.

A downsampled line must not bridge a known outage as though data existed. Use a visible
gap.

## 7. Time ranges

Standard ranges:

- 1 minute;
- 5 minutes;
- 15 minutes;
- 1 hour;
- 6 hours;
- 24 hours;
- custom where the server supports it.

The selected range, sample interval, timezone, and whether values are live or historical
remain visible. Absolute timestamps are available during inspection.

## 8. Chart types

### Line

Default for time series. Use no more than eight simultaneous series; prefer small
multiples or filters beyond that.

### Area

Use for one cumulative or capacity-oriented series. Multiple opaque stacked areas are
hard to compare and should be avoided unless the total is the primary question.

### Bar

Use for categorical comparison, bounded time buckets, or ranked values. Start at zero
unless the visual explicitly calls out a truncated domain.

### Stacked bar

Use when both total and composition matter. Keep category order stable.

### Scatter

Use for correlation, latency distributions, process outliers, or agent-run comparisons.
Expose the selected point's exact values and identity.

### Heatmap

Use for dense time/category patterns such as activity by host or hour. Provide a labeled
scale and a table alternative.

### Timeline

Use for deploys, incidents, agent steps, approvals, and session events. Events have
labels and exact timestamps; overlap is resolved through lanes rather than hidden.

### Gauge

Avoid by default. Use a number plus threshold bar for capacity or health. A gauge is
allowed only when a stable bounded range and immediate threshold judgment are central.

### Pie / donut

Avoid for operational data. Use a sorted bar or table unless there are at most four
parts and the part-to-whole question is primary.

## 9. Thresholds and anomalies

Thresholds come from the server or a declared client preference. They use labeled lines
or bands with semantic tokens.

An anomaly marker shows:

- metric and observed value;
- expected range or comparison;
- timestamp/duration;
- detection source;
- related incident or agent analysis;
- acknowledgement/resolution state when supported.

Anomaly color does not permanently recolor the whole series.

## 10. Interaction

Pointer clients support hover inspection; keyboard and touch clients support focus or
tap selection. Inspection shows:

- timestamp/category;
- exact value and unit;
- series name;
- threshold/anomaly context;
- source/freshness.

Zoom and pan have reset controls. Brush selection has a keyboard-accessible range input
or preset alternative. Tooltips do not obscure the selected data or leave the viewport.

## 11. Accessibility

- Provide an accessible title and concise summary.
- Provide a data table or equivalent ordered value list.
- Exclude decorative grid and path elements from the accessibility tree.
- Do not announce every incoming sample.
- Keyboard users can reach the chart controls and inspect meaningful points/series.
- Text, markers, and direct labels meet contrast requirements against the plot.
- Respect reduced motion and operating-system text scaling.

## 12. Performance

A visualization should remain interactive while the terminal, remote screen, and AG-UI
streams are active.

- render at the display refresh rate at most;
- batch high-frequency updates;
- bound retained points;
- use canvas/GPU rendering when SVG/DOM cost becomes material;
- pause off-screen rendering without pausing server collection;
- avoid blocking the input or terminal event loop;
- expose dropped/downsampled sample counts in diagnostics.

Native and browser renderers may differ, but must use the same source data, aggregation
rules, colors, units, labels, and freshness state.

## 13. Review checklist

A visualization is ready when:

- the exact operator question it answers is documented;
- a table/value alternative exists;
- units, range, interval, timezone, and freshness are visible;
- color is not the only distinction;
- gaps remain gaps;
- stale and disconnected states are testable;
- reduced motion and keyboard inspection work;
- 1600 × 900, 1280 × 720, and compact layouts remain readable;
- browser and native screenshots show equivalent meaning.
