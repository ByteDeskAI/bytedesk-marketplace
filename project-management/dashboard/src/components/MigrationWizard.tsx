import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import Lozenge from '@atlaskit/lozenge';
import SectionMessage from '@atlaskit/section-message';
import Toggle from '@atlaskit/toggle';

interface MigrationPath {
  direction: string;
  label: string;
  description: string;
  source: string;
  target: string;
}

interface MigrateStatus {
  ok: boolean;
  current_backend: 'sqlite' | 'jsonl' | 'both' | 'none';
  counts: { issues: number; docs: number; sprints: number };
  paths: MigrationPath[];
  pm_root: string;
}

interface MigrateResult {
  ok: boolean;
  verified: boolean;
  pre_counts: { issues: number; docs: number; sprints: number };
  post_counts: { issues: number; docs: number; sprints: number };
  missing_issues: string[];
  missing_docs: string[];
  source_deleted: boolean;
  direction: string;
  error?: string;
}

type Step = 'detect' | 'confirm' | 'migrating' | 'result';

const spring = { type: 'spring' as const, damping: 30, stiffness: 280 };

const BACKEND_LABEL: Record<string, string> = {
  sqlite: 'SQLite (pm.db)',
  jsonl: 'JSONL (text files)',
  both: 'Both present',
  none: 'Not initialized',
};

const BACKEND_APPEARANCE: Record<string, 'inprogress' | 'moved' | 'default' | 'removed'> = {
  sqlite: 'moved',
  jsonl: 'inprogress',
  both: 'removed',
  none: 'default',
};

