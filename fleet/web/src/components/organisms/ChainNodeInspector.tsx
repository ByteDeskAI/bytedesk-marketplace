// ChainNodeInspector — Phase 12.4 (BDM-28). Right panel that renders
// a per-node-type form for the selected node. Form changes call
// `onChange(node)` on every keystroke; the parent owns the chain
// state and persists on Save.
//
// Variable substitution hint: any string field can reference an
// upstream node's outputs as `${<node-id>.<key>}` (e.g. for a Wait
// node's ticket: `${spawn-1.ticket}`). The runner does the expansion
// at execution time.

import type { ChainNode } from '../../api';

const STATE_OPTIONS = [
  'starting', 'working', 'needs-input', 'reviewing', 'done', 'completed', 'idle', 'error', 'blocked',
];

export interface ChainNodeInspectorProps {
  node: ChainNode | null;
  onChange: (next: ChainNode) => void;
  onDelete?: (id: string) => void;
}

export function ChainNodeInspector({ node, onChange, onDelete }: ChainNodeInspectorProps) {
  if (!node) {
    return (
      <aside class="chain-inspector chain-inspector--empty" aria-label="Inspector">
        <div class="chain-inspector__placeholder">
          &gt; NO NODE SELECTED
          <div style={{ marginTop: 'var(--space-2)', textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--color-text-tertiary)' }}>
            Select a node on the canvas to edit its config.
          </div>
        </div>
      </aside>
    );
  }
  const setCfg = (k: string, v: unknown) => onChange({ ...node, config: { ...node.config, [k]: v } });
  return (
    <aside class="chain-inspector" aria-label="Inspector">
      <header class="chain-inspector__header">
        <div class="chain-inspector__type">&gt; {node.type}</div>
        <div class="chain-inspector__id">{node.id}</div>
      </header>
      <div class="chain-inspector__body">
        {node.type === 'spawn' ? <SpawnFields node={node} setCfg={setCfg} /> : null}
        {node.type === 'wait' ? <WaitFields node={node} setCfg={setCfg} /> : null}
        {node.type === 'judge' ? <JudgeFields node={node} setCfg={setCfg} /> : null}
        {node.type === 'condition' ? <ConditionFields node={node} setCfg={setCfg} /> : null}
        {node.type === 'notify' ? <NotifyFields node={node} setCfg={setCfg} /> : null}
        {node.type === 'script' ? <ScriptFields node={node} setCfg={setCfg} /> : null}
      </div>
      {onDelete ? (
        <div class="chain-inspector__footer">
          <button type="button" class="btn btn--danger" onClick={() => onDelete(node.id)}>DELETE NODE</button>
        </div>
      ) : null}
    </aside>
  );
}

type SetCfg = (k: string, v: unknown) => void;

function Field({ label, hint, children }: { label: string; hint?: string; children: preact.ComponentChildren }) {
  return (
    <label class="chain-inspector__field">
      <span class="chain-inspector__label">{label}</span>
      {children}
      {hint ? <span class="chain-inspector__hint">{hint}</span> : null}
    </label>
  );
}

function getStr(node: ChainNode, k: string): string {
  const v = node.config[k];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function getBool(node: ChainNode, k: string): boolean {
  const v = node.config[k];
  return v === true || v === 'true' || v === 1;
}
function getNum(node: ChainNode, k: string): number | '' {
  const v = node.config[k];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') return Number(v);
  return '';
}

function SpawnFields({ node, setCfg }: { node: ChainNode; setCfg: SetCfg }) {
  return (
    <>
      <Field label="Ticket" hint="e.g. BDM-99">
        <input
          class="chain-inspector__input"
          type="text"
          placeholder="BDM-99"
          value={getStr(node, 'ticket')}
          onInput={(e) => setCfg('ticket', (e.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Slug">
        <input
          class="chain-inspector__input"
          type="text"
          placeholder="fix-foo"
          value={getStr(node, 'slug')}
          onInput={(e) => setCfg('slug', (e.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Prompt">
        <textarea
          class="chain-inspector__textarea"
          rows={6}
          placeholder="What should the agent do?"
          value={getStr(node, 'prompt')}
          onInput={(e) => setCfg('prompt', (e.currentTarget as HTMLTextAreaElement).value)}
        />
      </Field>
      <Field label="Parent (optional)" hint="Reference an upstream Spawn node: ${spawn-1.ticket}">
        <input
          class="chain-inspector__input"
          type="text"
          placeholder="${spawn-1.ticket}"
          value={getStr(node, 'parent')}
          onInput={(e) => setCfg('parent', (e.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <label class="chain-inspector__check">
        <input
          type="checkbox"
          checked={getBool(node, 'full_auto')}
          onChange={(e) => setCfg('full_auto', (e.currentTarget as HTMLInputElement).checked)}
        />
        <span>--full-auto</span>
      </label>
      <Field label="Max depth (optional)">
        <input
          class="chain-inspector__input"
          type="number"
          min={0}
          max={5}
          value={getNum(node, 'max_depth')}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            setCfg('max_depth', v ? Number(v) : undefined);
          }}
        />
      </Field>
    </>
  );
}

function WaitFields({ node, setCfg }: { node: ChainNode; setCfg: SetCfg }) {
  return (
    <>
      <Field label="Ticket" hint="Variable from upstream Spawn: ${spawn-1.ticket}">
        <input
          class="chain-inspector__input"
          type="text"
          placeholder="${spawn-1.ticket}"
          value={getStr(node, 'ticket')}
          onInput={(e) => setCfg('ticket', (e.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <Field label="State">
        <select
          class="chain-inspector__input"
          value={getStr(node, 'state') || 'done'}
          onChange={(e) => setCfg('state', (e.currentTarget as HTMLSelectElement).value)}
        >
          {STATE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Timeout (seconds)" hint="Default 600 (10 minutes).">
        <input
          class="chain-inspector__input"
          type="number"
          min={1}
          value={getNum(node, 'timeout')}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            setCfg('timeout', v ? Number(v) : undefined);
          }}
        />
      </Field>
    </>
  );
}

function JudgeFields({ node, setCfg }: { node: ChainNode; setCfg: SetCfg }) {
  return (
    <>
      <Field label="Prompt to grade against" hint="Stub today; Haiku judge wiring lands in 12.9.">
        <textarea
          class="chain-inspector__textarea"
          rows={6}
          placeholder="The agent's output should…"
          value={getStr(node, 'prompt')}
          onInput={(e) => setCfg('prompt', (e.currentTarget as HTMLTextAreaElement).value)}
        />
      </Field>
    </>
  );
}

function ConditionFields({ node, setCfg }: { node: ChainNode; setCfg: SetCfg }) {
  return (
    <>
      <Field label="Expression" hint='Equality test, e.g. ${wait-1.state} == "done"'>
        <input
          class="chain-inspector__input"
          type="text"
          placeholder='${wait-1.state} == "done"'
          value={getStr(node, 'expr')}
          onInput={(e) => setCfg('expr', (e.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <p class="chain-inspector__note">
        Outgoing edges marked <code>on_success</code> run when the expression is true;
        <code>on_failure</code> edges run when it's false. (Toggle on the edge after creating it.)
      </p>
    </>
  );
}

function NotifyFields({ node, setCfg }: { node: ChainNode; setCfg: SetCfg }) {
  return (
    <>
      <Field label="Message">
        <textarea
          class="chain-inspector__textarea"
          rows={4}
          placeholder="Pipeline complete!"
          value={getStr(node, 'message')}
          onInput={(e) => setCfg('message', (e.currentTarget as HTMLTextAreaElement).value)}
        />
      </Field>
    </>
  );
}

function ScriptFields({ node, setCfg }: { node: ChainNode; setCfg: SetCfg }) {
  return (
    <>
      <Field label="Description (optional)">
        <input
          class="chain-inspector__input"
          type="text"
          placeholder="What does this script do?"
          value={getStr(node, 'description')}
          onInput={(e) => setCfg('description', (e.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <Field label="Bash command" hint="Only runs when the chain is started by a depth-0 user.">
        <textarea
          class="chain-inspector__textarea"
          rows={6}
          placeholder='echo "done"'
          value={getStr(node, 'cmd')}
          onInput={(e) => setCfg('cmd', (e.currentTarget as HTMLTextAreaElement).value)}
        />
      </Field>
    </>
  );
}
