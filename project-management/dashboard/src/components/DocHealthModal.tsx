import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Spinner from '@atlaskit/spinner';
import Lozenge from '@atlaskit/lozenge';
import Button from '@atlaskit/button';

interface DocRef {
  id: string;
  title: string;
  days_old?: number;
}

interface HealthFindings {
  no_content: DocRef[];
  adr_no_status: DocRef[];
  adr_stale: DocRef[];
  superseded_missing_ref: DocRef[];
  orphaned: DocRef[];
}

interface HealthData {
  ok: boolean;
  total: number;
  findings: HealthFindings;
}

interface Props {
  onClose: () => void;
  onDocClick: (id: string) => void;
}

const CATEGORIES: Array<{ key: keyof HealthFindings; label: string; appearance: 'removed' | 'moved'; description: string }> = [
  { key: 'no_content',              label: 'Empty docs',            appearance: 'removed', description: 'Documents with no content' },
  { key: 'adr_no_status',           label: 'ADRs missing status',   appearance: 'moved',   description: 'ADRs with no lifecycle status set' },
  { key: 'adr_stale',               label: 'Stale ADRs (>90 days)', appearance: 'moved',   description: 'Accepted ADRs not updated in 90+ days' },
  { key: 'superseded_missing_ref',  label: 'Superseded, no ref',    appearance: 'moved',   description: 'Marked superseded but missing superseded_by reference' },
  { key: 'orphaned',                label: 'Orphaned docs',         appearance: 'removed', description: 'Child docs whose parent no longer exists' },
];

const spring = { type: 'spring' as const, damping: 28, stiffness: 260 };

export default function DocHealthModal({ onClose, onDocClick }: Props) {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/docs/health')
      .then(r => r.json() as Promise<HealthData>)
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  const totalFindings = data
    ? Object.values(data.findings).reduce((n, arr) => n + arr.length, 0)
    : 0;

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,66,0.6)', zIndex: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      >
        <motion.div
          key="modal"
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={spring}
          onClick={e => e.stopPropagation()}
          style={{
            width: 560, maxWidth: '100%', maxHeight: '80vh',
            background: 'var(--ds-surface)',
            borderRadius: 8,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--ds-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ds-text)', flex: 1 }}>
              Docs Health Report
            </span>
            {data && (
              <Lozenge appearance={totalFindings === 0 ? 'success' : 'moved'}>
                {totalFindings === 0 ? 'All clear' : `${totalFindings} findings`}
              </Lozenge>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-subtle)', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}>×</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {!data && !error && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size="medium" /></div>
            )}
            {error && (
              <p style={{ color: 'var(--ds-text-danger)', fontSize: 13 }}>Failed to load health report: {error}</p>
            )}
            {data && totalFindings === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ds-text)', marginBottom: 6 }}>All clear!</p>
                <p style={{ fontSize: 13, color: 'var(--ds-text-subtle)', margin: 0 }}>
                  {data.total} doc{data.total !== 1 ? 's' : ''} — no issues found.
                </p>
              </div>
            )}
            {data && totalFindings > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--ds-text-subtle)' }}>
                  {data.total} total docs · {totalFindings} issue{totalFindings !== 1 ? 's' : ''} found
                </p>
                {CATEGORIES.map(cat => {
                  const items = data.findings[cat.key];
                  if (items.length === 0) return null;
                  return (
                    <div key={cat.key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Lozenge appearance={cat.appearance}>{items.length}</Lozenge>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>{cat.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>{cat.description}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
                        {items.map(doc => (
                          <button
                            key={doc.id}
                            onClick={() => { onDocClick(doc.id); onClose(); }}
                            style={{
                              textAlign: 'left', cursor: 'pointer',
                              padding: '7px 10px', borderRadius: 4,
                              background: 'var(--ds-surface-raised)',
                              border: '1px solid var(--ds-border)',
                              display: 'flex', alignItems: 'center', gap: 10,
                              color: 'inherit',
                            }}
                          >
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)', flexShrink: 0 }}>{doc.id}</span>
                            <span style={{ fontSize: 13, color: 'var(--ds-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</span>
                            {doc.days_old != null && (
                              <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>{doc.days_old}d old</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--ds-border)', display: 'flex', justifyContent: 'flex-end' }}>
            <Button appearance="subtle" onClick={onClose}>Close</Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
