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

  if (!isOpen) return null;

  function reset() {
    setTitle('');
    setDocType(null);
    setContent('');
    setLoading(false);
    setTitleError('');
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
              onChange={(option) => setDocType(option as DocTypeOption | null)}
              placeholder="Wiki (default)"
              isClearable
            />
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
