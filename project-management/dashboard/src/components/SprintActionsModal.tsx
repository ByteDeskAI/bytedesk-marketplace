import ModalDialog, { ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@atlaskit/modal-dialog'
import Button from '@atlaskit/button'
import SectionMessage from '@atlaskit/section-message'
import Lozenge from '@atlaskit/lozenge'
import type { Issue } from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
  sprintName: string
  completedIssues: Issue[]
  rolloverIssues: Issue[]
  completedPoints: number
  totalPoints: number
}

export default function SprintActionsModal({
  isOpen,
  onClose,
  onComplete,
  sprintName,
  completedIssues,
  rolloverIssues,
  completedPoints,
  totalPoints,
}: Props) {
  if (!isOpen) return null

  return (
    <ModalDialog width="medium" onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Complete Sprint: {sprintName}</ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SectionMessage appearance="success" title="Sprint summary">
            <p style={{ margin: 0 }}>
              {completedPoints} of {totalPoints} story points completed
              {completedIssues.length > 0 && (
                <> ({completedIssues.length} {completedIssues.length === 1 ? 'issue' : 'issues'} done)</>
              )}
              .
            </p>
          </SectionMessage>

          {rolloverIssues.length > 0 && (
            <SectionMessage
              appearance="warning"
              title={`${rolloverIssues.length} ${rolloverIssues.length === 1 ? 'issue' : 'issues'} will roll over to the next sprint`}
            >
              <ul style={{ margin: '8px 0 0 0', padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {rolloverIssues.map((issue) => (
                  <li key={issue.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#172B4D' }}>{issue.title}</span>
                    <Lozenge appearance="moved">{issue.status.replace('_', ' ')}</Lozenge>
                  </li>
                ))}
              </ul>
            </SectionMessage>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={onComplete}>
          Complete Sprint
        </Button>
      </ModalFooter>
    </ModalDialog>
  )
}
