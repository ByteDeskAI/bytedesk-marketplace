// webTaskVisualizers.tsx — WebFetch / WebSearch / TodoWrite + the
// TASK family (Create/Update/List/Get/Stop/Output). Side-effecting
// module — registers itself on import. Owns the `.viz-webtask*` CSS
// namespace; styles live in styles.css under BDM-34 web+task block.
// See registry.ts for the dispatch contract.
//
// Design notes:
// - WebFetch shows hostname only in summary; full URL is a caption.
// - WebSearch lifts domain filters into pills so "why these results"
//   is answerable without parsing markdown links.
// - TodoWrite uses unicode glyphs (☐ ▶ ✓) so the list reads like a
//   real checklist; in_progress + completed are colored.
// - TaskCreate parses `Task #N` from the success text and surfaces N
//   as a right-accessory chip instead of burying it in body.
// - TaskUpdate lists only changed fields — dumping the full input
//   would re-show unchanged taskId/owner noise.
// - Log-like outputs (TaskOutput/List/Get/WebSearch) stay as <pre>;
//   markdown rendering would balloon the bundle.

import { Fragment } from 'preact';
import { registerToolVisualizers, type ToolVisualizerProps } from './registry';
import { VizFrame, trim } from './shared';

// ---------- helpers ----------

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function hostnameOf(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    // Some inputs are not full URLs (e.g. `example.com/path`); fall
    // back to a best-effort split rather than dropping the value.
    const m = url.match(/^(?:[a-z]+:\/\/)?([^/?#]+)/i);
    return m ? m[1] : url;
  }
}

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';
function asTaskStatus(v: unknown): TaskStatus | null {
  return v === 'pending' || v === 'in_progress' || v === 'completed' || v === 'deleted'
    ? v
    : null;
}

/** Pull `Task #N` out of the create / update success text. Returns
 *  null if no integer follows the hash. */
function parseTaskNumber(output: string): number | null {
  if (!output) return null;
  const m = output.match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

// ---------- WebFetch ----------

function WebFetchVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const url = str(input.url);
  const prompt = str(input.prompt);
  const host = hostnameOf(url) || '(no url)';
  const summary = <span class="viz-webtask__name">{host}</span>;
  const details = (
    <div class="viz-webtask__fetch">
      {url ? <div class="viz-webtask__url">{url}</div> : null}
      {prompt ? (
        <div class="viz-webtask__ask">
          <span class="viz-webtask__ask-label">ask</span>
          <span class="viz-webtask__ask-text">{prompt}</span>
        </div>
      ) : null}
      {output ? <pre class="viz-webtask__pre">{output}</pre> : null}
    </div>
  );
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- WebSearch ----------

function WebSearchVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const query = str(input.query);
  const allowed = strArr(input.allowed_domains);
  const blocked = strArr(input.blocked_domains);
  const summary = (
    <Fragment>
      <span class="viz-webtask__name">{trim(query, 60) || '(no query)'}</span>
      <span class="viz-webtask__sep">·</span>
      <span class="viz-webtask__meta">search</span>
    </Fragment>
  );
  const hasFilters = allowed.length > 0 || blocked.length > 0;
  const details = (
    <div class="viz-webtask__search">
      {hasFilters ? (
        <div class="viz-webtask__pills">
          {allowed.map((d) => (
            <span class="viz-webtask__pill viz-webtask__pill--allow" key={`a${d}`}>+{d}</span>
          ))}
          {blocked.map((d) => (
            <span class="viz-webtask__pill viz-webtask__pill--block" key={`b${d}`}>-{d}</span>
          ))}
        </div>
      ) : null}
      {output ? <pre class="viz-webtask__pre">{output}</pre> : null}
    </div>
  );
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- TodoWrite ----------

interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

function readTodo(v: unknown): Todo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const content = str(o.content);
  if (!content) return null;
  const raw = str(o.status);
  const status: Todo['status'] =
    raw === 'in_progress' || raw === 'completed' ? raw : 'pending';
  return { content, status, activeForm: str(o.activeForm) };
}

const TODO_ICON: Record<Todo['status'], string> = {
  pending: '☐',
  in_progress: '▶',
  completed: '✓',
};

function TodoWriteVisualizer({ toolName, input, state }: ToolVisualizerProps) {
  const raw = Array.isArray(input.todos) ? input.todos : [];
  const todos: Todo[] = raw.map(readTodo).filter((t): t is Todo => t !== null);
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const summary = (
    <Fragment>
      <span class="viz-webtask__meta">
        {todos.length} todo{todos.length === 1 ? '' : 's'}
      </span>
      <span class="viz-webtask__sep">·</span>
      <span class="viz-webtask__meta">{inProgress} in progress</span>
    </Fragment>
  );
  const details = todos.length > 0 ? (
    <ul class="viz-webtask__todos">
      {todos.map((t, i) => {
        const label = t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content;
        return (
          <li class={`viz-webtask__todo viz-webtask__todo--${t.status}`} key={i}>
            <span class="viz-webtask__todo-icon">{TODO_ICON[t.status]}</span>
            <span class="viz-webtask__todo-text">{label}</span>
          </li>
        );
      })}
    </ul>
  ) : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- TaskCreate ----------

function TaskCreateVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const subject = str(input.subject);
  const description = str(input.description);
  const taskN = output ? parseTaskNumber(output) : null;
  const summary = (
    <span class="viz-webtask__name">{trim(subject, 80) || '(no subject)'}</span>
  );
  const right = taskN != null ? <span class="viz-webtask__chip">#{taskN}</span> : null;
  const details = description ? (
    <pre class="viz-webtask__pre">{description}</pre>
  ) : undefined;
  return (
    <VizFrame
      toolName={toolName}
      state={state}
      summary={summary}
      rightAccessory={right}
      details={details}
    />
  );
}

// ---------- TaskUpdate ----------

const STATUS_VAR: Record<TaskStatus, string> = {
  pending: 'var(--color-text-tertiary)',
  in_progress: 'var(--color-state-working)',
  completed: 'var(--color-state-done)',
  deleted: 'var(--color-state-error)',
};

function TaskUpdateVisualizer({ toolName, input, state }: ToolVisualizerProps) {
  const taskId = num(input.taskId);
  const status = asTaskStatus(input.status);

  // Walk a fixed set of "interesting" keys so we don't list noise
  // like the taskId itself or empty arrays.
  const rows: Array<{ k: string; v: string }> = [];
  const subject = str(input.subject);
  const description = str(input.description);
  const owner = str(input.owner);
  if (subject) rows.push({ k: 'subject', v: subject });
  if (description) rows.push({ k: 'description', v: description });
  if (owner) rows.push({ k: 'owner', v: owner });
  const addBlocks = Array.isArray(input.addBlocks) ? input.addBlocks.length : 0;
  const addBlockedBy = Array.isArray(input.addBlockedBy) ? input.addBlockedBy.length : 0;
  if (addBlocks > 0) rows.push({ k: 'add blocks', v: `+${addBlocks}` });
  if (addBlockedBy > 0) rows.push({ k: 'add blocked-by', v: `+${addBlockedBy}` });

  const summary = (
    <Fragment>
      <span class="viz-webtask__name">#{taskId ?? '?'}</span>
      {status ? (
        <span
          class="viz-webtask__status-pill"
          style={{ color: STATUS_VAR[status] }}
        >
          {status}
        </span>
      ) : null}
    </Fragment>
  );
  const details = rows.length > 0 ? (
    <dl class="viz-webtask__kv">
      {rows.map((r, i) => (
        <Fragment key={i}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </Fragment>
      ))}
    </dl>
  ) : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- TaskList ----------

function TaskListVisualizer({ toolName, output, state }: ToolVisualizerProps) {
  const lines = output ? output.split('\n').filter((l) => l.length > 0).length : 0;
  const summary = (
    <Fragment>
      <span class="viz-webtask__name">task list</span>
      {lines > 0 ? <span class="viz-webtask__sep">·</span> : null}
      {lines > 0 ? <span class="viz-webtask__meta">{lines} lines</span> : null}
    </Fragment>
  );
  const details = output ? <pre class="viz-webtask__pre">{output}</pre> : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- TaskGet ----------

function TaskGetVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const taskId = num(input.taskId);
  const first = output ? output.split('\n').find((l) => l.trim().length > 0) ?? '' : '';
  const summary = (
    <Fragment>
      <span class="viz-webtask__name">#{taskId ?? '?'}</span>
      {first ? <span class="viz-webtask__sep">·</span> : null}
      {first ? <span class="viz-webtask__meta">{trim(first, 80)}</span> : null}
    </Fragment>
  );
  const details = output ? <pre class="viz-webtask__pre">{output}</pre> : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- TaskStop ----------

function TaskStopVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const taskId = num(input.taskId);
  const out = output ? trim(output, 120) : '';
  const summary = (
    <Fragment>
      <span class="viz-webtask__name">stop #{taskId ?? '?'}</span>
      {out ? <span class="viz-webtask__sep">·</span> : null}
      {out ? <span class="viz-webtask__meta">{out}</span> : null}
    </Fragment>
  );
  return <VizFrame toolName={toolName} state={state} summary={summary} />;
}

// ---------- TaskOutput ----------

function TaskOutputVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const taskId = num(input.taskId);
  const summary = <span class="viz-webtask__name">#{taskId ?? '?'} output</span>;
  const details = output
    ? <pre class="viz-webtask__pre viz-webtask__pre--terminal">{output}</pre>
    : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- registration ----------

registerToolVisualizers({
  WebFetch: WebFetchVisualizer,
  WebSearch: WebSearchVisualizer,
  TodoWrite: TodoWriteVisualizer,
  TaskCreate: TaskCreateVisualizer,
  TaskUpdate: TaskUpdateVisualizer,
  TaskList: TaskListVisualizer,
  TaskGet: TaskGetVisualizer,
  TaskStop: TaskStopVisualizer,
  TaskOutput: TaskOutputVisualizer,
});
