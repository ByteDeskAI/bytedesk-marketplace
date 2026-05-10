// fileVisualizers.tsx — visualizers for Claude Code's file-touching
// tool family: Read / Write / Edit / MultiEdit / NotebookRead /
// NotebookEdit. Side-effecting module — registers itself on import.
// Owns the `.viz-file*` CSS class namespace; styles live in
// styles.css under the BDM-34 block. (See registry.ts for the
// dispatch contract.)
//
// Design notes:
// - For Read, output arrives in `cat -n` format (`<n>\t<line>\n`); we
//   parse it cheaply for a line-numbered gutter view. If a line lacks
//   the tab, we render it as-is (Read may stream prose for some
//   non-code formats — pdfs/notebooks).
// - For Write, the tool result is canned boilerplate; we suppress it
//   and show the input content as the body so the diff-with-disk is
//   what the user actually scans.
// - For Edit/MultiEdit we don't run a real diff — line-by-line
//   alignment via `\n` splits is good enough for a chat card; a real
//   diff would balloon the bundle.

import { Fragment } from 'preact';
import { registerToolVisualizers, type ToolVisualizerProps } from './registry';
import { VizFrame, trim } from './shared';

// ---------- helpers ----------

function basename(p: string): string {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function bool(v: unknown): boolean {
  return v === true;
}

interface ParsedLine {
  n: number | null;
  text: string;
}

/** Parse `cat -n`-style output into structured rows. Tolerant of
 *  lines that lack the leading `<n>\t` (e.g. pdf prose). */
function parseCatN(output: string): ParsedLine[] {
  if (!output) return [];
  const lines = output.split('\n');
  const out: ParsedLine[] = [];
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab > 0) {
      const head = line.slice(0, tab).trim();
      const n = /^\d+$/.test(head) ? Number(head) : null;
      out.push({ n, text: line.slice(tab + 1) });
    } else {
      out.push({ n: null, text: line });
    }
  }
  // Trailing empty line from final \n: drop one.
  if (out.length > 0 && out[out.length - 1].text === '' && out[out.length - 1].n == null) {
    out.pop();
  }
  return out;
}

// ---------- Read ----------

function ReadVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const filePath = str(input.file_path);
  const name = basename(filePath) || trim(filePath, 60) || '(no path)';
  const rows = state === 'done' && output ? parseCatN(output) : [];
  const summary = (
    <Fragment>
      <span class="viz-file__name">{name}</span>
      {rows.length > 0 ? (
        <span class="viz-file__meta">{rows.length} lines</span>
      ) : null}
    </Fragment>
  );
  const details = rows.length > 0 ? (
    <div class="viz-file__pre">
      {rows.map((r, i) => (
        <div class="viz-file__row" key={i}>
          <span class="viz-file__gutter">{r.n ?? ''}</span>
          <span class="viz-file__line">{r.text}</span>
        </div>
      ))}
    </div>
  ) : (output ? <pre class="viz-file__plain">{output}</pre> : undefined);
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- Write ----------

