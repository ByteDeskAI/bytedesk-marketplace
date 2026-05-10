// VersionPill — small build/version chip in the sidebar brand row.
// Reads /api/version live so the UI always reflects what the running
// server reports — handy for spotting binary/SPA drift (e.g. a stale
// embedded dist/ vs an updated bundle on disk; BDM-44 reuse-or-reload
// + caching diagnostics).

import { useEffect, useState } from 'preact/hooks';
import { fetchVersion } from '../../api';

export function VersionPill() {
  const [build, setBuild] = useState<string>('…');
  useEffect(() => {
    let cancelled = false;
    fetchVersion()
      .then((v) => { if (!cancelled) setBuild(v.build || 'dev'); })
      .catch(() => { if (!cancelled) setBuild('dev'); });
    return () => { cancelled = true; };
  }, []);
  // Strip the leading "v" if present — the brand row already prefixes
  // visually. Keep the trailing -bdmN tag if any.
  const display = build.startsWith('v') ? build.slice(1) : build;
  return (
    <span class="sidebar__brand-tag" title={`server build: ${build}`}>v{display}</span>
  );
}
