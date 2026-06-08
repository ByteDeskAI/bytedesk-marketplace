import ModalDialog, { ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@atlaskit/modal-dialog';
import Textfield from '@atlaskit/textfield';
import TextArea from '@atlaskit/textarea';
import Select from '@atlaskit/select';
import Button, { LoadingButton } from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import { useState } from 'react';

interface DocTypeOption {
  label: string;
  value: string;
}

const DOC_TYPE_OPTIONS: DocTypeOption[] = [
  { label: 'Wiki', value: 'wiki' },
  { label: 'ADR', value: 'adr' },
  { label: 'Plan', value: 'plan' },
  { label: 'Learning', value: 'learning' },
  { label: 'Brief', value: 'brief' },
  { label: 'Runbook', value: 'runbook' },
];

const DOC_TEMPLATES: Record<string, string> = {
  adr: `## Context\n\n[Why this decision was needed]\n\n## Decision\n\n[The choice made, stated clearly]\n\n## Consequences\n\n[What becomes easier, what becomes harder]\n\n## Alternatives Considered\n\n[Other options and why they were rejected]\n`,
  runbook: `## Prerequisites\n\n[What must be true before starting]\n\n## Steps\n\n1. \n2. \n3. \n\n## Rollback\n\n[How to undo if something goes wrong]\n\n## Troubleshooting\n\n[Common failure modes and fixes]\n`,
  learning: `## Problem\n\n[What went wrong or what was unclear]\n\n## Root Cause\n\n[Why it happened]\n\n## Fix\n\n[What resolved it]\n\n## Prevention\n\n[How to avoid this in future]\n`,
  plan: `## Objective\n\n[What we are trying to achieve]\n\n## Scope\n\n[What is in / out of scope]\n\n## Timeline\n\n[Key milestones and dates]\n\n## Risks\n\n[Known risks and mitigations]\n`,
  brief: `## Summary\n\n[One-paragraph executive summary]\n\n## Background\n\n[Context and history]\n\n## Recommendation\n\n[What we recommend and why]\n`,
  wiki: ``,
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  parentId?: string | null;
  parentTitle?: string | null;
}

export default function CreateDocModal({ isOpen, onClose, onCreated, parentId, parentTitle }: Props) {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocTypeOption | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [templateApplied, setTemplateApplied] = useState(false);

  if (!isOpen) return null;

  function reset() {
    setTitle('');
    setDocType(null);
    setContent('');
    setLoading(false);
    setTitleError('');
    setTemplateApplied(false);
  }

  function handleTypeChange(option: DocTypeOption | null) {
    setDocType(option);
    const tmpl = DOC_TEMPLATES[option?.value ?? ''] ?? '';
    if (tmpl && !content.trim()) {
      setContent(tmpl);
      setTemplateApplied(true);
    } else {
      setTemplateApplied(false);
    }
  }

  async function handleCreate() {
    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError('');
    setLoading(true);
    try {
      const res = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          doc_type: docType?.value ?? 'wiki',
          content,
          parent_id: parentId ?? null,
        }),
      });

      if (res.status === 404 || res.status === 405) {
        alert(
          'The docs API is not available. To create a page, run:\n\n' +
          '  /pm:doc create "' + title.trim() + '"'
        );
        reset();
        onClose();
        return;
      }

      if (res.ok) {
        onCreated();
        reset();
        onClose();
      } else {
        const body = await res.text().catch(() => '');
        alert(`Failed to create page (HTTP ${res.status})${body ? ': ' + body : ''}.`);
      }
    } catch {
      alert('Network error — could not reach the docs API.');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <ModalDialog onClose={handleClose} width="medium">
      <ModalHeader>
        <ModalTitle>Create page</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {parentId && parentTitle && (
            <SectionMessage appearance="information">
              Creating page under: <strong>{parentTitle}</strong>
            </SectionMessage>
          )}

          <div>
            <label
              htmlFor="create-doc-title"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ds-text)', marginBottom: 4 }}
            >
              Title <span style={{ color: 'var(--ds-text-danger)' }}>*</span>
            </label>
            <Textfield
              id="create-doc-title"
              name="title"
              placeholder="Page title"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setTitle(e.target.value);
                if (e.target.value.trim()) setTitleError('');
              }}
              isInvalid={!!titleError}
              autoFocus
            />
            {titleError && (
              <p style={{ fontSize: 11, color: 'var(--ds-text-danger)', margin: '4px 0 0' }}>
                {titleError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="create-doc-type"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ds-text)', marginBottom: 4 }}
            >
              Doc type
            </label>
            <Select
              inputId="create-doc-type"
              options={DOC_TYPE_OPTIONS}
              value={docType}
              onChange={(option) => handleTypeChange(option as DocTypeOption | null)}
              placeholder="Wiki (default)"
              isClearable
            />
            {templateApplied && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ds-text-success)' }}>
                ✓ Template applied — edit freely
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="create-doc-content"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ds-text)', marginBottom: 4 }}
            >
              Content
            </label>
            <TextArea
              id="create-doc-content"
              name="content"
              placeholder="Write content in Markdown…"
              value={content}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
              minimumRows={8}
              resize="vertical"
            />
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button appearance="subtle" onClick={handleClose} isDisabled={loading}>
          Cancel
        </Button>
        <LoadingButton appearance="primary" onClick={handleCreate} isLoading={loading}>
          Create
        </LoadingButton>
      </ModalFooter>
    </ModalDialog>
  );
}
