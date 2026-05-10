// Tiny set of inline SVG icons. Real icon-set comes in Phase 7 polish; for
// scaffold purposes this gives the Sidebar nav something to render next to
// each label.

import type { JSX } from 'preact';

export type IconName =
  | 'overview'
  | 'sessions'
  | 'chains'
  | 'tournaments'
  | 'events'
  | 'search'
  | 'audit'
  | 'settings'
  | 'plus';

const PATHS: Record<IconName, JSX.Element> = {
  overview:    <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />,
  sessions:    <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />,
  chains:      <path d="M10.59 13.41L4 6.83l1.41-1.42 6.59 6.59 6.59-6.59L20 6.83l-9.41 9.41z" />,
  tournaments: <path d="M5 4h14v3a5 5 0 0 1-4 4.9V14h2v2H7v-2h2v-2.1A5 5 0 0 1 5 7V4z" />,
  events:      <circle cx="12" cy="12" r="9" />,
  search:      <path d="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />,
  audit:       <path d="M9 11H7v8h2v-8zm4-6h-2v14h2V5zm4 9h-2v5h2v-5z" />,
  settings:    <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94L14.4 2.7a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.62a7.04 7.04 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.62c.04.25.25.42.5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.62c.58-.24 1.12-.56 1.62-.94l2.39.96c.23.09.5 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />,
  plus:        <path d="M12 5v14M5 12h14" />,
};

export interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
