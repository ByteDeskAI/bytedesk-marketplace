import { useState, useEffect, useCallback, useRef } from 'react';
import Lozenge from '@atlaskit/lozenge';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import Breadcrumbs, { BreadcrumbsItem } from '@atlaskit/breadcrumbs';
import SectionMessage from '@atlaskit/section-message';
import EmptyState from '@atlaskit/empty-state';
import Button from '@atlaskit/button';
import TextArea from '@atlaskit/textarea';
import Tooltip from '@atlaskit/tooltip';
import InlineMessage from '@atlaskit/inline-message';
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import InlineEdit from '@atlaskit/inline-edit';
import Textfield from '@atlaskit/textfield';
import Avatar from '@atlaskit/avatar';
import Comment, { CommentAuthor, CommentTime } from '@atlaskit/comment';
import Badge from '@atlaskit/badge';
import Spinner from '@atlaskit/spinner';
import { SimpleTag } from '@atlaskit/tag';
import TagGroup from '@atlaskit/tag-group';
import type { Doc } from '../types';
import { api, relTime } from '../api';
import CreateDocModal from './CreateDocModal';
import AdrGraph from './AdrGraph';
import DocHealthModal from './DocHealthModal';
import DocGenerateModal from './DocGenerateModal';

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
  let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = s.split('```');
  s = parts.map((p, i) => i % 2 === 1
    ? `<pre style="background:var(--ds-surface-sunken);border:1px solid var(--ds-border);border-radius:3px;padding:12px 14px;overflow-x:auto;margin:0 0 12px;font-size:12px"><code>${p.replace(/^[a-z]*/,'')}</code></pre>`
    : p).join('');
  s = s.replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:12px;background:var(--ds-surface-sunken);border:1px solid var(--ds-border);padding:1px 5px;border-radius:3px">$1</code>');
  s = s.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;color:var(--ds-text);margin:16px 0 6px">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;color:var(--ds-text);margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--ds-border)">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 style="font-size:22px;font-weight:700;color:var(--ds-text);margin:0 0 16px">$1</h1>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;color:var(--ds-text)">$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid var(--ds-background-brand-bold);padding:6px 14px;margin:0 0 10px;background:rgba(12,102,228,.08);border-radius:0 3px 3px 0"><p style="margin:0;color:var(--ds-text-subtle)">$1</p></blockquote>');
  s = s.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--ds-border);margin:16px 0">');
  s = s.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  return s.split('\n\n').map(b => {
    b = b.trim();
    if (!b) return '';
    if (/^<(h[1-3]|pre|blockquote|hr)/.test(b)) return b;
    if (b.startsWith('<li>')) return `<ul style="margin:0 0 10px 18px;color:var(--ds-text-subtle);font-size:13px">${b}</ul>`;
    return `<p style="color:var(--ds-text-subtle);font-size:13px;line-height:1.7;margin:0 0 10px">${b.split('\n').join('<br>')}</p>`;
  }).join('\n');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocComment { id: number; author: string; body: string; created_at: string; }
interface DocVersion { version: number; saved_at: string; title: string; content_length: number; }
interface SearchResult { id: string; title: string; doc_type: string; doc_status: string; excerpt: string; }

// ── Reader ────────────────────────────────────────────────────────────────────

interface ReaderProps {
  docId: string;
  docs: Doc[];
  onClose: () => void;
  openDoc: (id: string) => void;
  onRefresh: () => void;
}

