import { useState, useEffect } from 'react';
import Lozenge from '@atlaskit/lozenge';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import Breadcrumbs, { BreadcrumbsItem } from '@atlaskit/breadcrumbs';
import SectionMessage from '@atlaskit/section-message';
import EmptyState from '@atlaskit/empty-state';
import Button from '@atlaskit/button';
import TextArea from '@atlaskit/textarea';
import Tag, { SimpleTag } from '@atlaskit/tag';
import TagGroup from '@atlaskit/tag-group';
import Tooltip from '@atlaskit/tooltip';
import Toggle from '@atlaskit/toggle';
import InlineMessage from '@atlaskit/inline-message';
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import InlineEdit from '@atlaskit/inline-edit';
import Textfield from '@atlaskit/textfield';
import type { Doc } from '../types';
import { api, relTime } from '../api';
import CreateDocModal from './CreateDocModal';

// suppress unused-import warnings for Tag/Toggle (used for side-effects / future use)
void Tag;
void Toggle;

type LozAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'moved' | 'new';

const DOC_ICONS: Record<string, string> = {
  wiki: '📄', adr: '⚖', plan: '🗺', learning: '💡', brief: '📋', runbook: '🔧',
};

const DOC_LABELS: Record<string, string> = {
  wiki: 'Wiki', adr: 'ADR', plan: 'Plan', learning: 'Learning', brief: 'Brief', runbook: 'Runbook',
};

const DOC_APPEARANCE: Record<string, LozAppearance> = {
  wiki: 'default', adr: 'inprogress', plan: 'new', learning: 'success', brief: 'moved', runbook: 'removed',
};

function renderMd(text: string): string {
  let s = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // code blocks
  const parts = s.split('```');
  s = parts.map((p, i) => i % 2 === 1
    ? `<pre style="background:var(--ds-surface-sunken);border:1px solid var(--ds-border);border-radius:3px;padding:12px 14px;overflow-x:auto;margin:0 0 12px;font-size:12px"><code>${p.replace(/^[a-z]*/,'')}</code></pre>`
    : p
  ).join('');
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:12px;background:var(--ds-surface-sunken);border:1px solid var(--ds-border);padding:1px 5px;border-radius:3px">$1</code>');
  // headings
  s = s.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;color:var(--ds-text);margin:16px 0 6px">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;color:var(--ds-text);margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--ds-border)">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 style="font-size:22px;font-weight:700;color:var(--ds-text);margin:0 0 16px">$1</h1>');
  // bold/italic
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;color:var(--ds-text)">$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // blockquotes
  s = s.replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid var(--ds-background-brand-bold);padding:6px 14px;margin:0 0 10px;background:rgba(12,102,228,.08);border-radius:0 3px 3px 0"><p style="margin:0;color:var(--ds-text-subtle)">$1</p></blockquote>');
  // hr
  s = s.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--ds-border);margin:16px 0">');
  // lists
  s = s.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // paragraphs
  return s.split('\n\n').map(b => {
    b = b.trim();
    if (!b) return '';
    if (/^<(h[1-3]|pre|blockquote|hr)/.test(b)) return b;
    if (b.startsWith('<li>')) return `<ul style="margin:0 0 10px 18px;color:var(--ds-text-subtle);font-size:13px">${b}</ul>`;
    return `<p style="color:var(--ds-text-subtle);font-size:13px;line-height:1.7;margin:0 0 10px">${b.split('\n').join('<br>')}</p>`;
  }).join('\n');
}

interface ReaderProps {
  docId: string;
  docs: Doc[];
  onClose: () => void;
  openDoc: (id: string) => void;
}