function CountRow({ label, pre, post, ok }: { label: string; pre: number; post: number; ok: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px',
      alignItems: 'center', gap: 12,
      padding: '8px 0', borderBottom: '1px solid var(--ds-border)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--ds-text-subtle)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--ds-text)', textAlign: 'right' }}>{pre}</span>
      <span style={{ fontSize: 13, color: 'var(--ds-text)', textAlign: 'right' }}>{post}</span>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {ok
          ? <Lozenge appearance="success">✓ Match</Lozenge>
          : <Lozenge appearance="removed">✗ Mismatch</Lozenge>}
      </div>
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export default function MigrationWizard({ onClose }: Props) {
  const [step, setStep] = useState<Step>('detect');
  const [status, setStatus] = useState<MigrateStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<MigrationPath | null>(null);
  const [keepSource, setKeepSource] = useState(false);
  const [result, setResult] = useState<MigrateResult | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch('/api/migrate/status');
      const data = await r.json() as MigrateStatus;
      setStatus(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Network error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runMigration = async () => {
    if (!selectedPath) return;
    setStep('migrating');
    try {
      const r = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: selectedPath.direction, keep_source: keepSource }),
      });
      const data = await r.json() as MigrateResult;
      setResult(data);
      setStep('result');
    } catch (e) {
      setResult({ ok: false, verified: false, pre_counts: { issues: 0, docs: 0, sprints: 0 }, post_counts: { issues: 0, docs: 0, sprints: 0 }, missing_issues: [], missing_docs: [], source_deleted: false, direction: selectedPath.direction, error: e instanceof Error ? e.message : 'Network error' });
      setStep('result');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,66,0.6)', zIndex: 600 }}
      />
      <motion.div
        key="wizard"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={spring}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 540, maxWidth: 'calc(100vw - 32px)',
          background: 'var(--ds-surface)',
          borderRadius: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          zIndex: 601,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--ds-border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ds-text)', flex: 1 }}>
            Migrate Data Store
          </span>
          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['detect', 'confirm', 'migrating', 'result'] as Step[]).map((s, i) => (
              <div key={s} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: step === s
                  ? 'var(--ds-background-brand-bold)'
                  : i < (['detect', 'confirm', 'migrating', 'result'] as Step[]).indexOf(step)
                    ? 'var(--ds-background-success-bold)'
                    : 'var(--ds-border-bold)',
                transition: 'background 0.2s',
              }} />
            ))}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-subtle)', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', minHeight: 240 }}>
          <AnimatePresence mode="wait">

            {/* ── Step 1: Detect ── */}
            {step === 'detect' && (
              <motion.div key="detect" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ds-text-subtle)', lineHeight: 1.6 }}>
                  Migrate your project data between storage backends. The source is preserved until post-migration verification passes.
                </p>

                {loadError && (
                  <SectionMessage appearance="error" title="Could not load status">
                    <p style={{ margin: 0 }}>{loadError}</p>
                  </SectionMessage>
                )}

                {!status && !loadError && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                    <Spinner size="medium" />
                  </div>
                )}

                {status && (
                  <>
                    {/* Current backend */}
                    <div style={{
                      padding: '12px 14px', borderRadius: 6,
                      background: 'var(--ds-surface-raised)',
                      border: '1px solid var(--ds-border)',
                      marginBottom: 16,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Current Backend</span>
                        <Lozenge appearance={BACKEND_APPEARANCE[status.current_backend]}>
                          {BACKEND_LABEL[status.current_backend]}
                        </Lozenge>
                      </div>
                      <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--ds-text)' }}>
                        <span><strong>{status.counts.issues}</strong> issues</span>
                        <span><strong>{status.counts.docs}</strong> docs</span>
                        <span><strong>{status.counts.sprints}</strong> sprints</span>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ds-text-subtlest)', fontFamily: 'monospace' }}>
                        {status.pm_root}
                      </div>
                    </div>

                    {/* Migration paths */}
                    {status.paths.length === 0 ? (
                      <SectionMessage appearance="information" title="No migration paths available">
                        <p style={{ margin: 0 }}>Only one backend is present. Initialize or add another backend to enable migration.</p>
                      </SectionMessage>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Available Paths</span>
                        {status.paths.map(path => (
                          <button
                            key={path.direction}
                            onClick={() => { setSelectedPath(path); setStep('confirm'); }}
                            style={{
                              textAlign: 'left', cursor: 'pointer',
                              padding: '12px 14px', borderRadius: 6,
                              background: selectedPath?.direction === path.direction ? 'var(--ds-background-selected)' : 'var(--ds-surface-raised)',
                              border: `1px solid ${selectedPath?.direction === path.direction ? 'var(--ds-border-selected)' : 'var(--ds-border)'}`,
                              color: 'inherit',
                              transition: 'border-color 0.15s, background 0.15s',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ds-text)', marginBottom: 4 }}>
                              {path.label}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--ds-text-subtle)', lineHeight: 1.5 }}>
                              {path.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* ── Step 2: Confirm ── */}
            {step === 'confirm' && selectedPath && status && (
              <motion.div key="confirm" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
                <div style={{
                  padding: '12px 14px', borderRadius: 6,
                  background: 'var(--ds-surface-raised)', border: '1px solid var(--ds-border)',
                  marginBottom: 16,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ds-text)', marginBottom: 6 }}>
                    {selectedPath.label}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ds-text-subtle)', lineHeight: 1.6, marginBottom: 12 }}>
                    {selectedPath.description}
                  </div>
                  <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--ds-text)' }}>
                    <span><strong>{status.counts.issues}</strong> issues</span>
                    <span><strong>{status.counts.docs}</strong> docs</span>
                    <span><strong>{status.counts.sprints}</strong> sprints</span>
                  </div>
                </div>

                <SectionMessage appearance="warning" title="What will happen">
                  <p style={{ margin: 0, lineHeight: 1.6 }}>
                    1. All data is copied to the new backend.<br />
                    2. Record counts and IDs are verified for exact match.<br />
                    3. <strong>If verification passes</strong> and Keep Source is off, the source is deleted.<br />
                    4. If verification fails, the source is untouched and an error is shown.
                  </p>
                </SectionMessage>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, cursor: 'pointer' }}>
                  <Toggle
                    id="keep-source"
                    isChecked={keepSource}
                    onChange={e => setKeepSource((e.target as HTMLInputElement).checked)}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>Keep source after migration</div>
                    <div style={{ fontSize: 12, color: 'var(--ds-text-subtle)' }}>
                      Leave original {selectedPath.source === 'sqlite' ? 'pm.db' : 'JSONL files'} in place as a backup
                    </div>
                  </div>
                </label>
              </motion.div>
            )}

            {/* ── Step 3: Migrating ── */}
            {step === 'migrating' && (
              <motion.div key="migrating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 20 }}>
                <Spinner size="large" />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ds-text)', marginBottom: 6 }}>
                    Migrating…
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ds-text-subtle)' }}>
                    Copying data and verifying record counts
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Step 4: Result ── */}
            {step === 'result' && result && (
              <motion.div key="result" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                {result.ok && result.verified ? (
                  <SectionMessage appearance="success" title="Migration complete — all records verified">
                    <p style={{ margin: 0 }}>
                      {result.source_deleted
                        ? 'Source data has been removed.'
                        : 'Source data was kept (Keep Source was enabled).'}
                    </p>
                  </SectionMessage>
                ) : result.ok && !result.verified ? (
                  <SectionMessage appearance="error" title="Verification failed — source preserved">
                    <p style={{ margin: 0 }}>
                      Record counts or IDs did not match. The source has NOT been deleted.
                      {result.missing_issues.length > 0 && ` Missing issues: ${result.missing_issues.join(', ')}.`}
                      {result.missing_docs.length > 0 && ` Missing docs: ${result.missing_docs.join(', ')}.`}
                    </p>
                  </SectionMessage>
                ) : (
                  <SectionMessage appearance="error" title="Migration failed">
                    <p style={{ margin: 0 }}>{result.error ?? 'Unknown error. Source data is untouched.'}</p>
                  </SectionMessage>
                )}

                {/* Verification table */}
                {result.ok && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px',
                      gap: 12, padding: '6px 0',
                      fontSize: 11, fontWeight: 600, color: 'var(--ds-text-subtle)',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      borderBottom: '2px solid var(--ds-border-bold)',
                    }}>
                      <span>Collection</span>
                      <span style={{ textAlign: 'right' }}>Before</span>
                      <span style={{ textAlign: 'right' }}>After</span>
                      <span style={{ textAlign: 'right' }}>Status</span>
                    </div>
                    <CountRow label="Issues" pre={result.pre_counts.issues} post={result.post_counts.issues} ok={result.pre_counts.issues === result.post_counts.issues} />
                    <CountRow label="Docs" pre={result.pre_counts.docs} post={result.post_counts.docs} ok={result.pre_counts.docs === result.post_counts.docs} />
                    <CountRow label="Sprints" pre={result.pre_counts.sprints} post={result.post_counts.sprints} ok={result.pre_counts.sprints === result.post_counts.sprints} />
                  </div>
                )}

                {result.ok && result.verified && (
                  <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ds-text-subtle)' }}>
                    Reload the dashboard to use the new backend.
                  </p>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--ds-border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          {step === 'detect' && (
            <Button appearance="subtle" onClick={onClose}>Cancel</Button>
          )}
          {step === 'confirm' && (
            <>
              <Button appearance="subtle" onClick={() => setStep('detect')}>Back</Button>
              <Button appearance="primary" onClick={runMigration}>
                Migrate {keepSource ? '(keep source)' : ''}
              </Button>
            </>
          )}
          {step === 'result' && (
            <>
              {result?.ok && result.verified && (
                <Button appearance="primary" onClick={() => window.location.reload()}>
                  Reload dashboard
                </Button>
              )}
              <Button appearance="subtle" onClick={onClose}>Close</Button>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
