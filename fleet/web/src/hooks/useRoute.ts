// useRoute — Phase 9 (BDM-25). Minimal hash-based router. Hash routing
// keeps the per-project static-SPA bundle servable without server-side
// rewrites; the URL bar still shows readable paths.
//
// Routes are matched by simple prefix; the rest of the path is
// returned in `params`.
//
//   #/                  → { name: 'overview', params: {} }
//   #/audit             → { name: 'audit', params: {} }
//   #/sessions/X/replay → { name: 'replay', params: { ticket: 'X' } }

import { useEffect, useState } from 'preact/hooks';

export interface Route {
  name: 'overview' | 'audit' | 'replay' | 'settings' | 'grid';
  params: Record<string, string>;
}

function parseHash(h: string): Route {
  const path = (h || '').replace(/^#\/?/, '');
  if (!path || path === '/') return { name: 'overview', params: {} };
  if (path === 'audit') return { name: 'audit', params: {} };
  if (path === 'settings') return { name: 'settings', params: {} };
  if (path === 'grid') return { name: 'grid', params: {} };
  const m = /^sessions\/([^/]+)\/replay$/.exec(path);
  if (m) return { name: 'replay', params: { ticket: decodeURIComponent(m[1]) } };
  return { name: 'overview', params: {} };
}

export function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (path: string) => {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  };
  return [route, navigate];
}
