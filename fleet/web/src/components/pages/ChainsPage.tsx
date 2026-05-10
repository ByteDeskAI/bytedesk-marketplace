// ChainsPage — Phase 12.4 (BDM-28). Two views behind one route:
//
//   #/chains       → list of saved chains (table + Run/Edit/Delete).
//   #/chains/<id>  → DAG editor for one chain (palette/canvas/inspector).
//
// The editor maintains the chain in local state and only POSTs to
// /api/chains/<id> on Save. "Run Chain" persists the latest edits
// first, then kicks off /run and routes to the run view.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { BuilderTemplate } from '../templates/BuilderTemplate';
import { Button } from '../atoms/Button';
import { ChainCanvas, defaultConfigFor, freshNodeID, type CanvasSelection } from '../organisms/ChainCanvas';
import { NodePalette } from '../organisms/NodePalette';
import { ChainNodeInspector } from '../organisms/ChainNodeInspector';
import {
  listChains, getChain, saveChain, deleteChain, runChain,
  getChainRun, listChainRuns,
  type Chain, type ChainNode, type ChainNodeType, type ChainRunStatus,
} from '../../api';

export interface ChainsPageProps {
  chainID?: string;
}

export function ChainsPage({ chainID }: ChainsPageProps) {
  if (chainID) return <ChainEditor chainID={chainID} />;
  return <ChainList />;
}

// -----------------------------------------------------------------------
// List view
// -----------------------------------------------------------------------

