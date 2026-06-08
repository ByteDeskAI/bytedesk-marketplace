import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import Tooltip from '@atlaskit/tooltip';
import InlineEdit from '@atlaskit/inline-edit';
import ProfileMenu from './ProfileMenu';
import Textfield from '@atlaskit/textfield';
import type { Dashboard } from '../types';

interface Props {
  dashboard: Dashboard | null;
  live: boolean;
  onCompleteSprint?: () => void;
}

// Compute a human-readable countdown label and color from an ISO end_date string.
function sprintCountdown(endDate: string): { label: string; color: string } {
  const msPerDay = 86_400_000;
  const diffMs = new Date(endDate).getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / msPerDay);

  if (diffDays < 0) {
    return {
      label: `Overdue ${Math.abs(diffDays)}d`,
      color: 'var(--ds-text-danger)',
    };
  }
  if (diffDays === 0) {
    return { label: 'Ends today', color: 'var(--ds-text-warning)' };
  }
  if (diffDays === 1) {
    return { label: 'Ends tomorrow', color: 'var(--ds-text-warning)' };
  }
  if (diffDays <= 2) {
    return { label: `Ends in ${diffDays}d`, color: 'var(--ds-text-warning)' };
  }
  return { label: `Ends in ${diffDays}d`, color: 'var(--ds-text-success)' };
}

export default function Header({ dashboard, live, onCompleteSprint }: Props) {
  const hasSprint = dashboard?.active_sprint && dashboard.active_sprint !== 'No active sprint';

  // Sprint goal extraction — active_sprint may be "Sprint 1 -- Goal here"
  const rawSprint = dashboard?.active_sprint ?? '';
  const dashIdx = rawSprint.indexOf(' -- ');
  const sprintDisplayName = dashIdx > -1 ? rawSprint.slice(0, dashIdx) : rawSprint;
  const sprintGoalText = dashIdx > -1 ? rawSprint.slice(dashIdx + 4) : '';

  const endDate = dashboard?.sprint_end_date ?? null;
  const countdown = hasSprint && endDate ? sprintCountdown(endDate) : null;

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 20px',
        height: 56,
        background: 'var(--ds-surface-sunken)',
        borderBottom: '1px solid var(--ds-border)',
        flexShrink: 0,
        zIndex: 100,
      }}
    >
      {/* Logo + project */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 240, paddingRight: 16, borderRight: '1px solid var(--ds-border)', flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28,
          background: 'var(--ds-background-brand-bold)',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"/>
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dashboard?.project_name ?? 'Loading…'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)' }}>Software project</div>
        </div>
      </div>

      {/* Sprint chip + progress + avatar group */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 12, minWidth: 0 }}>
        {hasSprint ? (
          <>
            {/* Sprint chip with inline-editable name */}
            <div
              title={sprintGoalText || undefined}
              style={{
                display: 'inline-flex', flexDirection: 'column', gap: 2,
                background: 'var(--ds-background-neutral)',
                border: '1px solid var(--ds-border)',
                borderRadius: 3, padding: '4px 10px',
                fontSize: 12, color: 'var(--ds-text)', whiteSpace: 'nowrap',
              }}
            >
              <InlineEdit
                defaultValue={sprintDisplayName}
                editView={({ errorMessage, ...fieldProps }) => (
                  <Textfield
                    {...fieldProps}
                    autoFocus
                    style={{ color: '#fff', background: 'transparent' }}
                  />
                )}
                readView={() => (
                  <strong style={{ color: '#fff' }}>{sprintDisplayName}</strong>
                )}
                onConfirm={(value: string) => {
                  console.log('Sprint renamed to:', value);
                }}
              />
              {sprintGoalText && (
                <span style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,.5)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 180,
                }}>
                  {sprintGoalText.slice(0, 35)}{sprintGoalText.length > 35 ? '…' : ''}
                </span>
              )}
            </div>

            {/* Sprint end-date countdown chip */}
            {countdown && (
              <span style={{
                fontSize: 11,
                color: countdown.color,
                background: 'var(--ds-surface-sunken)',
                borderRadius: 4,
                padding: '3px 8px',
                fontWeight: 500,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}>
                {countdown.label}
              </span>
            )}

            {/* Sprint actions dropdown */}
            <DropdownMenu trigger="..." appearance="default">
              <DropdownItemGroup>
                <DropdownItem>Edit sprint</DropdownItem>
                <DropdownItem onClick={onCompleteSprint}>Complete sprint</DropdownItem>
                <DropdownItem>Move all to backlog</DropdownItem>
              </DropdownItemGroup>
            </DropdownMenu>

          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>No active sprint</span>
        )}
      </div>

      {/* Live indicator */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--ds-background-neutral)',
        border: '1px solid var(--ds-border)',
        borderRadius: 12, padding: '3px 10px',
        fontSize: 11, color: 'var(--ds-text-subtlest)',
        flexShrink: 0,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: live ? 'var(--ds-background-success-bold)' : 'var(--ds-background-danger-bold)',
          display: 'inline-block',
          animation: live ? 'pulse 2s infinite' : 'none',
        }} />
        Live
      </div>

      {/* Profile / server menu */}
      <div style={{ flexShrink: 0, marginLeft: 4 }}>
        <ProfileMenu />
      </div>
    </header>
  );
}
