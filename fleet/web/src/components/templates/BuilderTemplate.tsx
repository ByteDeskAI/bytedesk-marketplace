// BuilderTemplate — Phase 12.4 (BDM-28). Three-region grid for the
// chain editor: palette (left), canvas (center), inspector (right).
// Pages compose this inside an AppShell.

import type { ComponentChildren } from 'preact';

export interface BuilderTemplateProps {
  palette: ComponentChildren;
  canvas: ComponentChildren;
  inspector: ComponentChildren;
  toolbar?: ComponentChildren;
}

export function BuilderTemplate({ palette, canvas, inspector, toolbar }: BuilderTemplateProps) {
  return (
    <div class="chain-builder">
      {toolbar ? <div class="chain-builder__toolbar">{toolbar}</div> : null}
      <div class="chain-builder__grid">
        <div class="chain-builder__palette">{palette}</div>
        <div class="chain-builder__canvas">{canvas}</div>
        <div class="chain-builder__inspector">{inspector}</div>
      </div>
    </div>
  );
}
