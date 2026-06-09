import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import Button from '@atlaskit/button';

interface ChangelogSection { heading: string; items: string[] }
interface ChangelogEntry  { version: string; date: string; sections: ChangelogSection[] }

const spring = { type: 'spring' as const, damping: 28, stiffness: 260 };

const SECTION_APPEARANCE: Record<string, 'success' | 'inprogress' | 'moved' | 'removed' | 'default'> = {
  Added:   'success',
  Changed: 'inprogress',
  Fixed:   'moved',
  Removed: 'removed',
};

export default function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/changelog')
      .then(r => r.json() as Promise<{ ok: boolean; entries: ChangelogEntry[]; error?: string }>)
      .then(body => {
        if (!body.ok) throw new Error(body.error ?? 'Failed to load changelog');
        setEntries(body.entries);
        if (body.entries.length > 0) setExpanded(new Set([body.entries[0].version]));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(v: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  }

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
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={spring}
          onClick={e => e.stopPropagation()}
          style={{
            width: 600, maxWidth: '100%', maxHeight: '80vh',
            background: 'var(--ds-surface)', borderRadius: 8,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--ds-border)',
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ds-text)' }}>
                What's New
              </h2>
              {!loading && entries.length > 0 && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
                  {entries.length} release{entries.length !== 1 ? 's' : ''} · latest: v{entries[0]?.version}
                </p>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--ds-text-subtle)', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Spinner size="medium" />
              </div>
            )}
            {error && (
              <p style={{ padding: '20px', fontSize: 13, color: 'var(--ds-text-danger)' }}>{error}</p>
            )}
            {!loading && !error && entries.map((entry, i) => {
              const isLatest = i === 0;
              const isOpen = expanded.has(entry.version);
              return (
                <div key={entry.version} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                  <button
                    onClick={() => toggle(entry.version)}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
                      gap: 10, padding: '10px 20px',
                      background: isOpen ? 'var(--ds-surface-raised)' : 'transparent',
                      border: 'none', cursor: 'pointer', color: 'inherit', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'var(--ds-background-neutral-hovered)'; }}
                    onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--ds-text-subtlest)',
                      transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block',
                      transition: 'transform 0.15s', flexShrink: 0 }}>▶</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--ds-text)' }}>
                      v{entry.version}
                    </span>
                    {isLatest && <Lozenge appearance="new" isBold>Latest</Lozenge>}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>
                      {entry.date}
                    </span>
                    {!isOpen && entry.sections.length > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>
                        {entry.sections.reduce((n, s) => n + s.items.length, 0)} changes
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}
                      style={{ padding: '4px 20px 16px 40px' }}
                    >
                      {entry.sections.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--ds-text-subtlest)', margin: '8px 0 0' }}>
                          No details for this release.
                        </p>
                      ) : entry.sections.map((section, si) => (
                        <div key={si} style={{ marginTop: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <Lozenge appearance={SECTION_APPEARANCE[section.heading] ?? 'default'}>
                              {section.heading}
                            </Lozenge>
                          </div>
                          <ul style={{ margin: 0, padding: '0 0 0 16px',
                            display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {section.items.map((item, ii) => (
                              <li key={ii} style={{ fontSize: 13, lineHeight: 1.55,
                                color: item.startsWith('**') ? 'var(--ds-text)' : 'var(--ds-text-subtle)',
                                fontWeight: item.startsWith('**') ? 600 : 400 }}>
                                {item.replace(/^\*\*(.+)\*\*$/, '$1')}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--ds-border)',
            display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
            <Button appearance="subtle" onClick={onClose}>Close</Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
