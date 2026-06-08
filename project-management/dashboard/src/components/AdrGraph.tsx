import { useRef, useLayoutEffect, useState } from 'react';
import Lozenge from '@atlaskit/lozenge';
import type { Doc } from '../types';

type LozAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'moved' | 'new';

const STATUS_COLOR: Record<string, string> = {
  proposed:   'var(--ds-background-brand-bold)',
  accepted:   'var(--ds-background-success-bold)',
  deprecated: 'var(--ds-background-warning-bold)',
  superseded: 'var(--ds-background-neutral-bold)',
  '':         'var(--ds-background-neutral-bold)',
};

const STATUS_APPEARANCE: Record<string, LozAppearance> = {
  proposed: 'inprogress',
  accepted: 'success',
  deprecated: 'moved',
  superseded: 'default',
  '': 'default',
};

const CARD_W = 168;
const CARD_H = 82;
const COL_GAP = 56;
const ROW_GAP = 40;
const COLS = 4;

interface Props {
  docs: Doc[];
  onDocClick: (id: string) => void;
}

export default function AdrGraph({ docs, onDocClick }: Props) {
  const adrs = docs
    .filter(d => d.doc_type === 'adr')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const rows = Math.ceil(adrs.length / COLS);
  const totalW = Math.min(adrs.length, COLS) * (CARD_W + COL_GAP) - COL_GAP + 32;
  const totalH = rows * (CARD_H + ROW_GAP) - ROW_GAP + 32;

  useLayoutEffect(() => {
    if (containerRef.current) {
      setSvgSize({
        w: containerRef.current.offsetWidth,
        h: containerRef.current.offsetHeight,
      });
    }
  }, [adrs.length]);

  function cardPos(idx: number) {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    return {
      x: 16 + col * (CARD_W + COL_GAP),
      y: 16 + row * (CARD_H + ROW_GAP),
    };
  }

  // Build arrows: superseded_by links
  const arrows: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  adrs.forEach((adr, i) => {
    if (!adr.superseded_by) return;
    const targetIdx = adrs.findIndex(a => a.id === adr.superseded_by);
    if (targetIdx < 0) return;
    const from = cardPos(i);
    const to = cardPos(targetIdx);
    arrows.push({
      x1: from.x + CARD_W / 2,
      y1: from.y + CARD_H / 2,
      x2: to.x + CARD_W / 2,
      y2: to.y + CARD_H / 2,
    });
  });

  if (adrs.length === 0) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--ds-text-subtlest)', fontSize: 13 }}>
        No ADRs yet. Create a doc with type "adr" to see the decision graph.
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: Math.max(totalW, 400),
          height: Math.max(totalH, 120),
          minWidth: '100%',
        }}
      >
        {/* SVG arrows layer */}
        <svg
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          width={svgSize.w || totalW}
          height={svgSize.h || totalH}
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="var(--ds-text-subtlest)" />
            </marker>
          </defs>
          {arrows.map((a, i) => {
            const cx = (a.x1 + a.x2) / 2;
            const cy = Math.min(a.y1, a.y2) - 24;
            return (
              <path
                key={i}
                d={`M ${a.x1} ${a.y1} Q ${cx} ${cy} ${a.x2} ${a.y2}`}
                fill="none"
                stroke="var(--ds-text-subtlest)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </svg>

        {/* ADR cards */}
        {adrs.map((adr, i) => {
          const { x, y } = cardPos(i);
          const status = adr.doc_status || '';
          const barColor = STATUS_COLOR[status] || STATUS_COLOR[''];
          return (
            <button
              key={adr.id}
              onClick={() => onDocClick(adr.id)}
              style={{
                position: 'absolute',
                left: x, top: y,
                width: CARD_W, height: CARD_H,
                background: 'var(--ds-surface-raised)',
                border: '1px solid var(--ds-border)',
                borderRadius: 6,
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Status bar */}
              <div style={{ height: 4, background: barColor, flexShrink: 0 }} />
              <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ds-link)', fontWeight: 600 }}>{adr.id}</span>
                  <Lozenge appearance={STATUS_APPEARANCE[status] ?? 'default'}>
                    {status || 'no status'}
                  </Lozenge>
                </div>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: 'var(--ds-text)',
                  lineHeight: 1.3,
                  overflow: 'hidden', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {adr.title}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