function Reader({ docId, docs, onClose, openDoc, onRefresh }: ReaderProps) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [editContent, setEditContent] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  // Comments
  const [comments, setComments] = useState<DocComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Versions
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<{ version: number; title: string; content: string } | null>(null);
  const [versionsLoaded, setVersionsLoaded] = useState(false);

  // Linked issues
  const [linkedIssues, setLinkedIssues] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);

  const loadDoc = useCallback(() => {
    setLoading(true);
    api.doc(docId)
      .then(r => { if (r.ok) { setDoc(r.document); setLinkedIssues((r.document as any).linked_issues ?? []); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(() => { loadDoc(); }, [loadDoc]);
  useEffect(() => { if (doc) setEditContent(doc.content); setConfirmDelete(false); }, [doc]);

  function loadComments() {
    fetch(`/api/docs/${docId}/comments`)
      .then(r => r.json() as Promise<{ ok: boolean; comments: DocComment[] }>)
      .then(b => { if (b.ok) setComments(b.comments); })
      .catch(() => {});
  }

  function loadVersions() {
    if (versionsLoaded) return;
    fetch(`/api/docs/${docId}/versions`)
      .then(r => r.json() as Promise<{ ok: boolean; versions: DocVersion[] }>)
      .then(b => { if (b.ok) { setVersions(b.versions); setVersionsLoaded(true); } })
      .catch(() => {});
  }

  async function handleSave() {
    await fetch(`/api/docs/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent }),
    }).catch(() => null);
    loadDoc();
    onRefresh();
    setVersionsLoaded(false);
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setPostingComment(true);
    try {
      await fetch(`/api/docs/${docId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      setCommentBody('');
      loadComments();
    } finally {
      setPostingComment(false);
    }
  }

  async function fetchVersion(n: number) {
    const r = await fetch(`/api/docs/${docId}/versions/${n}`);
    const b = await r.json() as { ok: boolean; version: { version: number; title: string; content: string } };
    if (b.ok) setSelectedVersion(b.version);
  }

  async function linkIssue() {
    const id = linkInput.trim().toUpperCase();
    if (!id) return;
    setLinkLoading(true);
    try {
      const r = await fetch(`/api/docs/${docId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_id: id }),
      });
      const b = await r.json() as { ok: boolean; linked_issues: string[] };
      if (b.ok) { setLinkedIssues(b.linked_issues); setLinkInput(''); }
    } finally {
      setLinkLoading(false);
    }
  }

  async function unlinkIssue(issueId: string) {
    const r = await fetch(`/api/docs/${docId}/link/${issueId}`, { method: 'DELETE' });
    const b = await r.json() as { ok: boolean; linked_issues: string[] };
    if (b.ok) setLinkedIssues(b.linked_issues);
  }

  function triggerExport(includeChildren = false) {
    const url = `/api/docs/${docId}/export?format=markdown${includeChildren ? '&include_children=true' : ''}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function getAncestors(id: string): Doc[] {
    const d = docs.find(x => x.id === id);
    if (!d || !d.parent_id) return [];
    const p = docs.find(x => x.id === d.parent_id);
    return p ? [...getAncestors(p.id), p] : [];
  }

  const dt = doc?.doc_type ?? 'wiki';
  const ancestors = doc ? getAncestors(doc.id) : [];
  const isStale = doc && doc.updated_at < new Date(Date.now() - 90*24*60*60*1000).toISOString();

  return (
    <div style={{ width: 480, flexShrink: 0, background: 'var(--ds-surface-raised)', borderLeft: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--ds-border)', flexShrink: 0 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {loading || !doc ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ds-text)' }}>{loading ? 'Loading…' : 'Not found'}</span>
          ) : (
            <InlineEdit
              defaultValue={doc.title}
              editView={({ errorMessage: _e, ...fp }) => <Textfield {...fp} autoFocus />}
              readView={() => (
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ds-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.title}
                </span>
              )}
              onConfirm={async val => {
                await fetch(`/api/docs/${docId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: val }) }).catch(() => null);
                loadDoc(); onRefresh();
              }}
            />
          )}
        </div>

        {/* Export dropdown */}
        {doc && (
          <DropdownMenu
            trigger={({ triggerRef, ...tp }) => (
              <button ref={triggerRef as React.Ref<HTMLButtonElement>} {...tp}
                style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--ds-border)', background: 'transparent', cursor: 'pointer', color: 'var(--ds-text-subtle)', fontSize: 12 }}
                title="Export">
                ↓
              </button>
            )}
            placement="bottom-end"
          >
            <DropdownItemGroup title="Export">
              <DropdownItem onClick={() => triggerExport(false)}>This page (Markdown)</DropdownItem>
              <DropdownItem onClick={() => triggerExport(true)}>With children (Markdown)</DropdownItem>
            </DropdownItemGroup>
          </DropdownMenu>
        )}

        {/* AI Generate */}
        {doc && (
          <button
            onClick={() => setShowGenerate(true)}
            title="Generate content with AI"
            style={{ background: 'none', border: '1px solid var(--ds-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--ds-text-subtle)', fontSize: 12, padding: '3px 8px' }}
          >
            ✦ AI
          </button>
        )}

        {/* Delete */}
        {doc && (
          confirmDelete ? (
            <button onClick={async () => {
              const res = await fetch(`/api/docs/${docId}`, { method: 'DELETE' }).catch(() => null);
              if (!res || res.status === 404 || res.status === 405) alert('Delete with Claude: /pm:doc delete ' + docId);
              else { onClose(); onRefresh(); }
            }} style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid var(--ds-border-danger)', background: 'var(--ds-background-danger)', color: 'var(--ds-text-danger)', cursor: 'pointer', fontSize: 11 }}>
              Confirm
            </button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ padding: '3px 6px', borderRadius: 3, border: '1px solid var(--ds-border)', background: 'transparent', color: 'var(--ds-text-subtlest)', cursor: 'pointer', fontSize: 11 }}>
              Delete
            </button>
          )
        )}

        <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 3, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: 'var(--ds-text-subtlest)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
      </div>

      {doc && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 14px', borderBottom: '1px solid var(--ds-border)', flexShrink: 0 }}>
          <Lozenge appearance={DOC_APPEARANCE[dt] ?? 'default'}>{DOC_LABELS[dt] ?? dt}</Lozenge>
          {doc.doc_status && <Lozenge appearance="default">{doc.doc_status}</Lozenge>}
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-text-subtlest)' }}>{doc.id}</span>
          <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginLeft: 'auto' }}>Updated {relTime(doc.updated_at)}</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 20px' }}>
        {loading ? (
          <p style={{ color: 'var(--ds-text-subtlest)' }}>Loading…</p>
        ) : !doc ? (
          <p style={{ color: 'var(--ds-text-danger)' }}>Failed to load document.</p>
        ) : (
          <>
            {confirmDelete && <div style={{ marginBottom: 10 }}><InlineMessage appearance="error" title="This cannot be undone" secondaryText="Click Confirm to delete" /></div>}
            {isStale && <div style={{ marginBottom: 10 }}><SectionMessage appearance="warning"><p>This page may be outdated. Last updated over 90 days ago.</p></SectionMessage></div>}

            <div style={{ marginBottom: 8 }}>
              <Breadcrumbs>
                <BreadcrumbsItem text="Pages" href="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); onClose(); }} />
                {ancestors.map(a => <BreadcrumbsItem key={a.id} text={a.title} href="#" onClick={(e: React.MouseEvent) => { e.preventDefault(); openDoc(a.id); }} />)}
                <BreadcrumbsItem text={doc.title} />
              </Breadcrumbs>
            </div>

            {/* Main tabs: Read / Edit / History / Comments */}
            <Tabs id="doc-reader-tabs" onChange={(idx: number) => { if (idx === 2) loadVersions(); if (idx === 3) loadComments(); }}>
              <TabList>
                <Tab>Read</Tab>
                <Tab>Edit</Tab>
                <Tab>History</Tab>
                <Tab>Comments <Badge>{comments.length}</Badge></Tab>
              </TabList>

              {/* ── Read tab ── */}
              <TabPanel>
                <div style={{ paddingTop: 10 }}>
                  <div dangerouslySetInnerHTML={{ __html: renderMd(doc.content) }} />

                  {/* Linked issues */}
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--ds-border)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Linked Issues
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {linkedIssues.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>No linked issues</span>
                      ) : (
                        linkedIssues.map(id => (
                          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: 'var(--ds-surface-sunken)', border: '1px solid var(--ds-border)', fontSize: 12, fontFamily: 'monospace', color: 'var(--ds-link)' }}>
                            {id}
                            <button onClick={() => unlinkIssue(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-subtlest)', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                          </span>
                        ))
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={linkInput}
                        onChange={e => setLinkInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && linkIssue()}
                        placeholder="Issue ID (e.g. PMPT-1)"
                        style={{ flex: 1, padding: '4px 8px', borderRadius: 3, border: '1px solid var(--ds-border)', background: 'var(--ds-surface-sunken)', color: 'var(--ds-text)', fontSize: 12, fontFamily: 'monospace' }}
                      />
                      <button onClick={linkIssue} disabled={linkLoading || !linkInput.trim()} style={{ padding: '4px 10px', borderRadius: 3, border: '1px solid var(--ds-border)', background: 'var(--ds-background-brand-bold)', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
                        Link
                      </button>
                    </div>
                  </div>
                </div>
              </TabPanel>

              {/* ── Edit tab ── */}
              <TabPanel>
                <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Split pane: editor + preview */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginBottom: 4 }}>Markdown</div>
                      <textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        placeholder="Write in markdown…"
                        style={{
                          width: '100%', height: 280, resize: 'vertical',
                          fontFamily: 'monospace', fontSize: 12,
                          background: 'var(--ds-surface-sunken)',
                          border: '1px solid var(--ds-border)',
                          borderRadius: 4, padding: 10,
                          color: 'var(--ds-text)', lineHeight: 1.6,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginBottom: 4 }}>Preview</div>
                      <div
                        style={{ height: 280, overflowY: 'auto', background: 'var(--ds-surface-sunken)', border: '1px solid var(--ds-border)', borderRadius: 4, padding: 10 }}
                        dangerouslySetInnerHTML={{ __html: renderMd(editContent) }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button appearance="primary" onClick={handleSave}>Save</Button>
                    <Button appearance="subtle" onClick={() => setEditContent(doc.content)}>Reset</Button>
                  </div>
                </div>
              </TabPanel>

              {/* ── History tab ── */}
              <TabPanel>
                <div style={{ paddingTop: 10 }}>
                  {versions.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--ds-text-subtlest)' }}>No previous versions. Versions are saved automatically when you edit the title or content.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[...versions].reverse().map(v => (
                        <button
                          key={v.version}
                          onClick={() => fetchVersion(v.version)}
                          style={{
                            textAlign: 'left', cursor: 'pointer',
                            padding: '8px 12px', borderRadius: 4,
                            background: selectedVersion?.version === v.version ? 'var(--ds-background-selected)' : 'var(--ds-surface-sunken)',
                            border: `1px solid ${selectedVersion?.version === v.version ? 'var(--ds-border-selected)' : 'var(--ds-border)'}`,
                            display: 'flex', alignItems: 'center', gap: 10, color: 'inherit',
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-link)', flexShrink: 0 }}>v{v.version}</span>
                          <span style={{ fontSize: 12, color: 'var(--ds-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                          <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>{relTime(v.saved_at)} · {v.content_length}c</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedVersion && (
                    <div style={{ marginTop: 14, padding: 12, background: 'var(--ds-surface-sunken)', borderRadius: 4, border: '1px solid var(--ds-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text)' }}>v{selectedVersion.version} — {selectedVersion.title}</span>
                        <Button appearance="subtle" onClick={() => { setEditContent(selectedVersion.content); }}>
                          Restore to editor
                        </Button>
                      </div>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--ds-text-subtle)', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', lineHeight: 1.6 }}>
                        {selectedVersion.content || '(empty)'}
                      </div>
                    </div>
                  )}
                </div>
              </TabPanel>

              {/* ── Comments tab ── */}
              <TabPanel>
                <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {comments.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--ds-text-subtlest)' }}>No comments yet.</p>
                  ) : (
                    comments.map(c => (
                      <Comment
                        key={c.id}
                        avatar={<Avatar size="small" name={c.author} />}
                        author={<CommentAuthor>{c.author}</CommentAuthor>}
                        time={<CommentTime>{relTime(c.created_at)}</CommentTime>}
                        content={<p style={{ margin: 0, fontSize: 13, color: 'var(--ds-text-subtle)' }}>{c.body}</p>}
                      />
                    ))
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--ds-border)' }}>
                    <TextArea
                      value={commentBody}
                      onChange={e => setCommentBody(e.currentTarget.value)}
                      placeholder="Add a comment…"
                      minimumRows={3}
                    />
                    <Button appearance="primary" isDisabled={postingComment || !commentBody.trim()} onClick={postComment}>
                      {postingComment ? 'Posting…' : 'Post comment'}
                    </Button>
                  </div>
                </div>
              </TabPanel>
            </Tabs>
          </>
        )}
      </div>

      {showGenerate && doc && (
        <DocGenerateModal
          docId={docId}
          docTitle={doc.title}
          onClose={() => setShowGenerate(false)}
          onDone={() => { setShowGenerate(false); loadDoc(); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Main Docs view ────────────────────────────────────────────────────────────

interface Props {
  docs: Doc[];
  activeDocId: string | null;
  onDocSelect: (id: string) => void;
  onDocClose: () => void;
  onRefresh: () => void;
}

export default function Docs({ docs, activeDocId, onDocSelect, onDocClose, onRefresh }: Props) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasAdrs = docs.some(d => d.doc_type === 'adr');

  // Debounced search
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setSearchLoading(true);
    searchRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/docs/search?q=${encodeURIComponent(searchQuery)}`);
        const b = await r.json() as { ok: boolean; results: SearchResult[] };
        if (b.ok) setSearchResults(b.results);
      } catch {}
      finally { setSearchLoading(false); }
    }, 300);
  }, [searchQuery]);

  // Highlight search term in excerpt
  function highlightExcerpt(excerpt: string, query: string): React.ReactNode {
    if (!query) return excerpt;
    const idx = excerpt.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return excerpt;
    return (
      <>
        {excerpt.slice(0, idx)}
        <strong style={{ color: 'var(--ds-text)', background: 'rgba(255,213,0,.25)' }}>{excerpt.slice(idx, idx + query.length)}</strong>
        {excerpt.slice(idx + query.length)}
      </>
    );
  }

  const filteredDocs = typeFilter ? docs.filter(d => d.doc_type === typeFilter) : docs;

  function triggerExportAll() {
    const a = document.createElement('a');
    a.href = '/api/docs/export?format=markdown';
    a.download = 'docs.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '14px 24px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)', margin: 0 }}>Pages</h1>
          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
            {filteredDocs.length} {filteredDocs.length === 1 ? 'page' : 'pages'}{typeFilter && ' (filtered)'}
          </span>

          {/* Search */}
          <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search docs…"
              style={{
                width: '100%', padding: '5px 28px 5px 10px', borderRadius: 4,
                border: '1px solid var(--ds-border)',
                background: 'var(--ds-surface-sunken)', color: 'var(--ds-text)', fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-subtlest)', fontSize: 14 }}>×</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {hasAdrs && (
              <Button appearance={showGraph ? 'primary' : 'default'} onClick={() => setShowGraph(g => !g)}>
                ⚖ ADR Graph
              </Button>
            )}
            <Button appearance="default" onClick={() => setShowHealth(true)}>⚕ Health</Button>
            <DropdownMenu
              trigger={({ triggerRef, ...tp }) => (
                <button ref={triggerRef as React.Ref<HTMLButtonElement>} {...tp}
                  style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--ds-border)', background: 'transparent', cursor: 'pointer', color: 'var(--ds-text)', fontSize: 13 }}>
                  ↓ Export
                </button>
              )}
            >
              <DropdownItemGroup title="Export all">
                <DropdownItem onClick={triggerExportAll}>All docs (Markdown)</DropdownItem>
              </DropdownItemGroup>
            </DropdownMenu>
            <Button appearance="primary" onClick={() => setShowCreateModal(true)}>Create page</Button>
          </div>
        </div>

        {/* Type filter pills */}
        {!searchQuery && (
          <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
            {(['wiki', 'adr', 'plan', 'learning', 'brief', 'runbook'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid var(--ds-border)', background: typeFilter === t ? 'var(--ds-background-brand-bold)' : 'transparent', color: typeFilter === t ? '#fff' : 'var(--ds-text-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: typeFilter === t ? 600 : 400, transition: 'background .12s, color .12s' }}>
                {t}
              </button>
            ))}
            {typeFilter && (
              <button onClick={() => setTypeFilter(null)} style={{ padding: '3px 8px', borderRadius: 12, border: '1px solid var(--ds-border)', background: 'transparent', color: 'var(--ds-text-subtlest)', cursor: 'pointer', fontSize: 11 }}>clear</button>
            )}
          </div>
        )}
      </div>

      {/* ADR Graph */}
      {showGraph && !searchQuery && (
        <div style={{ padding: '0 24px 16px', flexShrink: 0, overflow: 'auto', maxHeight: 280, borderBottom: '1px solid var(--ds-border)' }}>
          <AdrGraph docs={docs} onDocClick={id => { onDocSelect(id); }} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden', padding: '0 24px 24px' }}>
        {/* Doc grid OR search results */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, alignContent: 'start' }}>

          {searchQuery && (
            <div style={{ paddingTop: 8 }}>
              {searchLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spinner size="small" /></div>}
              {!searchLoading && searchResults !== null && searchResults.length === 0 && (
                <p style={{ color: 'var(--ds-text-subtlest)', fontSize: 13 }}>No results for "{searchQuery}"</p>
              )}
              {!searchLoading && searchResults && searchResults.length > 0 && (
                <>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ds-text-subtlest)' }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</p>
                  {searchResults.map(r => (
                    <button key={r.id} onClick={() => onDocSelect(r.id)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: 6, background: 'var(--ds-surface-raised)', border: '1px solid var(--ds-border)', cursor: 'pointer', marginBottom: 8, color: 'inherit' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Lozenge appearance={DOC_APPEARANCE[r.doc_type] ?? 'default'}>{DOC_LABELS[r.doc_type] ?? r.doc_type}</Lozenge>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)' }}>{r.id}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>{r.title}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-text-subtlest)', lineHeight: 1.5, fontFamily: 'monospace' }}>
                        …{highlightExcerpt(r.excerpt, searchQuery)}…
                      </p>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {!searchQuery && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12, alignContent: 'start' }}>
              {filteredDocs.length === 0 ? (
                <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'center', paddingTop: 48 }}>
                  <EmptyState
                    header={typeFilter ? `No ${typeFilter} pages` : 'No pages yet'}
                    description={typeFilter ? `No pages of type "${typeFilter}".` : 'Create wiki pages, ADRs, plans and learnings to build your knowledge base'}
                    primaryAction={<Button appearance="primary" onClick={() => setShowCreateModal(true)}>Create page</Button>}
                  />
                </div>
              ) : (
                filteredDocs.map(d => {
                  const dt = d.doc_type ?? 'wiki';
                  const selected = activeDocId === d.id;
                  const parentMap = Object.fromEntries(docs.map(x => [x.id, x.title]));
                  const tooltipContent = d.content ? d.content.slice(0, 120) + '…' : 'No content';
                  return (
                    <Tooltip key={d.id} content={tooltipContent} position="right" delay={600}>
                      {(tooltipProps) => (
                        <button
                          {...tooltipProps}
                          onClick={() => onDocSelect(d.id)}
                          style={{
                            background: selected ? 'var(--ds-background-selected)' : 'var(--ds-surface-raised)',
                            border: `1px solid ${selected ? 'var(--ds-border-selected)' : 'var(--ds-border)'}`,
                            borderRadius: 8, padding: 16, cursor: 'pointer',
                            textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8,
                            transition: 'box-shadow .15s, border-color .15s', width: '100%',
                          }}
                          onMouseOver={e => { if (!selected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border-bold)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--ds-shadow-raised)'; } }}
                          onMouseOut={e => { if (!selected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; } }}
                        >
                          <div style={{ fontSize: 24 }}>{DOC_ICONS[dt] ?? '📄'}</div>
                          <TagGroup>
                            <SimpleTag text={DOC_LABELS[d.doc_type ?? 'wiki'] ?? d.doc_type ?? 'wiki'} />
                            {d.parent_id && <SimpleTag text="child page" />}
                          </TagGroup>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', lineHeight: 1.35 }}>{d.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', display: 'flex', gap: 8 }}>
                            <span>{relTime(d.updated_at)}</span>
                            {d.parent_id && parentMap[d.parent_id] && <span>→ {parentMap[d.parent_id]}</span>}
                          </div>
                        </button>
                      )}
                    </Tooltip>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Reader panel */}
        {activeDocId && (
          <Reader docId={activeDocId} docs={docs} onClose={onDocClose} openDoc={onDocSelect} onRefresh={onRefresh} />
        )}
      </div>

      <CreateDocModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={() => { onRefresh(); setShowCreateModal(false); }} />
      {showHealth && <DocHealthModal onClose={() => setShowHealth(false)} onDocClick={id => { onDocSelect(id); setShowHealth(false); }} />}
    </div>
  );
}
