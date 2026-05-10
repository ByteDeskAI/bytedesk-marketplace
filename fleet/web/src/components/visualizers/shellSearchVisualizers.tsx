// shellSearchVisualizers — Bash / BashOutput / Grep / Glob (BDM-34).
//
// One file, four components. Bash + BashOutput render terminal-style
// pre blocks; Grep + Glob render structured row lists. All wrap the
// shared VizFrame so headers stack consistently with the file/web/misc
// visualizers.
//
// Defensive about Claude Code's tool_result shape: outputs may arrive
// empty, multi-MB, or with trailing whitespace. We trim, cap, and lean
// on `overflow:auto` in CSS rather than truncating mid-stream.

import type { ComponentChildren, JSX } from 'preact';
import { registerToolVisualizers, type ToolVisualizerProps } from './registry';
import { VizFrame, trim } from './shared';

/* helpers — coerce unknown input shapes + cap output safely. */
const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const asBool = (v: unknown): boolean =>
  typeof v === 'boolean' ? v : v === 'true';

interface Normalized { text: string; lines: number; truncated: boolean }
function normalizeOutput(out: string | undefined, maxLines = 500): Normalized {
  const raw = (out ?? '').replace(/\s+$/, '');
  if (!raw) return { text: '', lines: 0, truncated: false };
  const ls = raw.split('\n');
  if (ls.length <= maxLines) return { text: raw, lines: ls.length, truncated: false };
  return {
    text: ls.slice(0, maxLines).join('\n') + `\n… (+${ls.length - maxLines} more lines)`,
    lines: ls.length,
    truncated: true,
  };
}

/* Bash */
function BashVisualizer({ input, output, state }: ToolVisualizerProps): JSX.Element {
  const command = asString(input.command);
  const description = asString(input.description);
  const background = asBool(input.run_in_background);
  const timeout = asNumber(input.timeout);
  const { text, lines, truncated } = normalizeOutput(output);

  const summary = <code class="viz-shell__cmd">{trim(command, 80)}</code>;
  const right: ComponentChildren = background ? (
    <span class="viz-pill" title={timeout ? `timeout ${timeout}ms` : 'background'}>
      ⏱ bg
    </span>
  ) : null;

  const details = (
    <div class="viz-shell">
      {description ? <div class="viz-shell__desc">{description}</div> : null}
      <pre class={`viz-shell__pre${state === 'error' ? ' viz-shell__pre--error' : ''}`}>
        {text || (state === 'running' ? '(running…)' : '(no output)')}
      </pre>
      <div class="viz-shell__meta">
        {lines > 0 ? `${lines} line${lines === 1 ? '' : 's'}` : null}
        {truncated ? ' • truncated' : null}
      </div>
    </div>
  );

  return (
    <VizFrame
      toolName="Bash"
      state={state}
      summary={summary}
      details={details}
      rightAccessory={right}
    />
  );
}

/* BashOutput */
function BashOutputVisualizer({ input, output, state }: ToolVisualizerProps): JSX.Element {
  const bashId = asString(input.bash_id, '?');
  const filter = asString(input.filter);
  const { text, lines } = normalizeOutput(output);
  const live = state === 'running';

  const summary = (
    <span>
      <span class="viz-shell__bg">bg #{bashId}</span>
      <span class="viz-muted"> · {lines} line{lines === 1 ? '' : 's'}</span>
      {filter ? <span class="viz-muted"> · /{trim(filter, 24)}/</span> : null}
    </span>
  );

  const details = (
    <div class="viz-shell">
      <pre class="viz-shell__pre">
        {text || (live ? '(waiting for output…)' : '(no output yet)')}
        {live && text ? '\n…' : ''}
      </pre>
      {live ? <div class="viz-shell__meta">(live)</div> : null}
    </div>
  );

  return (
    <VizFrame
      toolName="BashOutput"
      state={state}
      summary={summary}
      details={details}
    />
  );
}

/* Grep */
interface GrepRow {
  path: string;
  line?: string;
  match: string;
}

/** Parse `path:line:match` rows. Path can contain colons but the
 *  first two segments are stable when output_mode === 'content' with
 *  -n flag (default for fleet's typical invocations). For paths with
 *  drive-letter colons we look for the first colon after a likely
 *  filename character — but in practice Linux paths dominate. */
function parseGrepContent(text: string): GrepRow[] {
  if (!text) return [];
  return text.split('\n').map((raw): GrepRow => {
    const idx1 = raw.indexOf(':');
    if (idx1 < 0) return { path: '', match: raw };
    const idx2 = raw.indexOf(':', idx1 + 1);
    if (idx2 < 0) return { path: raw.slice(0, idx1), match: raw.slice(idx1 + 1) };
    const maybeNum = raw.slice(idx1 + 1, idx2);
    if (/^\d+$/.test(maybeNum)) {
      return { path: raw.slice(0, idx1), line: maybeNum, match: raw.slice(idx2 + 1) };
    }
    return { path: raw.slice(0, idx1), match: raw.slice(idx1 + 1) };
  });
}

/** Highlight every occurrence of `pattern` (literal, case-insensitive)
 *  in `match` with <mark>. Falls back to plain text if pattern is empty
 *  or appears to be regex-special — best-effort, never throws. */
