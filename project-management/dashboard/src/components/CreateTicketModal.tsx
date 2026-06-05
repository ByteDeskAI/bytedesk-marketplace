import ModalDialog, { ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@atlaskit/modal-dialog'
import Textfield from '@atlaskit/textfield'
import TextArea from '@atlaskit/textarea'
import Select from '@atlaskit/select'
import Button from '@atlaskit/button'
import Spinner from '@atlaskit/spinner'
import { RadioGroup } from '@atlaskit/radio'
import InlineMessage from '@atlaskit/inline-message'
import Tooltip from '@atlaskit/tooltip'
import { useState } from 'react'

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

const typeOptions = [
  { label: 'Task', value: 'task' },
  { label: 'Bug', value: 'bug' },
  { label: 'Story', value: 'story' },
  { label: 'Epic', value: 'epic' },
]

const priorityOpts = [
  { name: 'priority', value: 'low', label: 'Low' },
  { name: 'priority', value: 'medium', label: 'Medium' },
  { name: 'priority', value: 'high', label: 'High' },
  { name: 'priority', value: 'critical', label: 'Critical' },
]

type SelectOption = { label: string; value: string }

export default function CreateTicketModal({ isOpen, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [issueType, setIssueType] = useState<SelectOption | null>(null)
  const [priority, setPriority] = useState<SelectOption | null>(null)
  const [loading, setLoading] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [error, setError] = useState('')

  if (!isOpen) return null

  const resetState = () => {
    setTitle('')
    setDescription('')
    setIssueType(null)
    setPriority(null)
    setLoading(false)
    setTitleError('')
    setError('')
  }

  const handleCreate = async () => {
    if (title.trim() === '') {
      setTitleError('Title is required.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          issue_type: issueType?.value ?? 'task',
          priority: priority?.value ?? 'medium',
        }),
      })

      if (response.ok) {
        onCreated()
        resetState()
        onClose()
      } else if (response.status === 404 || response.status === 405) {
        const createCmd = `POST /api/issues { title: "${title}", issue_type: "${issueType?.value ?? 'task'}", priority: "${priority?.value ?? 'medium'}" }`
        alert(`Create endpoint not available. Command:\n${createCmd}`)
        onClose()
      } else {
        const text = await response.text().catch(() => 'Unknown error')
        setError(text || `Request failed with status ${response.status}`)
      }
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalDialog width="medium" onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Create issue</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <p style={{ fontWeight: 'bold', margin: '0 0 4px 0' }}>Title</p>
            <Textfield
              value={title}
              onChange={(e) => {
                setTitle((e.target as HTMLInputElement).value)
                if (titleError) setTitleError('')
              }}
              placeholder="Issue title"
            />
            {titleError && <InlineMessage appearance="error" title={titleError} />}
          </div>

          <div>
            <p style={{ fontWeight: 'bold', margin: '0 0 4px 0' }}>Description</p>
            <TextArea
              value={description}
              onChange={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              placeholder="Add a description..."
              minimumRows={4}
            />
          </div>

          <div>
            <p style={{ fontWeight: 'bold', margin: '0 0 4px 0' }}>Issue type</p>
            <Select
              options={typeOptions}
              value={issueType}
              onChange={(option) => setIssueType(option as SelectOption | null)}
              placeholder="Select type"
            />
          </div>

          <div>
            <p style={{ fontWeight: 'bold', margin: '0 0 4px 0' }}>Priority</p>
            <RadioGroup
              options={priorityOpts}
              value={priority?.value ?? 'medium'}
              onChange={(e) =>
                setPriority({ label: e.currentTarget.value, value: e.currentTarget.value })
              }
            />
          </div>

          {error && <InlineMessage appearance="warning" title={error} />}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button appearance="subtle" onClick={onClose} isDisabled={loading}>
          Cancel
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {loading && <Spinner size="small" />}
          <Tooltip content={!title.trim() ? 'Title is required' : 'Create this issue'} position="top">
            {(tp) => (
              <span {...tp}>
                <Button
                  appearance="primary"
                  onClick={handleCreate}
                  isDisabled={loading || !title.trim()}
                >
                  Create
                </Button>
              </span>
            )}
          </Tooltip>
        </div>
      </ModalFooter>
    </ModalDialog>
  )
}