function WriteVisualizer({ toolName, input, state }: ToolVisualizerProps) {
  const filePath = str(input.file_path);
  const content = str(input.content);
  const name = basename(filePath) || '(no path)';
  const lineCount = content ? content.split('\n').length : 0;
  const summary = (
    <Fragment>
      <span class="viz-file__verb">wrote</span>
      <span class="viz-file__meta">{lineCount} line{lineCount === 1 ? '' : 's'}</span>
      <span class="viz-file__sep">to</span>
      <span class="viz-file__name">{name}</span>
    </Fragment>
  );
  const details = content ? <pre class="viz-file__plain">{content}</pre> : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- Edit ----------

interface EditPair {
  oldStr: string;
  newStr: string;
  replaceAll: boolean;
}

function readEdit(v: unknown): EditPair {
  const o = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
  return {
    oldStr: str(o.old_string),
    newStr: str(o.new_string),
    replaceAll: bool(o.replace_all),
  };
}

function DiffBlock({ pair }: { pair: EditPair }) {
  const oldLines = pair.oldStr.split('\n');
  const newLines = pair.newStr.split('\n');
  return (
    <div class="viz-file__diff">
      {oldLines.map((l, i) => (
        <div class="viz-file__diff-row viz-file__diff-row--del" key={`o${i}`}>
          <span class="viz-file__diff-mark">-</span>
          <span class="viz-file__line">{l}</span>
        </div>
      ))}
      {newLines.map((l, i) => (
        <div class="viz-file__diff-row viz-file__diff-row--add" key={`n${i}`}>
          <span class="viz-file__diff-mark">+</span>
          <span class="viz-file__line">{l}</span>
        </div>
      ))}
    </div>
  );
}

function EditVisualizer({ toolName, input, state }: ToolVisualizerProps) {
  const filePath = str(input.file_path);
  const name = basename(filePath) || '(no path)';
  const pair = readEdit({
    old_string: input.old_string,
    new_string: input.new_string,
    replace_all: input.replace_all,
  });
  const summary = (
    <Fragment>
      <span class="viz-file__name">{name}</span>
      <span class="viz-file__verb">edit</span>
    </Fragment>
  );
  const right = pair.replaceAll ? <span class="viz-file__pill">all</span> : null;
  return (
    <VizFrame
      toolName={toolName}
      state={state}
      summary={summary}
      rightAccessory={right}
      details={<DiffBlock pair={pair} />}
    />
  );
}

// ---------- MultiEdit ----------

function MultiEditVisualizer({ toolName, input, state }: ToolVisualizerProps) {
  const filePath = str(input.file_path);
  const name = basename(filePath) || '(no path)';
  const editsRaw = Array.isArray(input.edits) ? input.edits : [];
  const edits = editsRaw.map(readEdit);
  const summary = (
    <Fragment>
      <span class="viz-file__name">{name}</span>
      <span class="viz-file__sep">·</span>
      <span class="viz-file__meta">{edits.length} edit{edits.length === 1 ? '' : 's'}</span>
    </Fragment>
  );
  const details = edits.length > 0 ? (
    <div class="viz-file__multi">
      {edits.map((p, i) => (
        <div class="viz-file__multi-item" key={i}>
          <div class="viz-file__multi-divider">
            <span class="viz-file__multi-idx">edit {i + 1}</span>
            {p.replaceAll ? <span class="viz-file__pill">all</span> : null}
          </div>
          <DiffBlock pair={p} />
        </div>
      ))}
    </div>
  ) : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- NotebookEdit ----------

function NotebookEditVisualizer({ toolName, input, state }: ToolVisualizerProps) {
  const path = str(input.notebook_path);
  const cellId = str(input.cell_id);
  const newSource = str(input.new_source);
  const editMode = str(input.edit_mode);
  const cellType = str(input.cell_type) || 'code';
  const name = basename(path) || '(no notebook)';
  const cellLabel = cellId || (editMode === 'insert' ? 'new' : 'new');
  const summary = (
    <Fragment>
      <span class="viz-file__name">{name}</span>
      <span class="viz-file__sep">·</span>
      <span class="viz-file__meta">cell {cellLabel}</span>
      {editMode ? <span class="viz-file__pill">{editMode}</span> : null}
    </Fragment>
  );
  const details = (
    <div class="viz-file__nb">
      <div class="viz-file__nb-label">{cellType}</div>
      <pre class="viz-file__plain">{newSource}</pre>
    </div>
  );
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- NotebookRead ----------

function NotebookReadVisualizer({ toolName, input, output, state }: ToolVisualizerProps) {
  const path = str(input.notebook_path);
  const name = basename(path) || '(no notebook)';
  const summary = <span class="viz-file__name">{name}</span>;
  const details = output ? <pre class="viz-file__plain">{output}</pre> : undefined;
  return <VizFrame toolName={toolName} state={state} summary={summary} details={details} />;
}

// ---------- registration ----------

registerToolVisualizers({
  Read: ReadVisualizer,
  Write: WriteVisualizer,
  Edit: EditVisualizer,
  MultiEdit: MultiEditVisualizer,
  NotebookEdit: NotebookEditVisualizer,
  NotebookRead: NotebookReadVisualizer,
});
