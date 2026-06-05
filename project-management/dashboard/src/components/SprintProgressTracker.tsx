import { ProgressTracker, type Stages } from '@atlaskit/progress-tracker';

interface Props {
  sprintStatus: string | null;
}

type StageStatus = 'unvisited' | 'current' | 'visited' | 'disabled';

const STAGE_KEYS = ['PLANNING', 'ACTIVE', 'REVIEW', 'CLOSED'] as const;

function buildStages(sprintStatus: string | null): Stages {
  const currentIndex = sprintStatus ? STAGE_KEYS.indexOf(sprintStatus as typeof STAGE_KEYS[number]) : -1;

  const labels = ['Planning', 'In Progress', 'Review', 'Closed'];

  return STAGE_KEYS.map((key, idx) => {
    let status: StageStatus;
    if (currentIndex === -1) {
      status = idx === 0 ? 'current' : 'unvisited';
    } else if (idx < currentIndex) {
      status = 'visited';
    } else if (idx === currentIndex) {
      status = 'current';
    } else {
      status = 'unvisited';
    }

    return {
      id: key,
      label: labels[idx],
      percentageComplete: status === 'visited' ? 100 : 0,
      status,
      onClick: () => {},
    };
  });
}

// Fallback simple step indicator using DS tokens
function FallbackTracker({ sprintStatus }: { sprintStatus: string | null }) {
  const currentIndex = sprintStatus ? STAGE_KEYS.indexOf(sprintStatus as typeof STAGE_KEYS[number]) : -1;
  const labels = ['Planning', 'In Progress', 'Review', 'Closed'];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '8px 12px',
        fontFamily: 'var(--ds-font-family-body, system-ui, sans-serif)',
        fontSize: '12px',
      }}
    >
      {STAGE_KEYS.map((key, idx) => {
        const isVisited = currentIndex !== -1 && idx < currentIndex;
        const isCurrent = idx === currentIndex || (currentIndex === -1 && idx === 0);
        const isUnvisited = !isVisited && !isCurrent;

        const circleColor = isVisited
          ? 'var(--ds-background-success-bold, #22A06B)'
          : isCurrent
          ? 'var(--ds-background-selected-bold, #0C66E4)'
          : 'var(--ds-background-neutral, #F1F2F4)';

        const circleBorder = isUnvisited
          ? '2px solid var(--ds-border, #8590A2)'
          : '2px solid transparent';

        const textColor = isVisited || isCurrent
          ? 'var(--ds-text, #172B4D)'
          : 'var(--ds-text-subtlest, #626F86)';

        const lineColor =
          idx > 0 && currentIndex !== -1 && idx <= currentIndex
            ? 'var(--ds-background-success-bold, #22A06B)'
            : 'var(--ds-border, #8590A2)';

        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', flex: idx < STAGE_KEYS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: circleColor,
                  border: circleBorder,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {isVisited && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span style={{ color: textColor, whiteSpace: 'nowrap', fontWeight: isCurrent ? 600 : 400 }}>
                {labels[idx]}
              </span>
            </div>
            {idx < STAGE_KEYS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: '2px',
                  background: lineColor,
                  margin: '0 4px',
                  marginBottom: '16px',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SprintProgressTracker({ sprintStatus }: Props) {
  try {
    const stages = buildStages(sprintStatus);
    return (
      <div style={{ padding: '4px 8px' }}>
        <ProgressTracker items={stages} />
      </div>
    );
  } catch {
    return <FallbackTracker sprintStatus={sprintStatus} />;
  }
}