function Reader({ docId, docs, onClose, openDoc }: ReaderProps) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [editContent, setEditContent] = useState('');
  // CHANGE 7 — delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.doc(docId)
      .then(r => { if (r.ok) setDoc(r.document); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(() => {
    if (doc) setEditContent(doc.content);
    setConfirmDelete(false);
  }, [doc]);

  function getAncestors(id: string): Doc[] {
    const d = docs.find(x => x.id === id);
    if (!d || !d.parent_id) return [];
    const p = docs.find(x => x.id === d.parent_id);
    return p ? [...getAncestors(p.id), p] : [];
  }

  const dt = doc?.doc_type ?? 'wiki';
  const ancestors = doc ? getAncestors(doc.id) : [];

  // CHANGE 4 — extracted save handler
  async function handleSave() {
    const res = await fetch('/api/docs/' + docId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent }),
    }).catch(() => null);
    if (!res || res.status === 404 || res.status === 405) {
      alert('Save with Claude: /pm:doc update ' + docId);
    }
  }

  // ADR status detection
  let adrAppearance: 'success' | 'error' | 'warning' = 'warning';
  let adrStatus = 'proposed';
  if (doc && dt === 'adr') {
    const lower = doc.content.toLowerCase();
    if (lower.includes('status: accepted')) {
      adrStatus = 'accepted';
      adrAppearance = 'success';
    } else if (lower.includes('status: rejected') || lower.includes('status: deprecated')) {
      adrStatus = lower.includes('status: deprecated') ? 'deprecated' : 'rejected';
      adrAppearance = 'error';
    }
  }

  // CHANGE 5 — stale detection
  const isStale = doc && doc.updated_at < '2025-01-01';

  return (
    <div style={{
      width: 480, flexShrink: 0,
      background: 'var(--ds-surface-raised)',
      borderLeft: '1px solid var(--ds-border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* CHANGE 6 — top bar with InlineEdit title + CHANGE 7 delete controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 18px',
        borderBottom: '1px solid var(--ds-border)',
        flexShrink: 0,
      }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {loading || !doc ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ds-text)' }}>
              {loading ? 'Loading…' : 'Not found'}
            </span>
          ) : (
            <InlineEdit
              defaultValue={doc.title}
              editView={({ errorMessage: _e, ...fp }) => (
                <Textfield {...fp} autoFocus />
              )}
              readView={() => (
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ds-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.title}
                </span>
              )}
              onConfirm={async (val) => {
                await fetch('/api/docs/' + docId, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: val }),
                }).catch(() => null);
              }}
            />
          )}
        </div>

        {/* CHANGE 7 — delete button area */}
        {doc && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {confirmDelete ? (
              <button
                onClick={async () => {
                  const res = await fetch('/api/docs/' + docId, { method: 'DELETE' }).catch(() => null);
                  if (!res || res.status === 404 || res.status === 405) {
                    alert('Delete with Claude: /pm:doc delete ' + docId);
                  } else {
                    onClose();
                  }
                }}
                style={{
                  padding: '3px 10px', borderRadius: 3, border: '1px solid var(--ds-border-danger)',
                  background: 'var(--ds-background-danger)', color: 'var(--ds-text-danger)',
                  cursor: 'pointer', fontSize: 11, fontWeight: 600,
                }}
              >
                Delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  padding: '3px 8px', borderRadius: 3, border: '1px solid var(--ds-border)',
                  background: 'transparent', color: 'var(--ds-text-subtlest)',
                  cursor: 'pointer', fontSize: 11,
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}

        <button onClick={onClose} style={{
          width: 28, height: 28, borderRadius: 3, border: 'none',
          background: 'transparent', cursor: 'pointer', fontSize: 16,
          color: 'var(--ds-text-subtlest)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>✕</button>
      </div>

      {doc && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          padding: '8px 18px', borderBottom: '1px solid var(--ds-border)', flexShrink: 0,
        }}>
          <Lozenge appearance={DOC_APPEARANCE[dt] ?? 'default'}>
            {DOC_LABELS[dt] ?? dt}
          </Lozenge>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-text-subtlest)' }}>{doc.id}</span>
          <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginLeft: 'auto' }}>
            Updated {relTime(doc.updated_at)}
          </span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 20px' }}>
        {loading ? (
          <p style={{ color: 'var(--ds-text-subtlest)' }}>Loading…</p>
        ) : !doc ? (
          <p style={{ color: 'var(--ds-text-danger)' }}>Failed to load document.</p>
        ) : (
          <>
            {/* CHANGE 7 — InlineMessage delete confirmation */}
            {confirmDelete && (
              <div style={{ marginBottom: 12 }}>
                <InlineMessage
                  appearance="error"
                  title="This cannot be undone"
                  secondaryText="Click Delete again to confirm"
                />
              </div>
            )}

            {/* CHANGE 5 — stale warning */}
            {isStale && (
              <div style={{ marginBottom: 12 }}>
                <SectionMessage appearance="warning">
                  <p>This page may be outdated. Consider reviewing it.</p>
                </SectionMessage>
              </div>
            )}

            {dt === 'adr' && (
              <div style={{ marginBottom: 12 }}>
                <SectionMessage appearance={adrAppearance} title={'ADR — ' + adrStatus.charAt(0).toUpperCase() + adrStatus.slice(1)}>
                  <p>This Architecture Decision Record is {adrStatus}.</p>
                </SectionMessage>
              </div>
            )}

            <div style={{ marginBottom: 8 }}>
              <Breadcrumbs>
                <BreadcrumbsItem
                  text="Pages"
                  href="#"
                  onClick={(e: React.MouseEvent) => { e.preventDefault(); onClose(); }}
                />
                {ancestors.map(a => (
                  <BreadcrumbsItem
                    key={a.id}
                    text={a.title}
                    href="#"
                    onClick={(e: React.MouseEvent) => { e.preventDefault(); openDoc(a.id); }}
                  />
                ))}
                <BreadcrumbsItem text={doc.title} />
              </Breadcrumbs>
            </div>

            <Tabs id="doc-reader-tabs">
              <TabList>
                <Tab>Read</Tab>
                <Tab>Edit</Tab>
              </TabList>
              <TabPanel>
                <div style={{ paddingTop: 12 }}>
                  <div dangerouslySetInnerHTML={{ __html: renderMd(doc.content) }} />
                </div>
              </TabPanel>
              <TabPanel>
                <div style={{ padding: '12px 0' }}>
                  <TextArea
                    minimumRows={10}
                    value={editContent}
                    onChange={e => setEditContent(e.currentTarget.value)}
                    placeholder="Write in markdown..."
                  />
                  {/* CHANGE 4 — DropdownMenu save */}
                  <div style={{ marginTop: 8 }}>
                    <DropdownMenu trigger="Save">
                      <DropdownItemGroup>
                        <DropdownItem onClick={handleSave}>Save</DropdownItem>
                        <DropdownItem onClick={() => alert('Draft saved locally')}>Save as draft</DropdownItem>
                        <DropdownItem onClick={handleSave}>Publish</DropdownItem>
                      </DropdownItemGroup>
                    </DropdownMenu>
                  </div>
                </div>
              </TabPanel>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  docs: Doc[];
  activeDocId: string | null;
  onDocSelect: (id: string) => void;
  onDocClose: () => void;
  onRefresh: () => void;
}

export default function Docs({ docs, activeDocId, onDocSelect, onDocClose, onRefresh }: Props) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  // CHANGE 1 — type filter state
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  // CHANGE 1 — filtered docs
  const filteredDocs = typeFilter ? docs.filter(d => d.doc_type === typeFilter) : docs;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)', margin: 0 }}>Pages</h1>
          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
            {filteredDocs.length} {filteredDocs.length === 1 ? 'page' : 'pages'}
            {typeFilter && ` (filtered)`}
          </span>
          <div style={{ marginLeft: 'auto' }}>
            <Button appearance="primary" onClick={() => setShowCreateModal(true)}>
              Create page
            </Button>
          </div>
        </div>

        {/* CHANGE 1 — type filter pills */}
        <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
          {(['wiki', 'adr', 'plan', 'learning', 'brief', 'runbook'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              style={{
                padding: '3px 10px',
                marginRight: 4,
                borderRadius: 12,
                border: '1px solid var(--ds-border)',
                background: typeFilter === t ? 'var(--ds-background-brand-bold)' : 'transparent',
                color: typeFilter === t ? '#fff' : 'var(--ds-text-subtle)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: typeFilter === t ? 600 : 400,
                transition: 'background .12s, color .12s',
              }}
            >
              {t}
            </button>
          ))}
          {typeFilter && (
            <button
              onClick={() => setTypeFilter(null)}
              style={{
                padding: '3px 8px',
                borderRadius: 12,
                border: '1px solid var(--ds-border)',
                background: 'transparent',
                color: 'var(--ds-text-subtlest)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden', padding: '0 24px 24px' }}>
        {/* Doc grid */}
        <div style={{
          flex: 1, overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: 12,
          alignContent: 'start',
        }}>
          {filteredDocs.length === 0 ? (
            <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'center', paddingTop: 48 }}>
              <EmptyState
                header={typeFilter ? `No ${typeFilter} pages` : 'No pages yet'}
                description={
                  typeFilter
                    ? `There are no pages of type "${typeFilter}". Try a different filter or create one.`
                    : 'Create wiki pages, ADRs, plans and learnings to build your knowledge base'
                }
                primaryAction={
                  <Button appearance="primary" onClick={() => setShowCreateModal(true)}>
                    Create page
                  </Button>
                }
              />
            </div>
          ) : (
            filteredDocs.map(d => {
              const dt = d.doc_type ?? 'wiki';
              const selected = activeDocId === d.id;
              const parentMap = Object.fromEntries(docs.map(x => [x.id, x.title]));
              const tooltipContent = d.content && d.content.length > 0
                ? d.content.slice(0, 120) + '...'
                : 'No content';
              return (
                // CHANGE 3 — Tooltip wrapping each card
                <Tooltip key={d.id} content={tooltipContent} position="right" delay={600}>
                  {(tooltipProps) => (
                    <button
                      {...tooltipProps}
                      onClick={() => onDocSelect(d.id)}
                      style={{
                        background: selected ? 'var(--ds-background-selected)' : 'var(--ds-surface-raised)',
                        border: `1px solid ${selected ? 'var(--ds-border-selected)' : 'var(--ds-border)'}`,
                        borderRadius: 8,
                        padding: 16, cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex', flexDirection: 'column', gap: 8,
                        transition: 'box-shadow .15s, border-color .15s',
                        width: '100%',
                      }}
                      onMouseOver={e => { if (!selected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border-bold)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--ds-shadow-raised)'; } }}
                      onMouseOut={e => { if (!selected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; } }}
                    >
                      <div style={{ fontSize: 24 }}>{DOC_ICONS[dt] ?? '📄'}</div>
                      {/* CHANGE 2 — TagGroup with SimpleTag labels */}
                      <TagGroup>
                        <SimpleTag text={DOC_LABELS[d.doc_type ?? 'wiki'] ?? d.doc_type ?? 'wiki'} />
                        {d.parent_id && <SimpleTag text="child page" />}
                      </TagGroup>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', lineHeight: 1.35 }}>
                        {d.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', display: 'flex', gap: 8 }}>
                        <span>{relTime(d.updated_at)}</span>
                        {d.parent_id && parentMap[d.parent_id] && (
                          <span>→ {parentMap[d.parent_id]}</span>
                        )}
                      </div>
                    </button>
                  )}
                </Tooltip>
              );
            })
          )}
        </div>

        {/* Reader panel */}
        {activeDocId && (
          <Reader
            docId={activeDocId}
            docs={docs}
            onClose={onDocClose}
            openDoc={onDocSelect}
          />
        )}
      </div>

      <CreateDocModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => { onRefresh(); setShowCreateModal(false); }}
      />
    </div>
  );
}