function highlight(match: string, pattern: string): ComponentChildren {
  if (!pattern || !match) return match;
  const safe = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re: RegExp;
  try {
    re = new RegExp(safe, 'gi');
  } catch {
    return match;
  }
  const parts: ComponentChildren[] = [];
  let last = 0;
  for (const m of match.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(match.slice(last, i));
    parts.push(<mark>{m[0]}</mark>);
    last = i + m[0].length;
  }
  if (last < match.length) parts.push(match.slice(last));
  return parts.length > 0 ? parts : match;
}

function GrepVisualizer({ input, output, state }: ToolVisualizerProps): JSX.Element {
  const pattern = asString(input.pattern);
  const path = asString(input.path);
  const mode = asString(input.output_mode, 'content');
  const glob = asString(input.glob);
  const fileType = asString(input.type);
  const { text } = normalizeOutput(output, 1000);

  const rawLines = text ? text.split('\n').filter((l) => l.length > 0) : [];

  let body: ComponentChildren;
  let summaryCount: string;

  if (mode === 'count') {
    const rows = rawLines.map((l): { path: string; n: string } => {
      const idx = l.lastIndexOf(':');
      return idx > 0
        ? { path: l.slice(0, idx), n: l.slice(idx + 1) }
        : { path: l, n: '?' };
    });
    const total = rows.reduce((acc, r) => acc + (parseInt(r.n, 10) || 0), 0);
    summaryCount = `${total} match${total === 1 ? '' : 'es'} in ${rows.length} file${rows.length === 1 ? '' : 's'}`;
    body = (
      <ul class="viz-grep__list">
        {rows.map((r) => (
          <li class="viz-grep__row">
            <span class="viz-grep__path">{r.path}</span>
            <span class="viz-grep__count">{r.n}</span>
          </li>
        ))}
      </ul>
    );
  } else if (mode === 'files_with_matches') {
    summaryCount = `${rawLines.length} file${rawLines.length === 1 ? '' : 's'}`;
    body = (
      <ul class="viz-grep__list">
        {rawLines.map((p) => (
          <li class="viz-grep__row"><span class="viz-grep__path">{p}</span></li>
        ))}
      </ul>
    );
  } else {
    const rows = parseGrepContent(text);
    summaryCount = `${rows.length} match${rows.length === 1 ? '' : 'es'}`;
    body = (
      <ul class="viz-grep__list">
        {rows.map((r) => (
          <li class="viz-grep__row">
            <span class="viz-grep__path">{r.path}</span>
            {r.line ? <span class="viz-grep__lineno">:{r.line}</span> : null}
            <span class="viz-grep__match">{highlight(r.match, pattern)}</span>
          </li>
        ))}
      </ul>
    );
  }

  const summary = (
    <span>
      <code class="viz-grep__pattern">/{trim(pattern, 48)}/</code>
      <span class="viz-muted"> · {summaryCount}</span>
      {path ? <span class="viz-muted"> · {trim(path, 32)}</span> : null}
      {glob ? <span class="viz-muted"> · {glob}</span> : null}
      {fileType ? <span class="viz-muted"> · type:{fileType}</span> : null}
    </span>
  );

  return <VizFrame toolName="Grep" state={state} summary={summary} details={body} />;
}

/* Glob */
function GlobVisualizer({ input, output, state }: ToolVisualizerProps): JSX.Element {
  const pattern = asString(input.pattern);
  const root = asString(input.path);
  const { text } = normalizeOutput(output, 5000);
  const all = text ? text.split('\n').filter((l) => l.length > 0) : [];

  const cap = 200;
  const visible = all.slice(0, cap);
  const overflow = all.length - visible.length;

  // Group by parent directory so the structure is scannable.
  const groups = new Map<string, string[]>();
  for (const p of visible) {
    const slash = p.lastIndexOf('/');
    const dir = slash > 0 ? p.slice(0, slash) : '.';
    const file = slash > 0 ? p.slice(slash + 1) : p;
    const arr = groups.get(dir);
    if (arr) arr.push(file);
    else groups.set(dir, [file]);
  }

  const summary = (
    <span>
      <code class="viz-glob__pattern">{trim(pattern, 48)}</code>
      <span class="viz-muted"> · {all.length} match{all.length === 1 ? '' : 'es'}</span>
      {root ? <span class="viz-muted"> · in {trim(root, 32)}</span> : null}
    </span>
  );

  const details = (
    <div class="viz-glob">
      {Array.from(groups.entries()).map(([dir, files]) => (
        <div class="viz-glob__group">
          <div class="viz-glob__dir">{dir}/</div>
          <ul class="viz-glob__files">
            {files.map((f) => <li class="viz-glob__file">{f}</li>)}
          </ul>
        </div>
      ))}
      {overflow > 0 ? (
        <div class="viz-glob__overflow">+{overflow} more</div>
      ) : null}
    </div>
  );

  return <VizFrame toolName="Glob" state={state} summary={summary} details={details} />;
}

/* register */
registerToolVisualizers({
  Bash: BashVisualizer,
  BashOutput: BashOutputVisualizer,
  Grep: GrepVisualizer,
  Glob: GlobVisualizer,
});
