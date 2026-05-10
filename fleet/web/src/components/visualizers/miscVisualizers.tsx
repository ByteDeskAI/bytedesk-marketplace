// miscVisualizers — Claude Code's "everything else" tool family plus
// the generic MCP fallback (BDM-34). Side-effecting: registers on
// import. Each component trades depth for breadth — these tools fire
// infrequently and don't need bespoke chrome. The MCP fallback is
// keyed `mcp__*` so any unknown `mcp__<server>__<tool>` still renders
// structured. CSS namespace: `.viz-misc__*` (styles.css, BDM-34).

import { Fragment, type JSX } from 'preact';
import { registerToolVisualizers, type ToolVisualizerProps } from './registry';
import { VizFrame, trim } from './shared';

/* helpers */

const asString = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** "1m23s" / "12s" / "2h05m". */
function formatDuration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60), r = s % 60;
    return r > 0 ? `${m}m${String(r).padStart(2, '0')}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

/** mcp__<server>__<tool> → {server, tool}. Tolerant of malformed keys. */
function parseMcpName(name: string): { server: string; tool: string } {
  if (!name.startsWith('mcp__')) return { server: '', tool: name };
  const rest = name.slice(5);
  const idx = rest.lastIndexOf('__');
  if (idx < 0) return { server: rest, tool: '' };
  return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) };
}

function pretty(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

/** Try to JSON.parse the raw output and pretty-print; fall back to raw. */
function prettyOutput(raw: string | undefined): string {
  const r = (raw ?? '').trim();
  if (!r) return '';
  if (r.startsWith('{') || r.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(r), null, 2); } catch { /* noop */ }
  }
  return r;
}

/** Render the first 1-2 input keys as a compact "k=v · k=v" string. */
function kvSummary(input: Record<string, unknown>, skip: Set<string> = new Set()): string {
  return Object.keys(input)
    .filter((k) => !skip.has(k))
    .slice(0, 2)
    .map((k) => `${k}=${trim(asString(input[k]) || pretty(input[k]), 40)}`)
    .join(' · ');
}

/** Reusable input/output panel for tools where we just want JSON dumps. */
function IOPanel({ input, output }: { input: unknown; output?: string }): JSX.Element {
  return (
    <div class="viz-misc__stack">
      <div class="viz-misc__label">input</div>
      <pre class="viz-misc__pre">{pretty(input)}</pre>
      {output ? (
        <Fragment>
          <div class="viz-misc__label">output</div>
          <pre class="viz-misc__pre">{output}</pre>
        </Fragment>
      ) : null}
    </div>
  );
}

/* Agent / Task */

function AgentVisualizer({ toolName, input, output, state }: ToolVisualizerProps): JSX.Element {
  const description = asString(input.description);
  const prompt = asString(input.prompt);
  const subagent = asString(input.subagent_type) || 'agent';
  const model = asString(input.model);
  const out = (output ?? '').trim();
  const agentId = out.match(/agentId:\s*([A-Za-z0-9_-]+)/)?.[1] ?? '';
  // Heuristic: a "final report" is multi-line and not the launch banner.
  const isReport = out && !out.startsWith('Async agent launched') && out.split('\n').length > 3;

  const summary = (
    <Fragment>
      <span class="viz-misc__pill">{subagent}</span>
      <span class="viz-misc__text">{trim(description || prompt, 100)}</span>
    </Fragment>
  );
  const details = (
    <div class="viz-misc__stack">
      {prompt ? (
        <Fragment>
          <div class="viz-misc__label">prompt</div>
          <pre class="viz-misc__pre">{prompt}</pre>
        </Fragment>
      ) : null}
      {agentId ? (
        <div class="viz-misc__chips">
          <span class="viz-misc__chip">agent {agentId}</span>
          {model ? <span class="viz-misc__chip">{model}</span> : null}
        </div>
      ) : null}
      {isReport ? (
        <Fragment>
          <div class="viz-misc__label">report</div>
          <pre class="viz-misc__pre">{out}</pre>
        </Fragment>
      ) : null}
    </div>
  );
  const right = <span class="viz-misc__pill viz-misc__pill--accent">→ {subagent}</span>;
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary} details={details} rightAccessory={right}
    />
  );
}

/* ScheduleWakeup */

function ScheduleWakeupVisualizer({ toolName, input, state }: ToolVisualizerProps): JSX.Element {
  const dur = formatDuration(asNumber(input.delaySeconds));
  const reason = asString(input.reason);
  const prompt = asString(input.prompt);
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">wake in {dur || '?'}</span>
      {reason ? <span class="viz-misc__text">{trim(reason, 80)}</span> : null}
    </Fragment>
  );
  const details = prompt ? <pre class="viz-misc__pre">{prompt}</pre> : undefined;
  const right = <span class="viz-misc__accessory" aria-hidden>⏰</span>;
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary} details={details} rightAccessory={right}
    />
  );
}

/* Skill */

function SkillVisualizer({ toolName, input, output, state }: ToolVisualizerProps): JSX.Element {
  const skill = asString(input.skill);
  const args = asString(input.args);
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">/{skill || '?'}</span>
      {args ? <span class="viz-misc__text">{trim(args, 100)}</span> : null}
    </Fragment>
  );
  const details = output ? <pre class="viz-misc__pre">{output}</pre> : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

/* ExitPlanMode */

function ExitPlanModeVisualizer({ toolName, input, output, state }: ToolVisualizerProps): JSX.Element {
  const allowed = asArray(input.allowedPrompts).map((row) => {
    const r = asRecord(row);
    return { tool: asString(r.tool), prompt: asString(r.prompt) };
  });
  const approved = (output ?? '').toLowerCase().includes('approved');
  const summary = (
    <span class="viz-misc__text">{approved ? 'plan approved' : 'plan exited'}</span>
  );
  const details = allowed.length > 0 ? (
    <div class="viz-misc__rows">
      {allowed.map((row, i) => (
        <div class="viz-misc__row" key={i}>
          <span class="viz-misc__chip">{row.tool || '—'}</span>
          <span class="viz-misc__line">{trim(row.prompt, 200)}</span>
        </div>
      ))}
    </div>
  ) : undefined;
  const right = (
    <span
      class={`viz-misc__accessory viz-misc__accessory--${approved ? 'ok' : 'no'}`}
      aria-hidden
    >{approved ? '✓' : '✕'}</span>
  );
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary} details={details} rightAccessory={right}
    />
  );
}

/* ToolSearch */

function ToolSearchVisualizer({ toolName, input, state }: ToolVisualizerProps): JSX.Element {
  const query = asString(input.query);
  const max = asNumber(input.max_results);
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">tool search</span>
      <span class="viz-misc__text">{trim(query, 100)}</span>
      {max != null ? <span class="viz-misc__chip">max {max}</span> : null}
    </Fragment>
  );
  const details = (
    <div class="viz-misc__note">matched tool schemas appear in the next system message</div>
  );
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

/* ModeChange — EnterPlan / EnterWorktree / ExitWorktree */

function ModeChangeVisualizer({ toolName, input, state }: ToolVisualizerProps): JSX.Element {
  const head = kvSummary(input);
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">{toolName}</span>
      {head ? <span class="viz-misc__text">{head}</span> : null}
    </Fragment>
  );
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary}
      details={<pre class="viz-misc__pre">{pretty(input)}</pre>}
    />
  );
}

/* LSP */

function LSPVisualizer({ toolName, input, output, state }: ToolVisualizerProps): JSX.Element {
  const action = asString(input.action) || 'lsp';
  const firstKey = Object.keys(input).find((k) => k !== 'action');
  const firstVal = firstKey ? trim(asString(input[firstKey]) || pretty(input[firstKey]), 80) : '';
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">{action}</span>
      {firstKey ? (
        <span class="viz-misc__text">
          <span class="viz-misc__label-inline">{firstKey}:</span> {firstVal}
        </span>
      ) : null}
    </Fragment>
  );
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary}
      details={<IOPanel input={input} output={output} />}
    />
  );
}

/* PushNotification */

function PushNotificationVisualizer({ toolName, input, state }: ToolVisualizerProps): JSX.Element {
  const title = asString(input.title);
  const message = asString(input.message);
  const summary = <span class="viz-misc__text">{trim(title, 120)}</span>;
  const details = message ? <div class="viz-misc__note">{message}</div> : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

/* Cron — Create / List / Delete */

function CronVisualizer({ toolName, input, state }: ToolVisualizerProps): JSX.Element {
  const expr = asString(input.cron) || asString(input.schedule) || asString(input.expression);
  const id = asString(input.id) || asString(input.name);
  const tail = expr || id;
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">{toolName}</span>
      {tail ? <span class="viz-misc__text">{trim(tail, 100)}</span> : null}
    </Fragment>
  );
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary}
      details={<pre class="viz-misc__pre">{pretty(input)}</pre>}
    />
  );
}

/* GenericInfo — RemoteTrigger / Monitor / SendMessage */

function GenericInfoVisualizer({ toolName, input, output, state }: ToolVisualizerProps): JSX.Element {
  const head = kvSummary(input);
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">{toolName}</span>
      {head ? <span class="viz-misc__text">{head}</span> : null}
    </Fragment>
  );
  return (
    <VizFrame
      toolName={toolName} state={state} summary={summary}
      details={<IOPanel input={input} output={output} />}
    />
  );
}

/* MCP generic fallback */

const MCP_BORING_KEYS = new Set(['cloudId', 'spaceId', 'accountId', 'projectId']);

function MCPFallbackVisualizer({ toolName, input, output, state }: ToolVisualizerProps): JSX.Element {
  const { server, tool } = parseMcpName(toolName);
  const head = kvSummary(input, MCP_BORING_KEYS);
  const summary = (
    <Fragment>
      <span class="viz-misc__pill">[mcp:{server || '?'}]</span>
      <span class="viz-misc__text">
        {tool || toolName}
        {head ? <span class="viz-misc__sep"> · {head}</span> : null}
      </span>
    </Fragment>
  );
  const outPretty = prettyOutput(output);
  const details = (
    <div class="viz-misc__stack">
      <details class="viz-misc__details">
        <summary class="viz-misc__details-summary">input</summary>
        <pre class="viz-misc__pre">{pretty(input)}</pre>
      </details>
      {outPretty ? (
        <Fragment>
          <div class="viz-misc__label">output</div>
          <pre class="viz-misc__pre">{outPretty}</pre>
        </Fragment>
      ) : null}
    </div>
  );
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

/* registration */

registerToolVisualizers({
  Agent: AgentVisualizer,
  Task: AgentVisualizer,
  ScheduleWakeup: ScheduleWakeupVisualizer,
  Skill: SkillVisualizer,
  ExitPlanMode: ExitPlanModeVisualizer,
  EnterPlanMode: ModeChangeVisualizer,
  EnterWorktree: ModeChangeVisualizer,
  ExitWorktree: ModeChangeVisualizer,
  ToolSearch: ToolSearchVisualizer,
  LSP: LSPVisualizer,
  PushNotification: PushNotificationVisualizer,
  CronCreate: CronVisualizer,
  CronList: CronVisualizer,
  CronDelete: CronVisualizer,
  RemoteTrigger: GenericInfoVisualizer,
  Monitor: GenericInfoVisualizer,
  SendMessage: GenericInfoVisualizer,
  'mcp__*': MCPFallbackVisualizer,
});
