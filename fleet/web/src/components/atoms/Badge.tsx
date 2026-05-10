import type { SessionState } from '../../api';

export interface BadgeProps {
  state: SessionState | string;
  label?: string;
}

const LABEL: Record<string, string> = {
  'working': 'Working',
  'needs-input': 'Needs Input',
  'error': 'Error',
  'done': 'Done',
  'idle': 'Idle',
  'reviewing': 'Reviewing',
  'blocked': 'Blocked',
  'completed': 'Completed',
};

export function Badge({ state, label }: BadgeProps) {
  const text = label ?? LABEL[state] ?? state;
  return <span class={`badge badge--${state}`}>{text}</span>;
}