function ChainList() {
  const [chains, setChains] = useState<Chain[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      setChains(await listChains());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => { reload(); }, []);

  async function onCreate() {
    const id = window.prompt('Chain id (slug-ish: a-z 0-9 - _ .):');
    if (!id) return;
    const name = window.prompt('Display name:', id) || id;
    try {
      await saveChain({ id, name, nodes: [], edges: [] });
      window.location.hash = `#/chains/${encodeURIComponent(id)}`;
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm(`Delete chain "${id}"? This cannot be undone.`)) return;
    try {
      await deleteChain(id);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function onRun(id: string) {
    try {
      await runChain(id);
      // Stay on the list; the row will show updated status next reload.
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <AppShell activeView="chains" topBarTitle="Chains">
      <div class="chain-list">
        <div class="chain-list__header">
          <h2 class="chain-list__title">Persisted chains</h2>
          <Button variant="primary" onClick={onCreate}>+ New chain</Button>
        </div>
        {err ? <div class="chain-list__err">{err}</div> : null}
        {chains == null ? (
          <div class="chain-list__empty">Loading…</div>
        ) : chains.length === 0 ? (
          <div class="chain-list__empty">
            No chains yet. Click <strong>+ New chain</strong> to compose one.
          </div>
        ) : (
          <table class="chain-list__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Nodes</th>
                <th>Updated</th>
                <th>Last run</th>
                <th class="chain-list__actions-col" />
              </tr>
            </thead>
            <tbody>
              {chains.map((c) => (
                <ChainRow key={c.id} chain={c} onDelete={onDelete} onRun={onRun} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

function ChainRow({ chain, onDelete, onRun }: { chain: Chain; onDelete: (id: string) => void; onRun: (id: string) => void }) {
  const [lastRun, setLastRun] = useState<ChainRunStatus | null>(null);
  useEffect(() => {
    let cancel = false;
    listChainRuns(chain.id).then((rs) => {
      if (!cancel && rs.length > 0) setLastRun(rs[0]);
    }).catch(() => { /* ignore */ });
    return () => { cancel = true; };
  }, [chain.id, chain.updated]);
  return (
    <tr>
      <td><a href={`#/chains/${encodeURIComponent(chain.id)}`}>{chain.name || chain.id}</a></td>
      <td><code>{chain.id}</code></td>
      <td>{chain.nodes?.length ?? 0}</td>
      <td>{chain.updated ? new Date(chain.updated).toLocaleString() : '—'}</td>
      <td>
        {lastRun ? (
          <span class={`badge badge--${lastRun.state === 'done' ? 'done' : lastRun.state === 'error' ? 'error' : 'working'}`}>
            {lastRun.state}
          </span>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </td>
      <td class="chain-list__actions">
        <Button onClick={() => onRun(chain.id)}>Run</Button>
        <Button onClick={() => { window.location.hash = `#/chains/${encodeURIComponent(chain.id)}`; }}>Edit</Button>
        <Button onClick={() => onDelete(chain.id)}>Delete</Button>
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------
// Editor view
// -----------------------------------------------------------------------

function ChainEditor({ chainID }: { chainID: string }) {
  const [chain, setChain] = useState<Chain | null>(null);
  const [selection, setSelection] = useState<CanvasSelection>({ kind: null });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [activeRunID, setActiveRunID] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<ChainRunStatus | null>(null);

  useEffect(() => {
    let cancel = false;
    getChain(chainID)
      .then((c) => {
        if (cancel) return;
        // Defensive: server may omit nodes/edges if they're null in JSON.
        setChain({ ...c, nodes: c.nodes ?? [], edges: c.edges ?? [] });
      })
      .catch((e) => {
        if (cancel) return;
        // 404 → start a fresh chain client-side and let Save persist it.
        if ((e as Error).message.toLowerCase().includes('not found')) {
          setChain({ id: chainID, name: chainID, nodes: [], edges: [] });
        } else {
          setErr((e as Error).message);
        }
      });
    return () => { cancel = true; };
  }, [chainID]);

  // Poll the active run while one is in flight.
  useEffect(() => {
    if (!activeRunID || !chain) return;
    let cancel = false;
    let timer: number | undefined;
    async function tick() {
      try {
        const r = await getChainRun(chain!.id, activeRunID!);
        if (cancel) return;
        setRunStatus(r);
        if (r.state === 'running') {
          timer = window.setTimeout(tick, 1500);
        }
      } catch {
        // run hasn't been written yet; keep polling
        if (!cancel) timer = window.setTimeout(tick, 1500);
      }
    }
    tick();
    return () => { cancel = true; if (timer) window.clearTimeout(timer); };
  }, [activeRunID, chain?.id]);

  const selectedNode = useMemo<ChainNode | null>(() => {
    if (!chain || selection.kind !== 'node' || !selection.id) return null;
    return chain.nodes.find((n) => n.id === selection.id) ?? null;
  }, [chain, selection]);

  if (!chain) {
    return (
      <AppShell activeView="chains" topBarTitle="Chain editor">
        <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-tertiary)' }}>
          {err ? <div class="chain-list__err">{err}</div> : 'Loading chain…'}
        </div>
      </AppShell>
    );
  }

  function updateChain(next: Partial<Chain>) {
    setChain((cur) => (cur ? { ...cur, ...next } : cur));
  }
  function setNodes(nodes: ChainNode[]) { updateChain({ nodes }); }
  function setEdges(edges: Chain['edges']) { updateChain({ edges }); }

  function addNodeAtCenter(type: ChainNodeType) {
    const id = freshNodeID(type, chain!.nodes);
    const newNode: ChainNode = {
      id,
      type,
      x: 80 + chain!.nodes.length * 24,
      y: 80 + chain!.nodes.length * 24,
      config: defaultConfigFor(type),
    };
    setNodes([...chain!.nodes, newNode]);
    setSelection({ kind: 'node', id });
  }

  async function persist() {
    if (!chain) return;
    setSaving(true);
    setErr(null);
    try {
      const out = await saveChain(chain);
      setChain({ ...out, nodes: out.nodes ?? [], edges: out.edges ?? [] });
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function startRun() {
    if (!chain) return;
    setRunning(true);
    setErr(null);
    try {
      // Save first so the runner sees the latest edits.
      const out = await saveChain(chain);
      setChain({ ...out, nodes: out.nodes ?? [], edges: out.edges ?? [] });
      const r = await runChain(chain.id);
      setActiveRunID(r.run_id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function deleteNode(id: string) {
    setNodes(chain!.nodes.filter((n) => n.id !== id));
    setEdges(chain!.edges.filter((e) => e.from !== id && e.to !== id));
    setSelection({ kind: null });
  }

  const selectedEdgeIdx = selection.kind === 'edge' ? selection.edgeIdx : undefined;

  return (
    <AppShell activeView="chains" topBarTitle={`Chain: ${chain.name || chain.id}`}>
      <BuilderTemplate
        toolbar={
          <>
            <a href="#/chains" class="chain-builder__back">← All chains</a>
            <input
              class="chain-builder__name"
              type="text"
              value={chain.name}
              placeholder="Chain name"
              onInput={(e) => updateChain({ name: (e.currentTarget as HTMLInputElement).value })}
            />
            <span class="chain-builder__id">id: <code>{chain.id}</code></span>
            <span style={{ flex: 1 }} />
            {savedAt ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-state-done)' }}>Saved.</span>
            ) : null}
            {err ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-state-error)' }}>{err}</span>
            ) : null}
            <Button onClick={persist} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button variant="primary" onClick={startRun} disabled={running}>
              {running ? 'Starting…' : 'Run Chain'}
            </Button>
          </>
        }
        palette={<NodePalette onAdd={addNodeAtCenter} />}
        canvas={
          <ChainCanvas
            nodes={chain.nodes}
            edges={chain.edges}
            selection={selection}
            onChange={({ nodes, edges }) => updateChain({ nodes, edges })}
            onSelect={setSelection}
          />
        }
        inspector={
          selection.kind === 'edge' && typeof selectedEdgeIdx === 'number' ? (
            <EdgeInspector
              edge={chain.edges[selectedEdgeIdx]}
              onChange={(next) => {
                const copy = chain.edges.slice();
                copy[selectedEdgeIdx!] = next;
                setEdges(copy);
              }}
              onDelete={() => {
                setEdges(chain.edges.filter((_, i) => i !== selectedEdgeIdx));
                setSelection({ kind: null });
              }}
            />
          ) : (
            <ChainNodeInspector
              node={selectedNode}
              onChange={(next) => setNodes(chain.nodes.map((n) => (n.id === next.id ? next : n)))}
              onDelete={deleteNode}
            />
          )
        }
      />
      {runStatus ? <RunStatusBar run={runStatus} /> : null}
    </AppShell>
  );
}

function EdgeInspector({
  edge, onChange, onDelete,
}: {
  edge: { from: string; to: string; on_success?: boolean; on_failure?: boolean };
  onChange: (next: { from: string; to: string; on_success?: boolean; on_failure?: boolean }) => void;
  onDelete: () => void;
}) {
  return (
    <aside class="chain-inspector" aria-label="Edge inspector">
      <header class="chain-inspector__header">
        <div class="chain-inspector__type">edge</div>
        <div class="chain-inspector__id">{edge.from} → {edge.to}</div>
      </header>
      <div class="chain-inspector__body">
        <p class="chain-inspector__note">
          Branch labels apply when the source is a <code>condition</code> node.
        </p>
        <label class="chain-inspector__check">
          <input
            type="checkbox"
            checked={!!edge.on_success}
            onChange={(e) => onChange({ ...edge, on_success: (e.currentTarget as HTMLInputElement).checked, on_failure: false })}
          />
          <span>on_success</span>
        </label>
        <label class="chain-inspector__check">
          <input
            type="checkbox"
            checked={!!edge.on_failure}
            onChange={(e) => onChange({ ...edge, on_failure: (e.currentTarget as HTMLInputElement).checked, on_success: false })}
          />
          <span>on_failure</span>
        </label>
      </div>
      <div class="chain-inspector__footer">
        <button type="button" class="btn" onClick={onDelete}>Delete edge</button>
      </div>
    </aside>
  );
}

function RunStatusBar({ run }: { run: ChainRunStatus }) {
  const counts = { pending: 0, running: 0, done: 0, error: 0, skipped: 0 };
  for (const id of Object.keys(run.nodes)) {
    const k = run.nodes[id].status;
    if (k in counts) (counts as Record<string, number>)[k] += 1;
  }
  return (
    <div class="chain-run-bar">
      <span class={`badge badge--${run.state === 'done' ? 'done' : run.state === 'error' ? 'error' : 'working'}`}>
        run {run.state}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{run.run_id}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
        done {counts.done} · running {counts.running} · pending {counts.pending} · skipped {counts.skipped} · error {counts.error}
      </span>
      {run.error ? (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-state-error)' }}>{run.error}</span>
      ) : null}
    </div>
  );
}
