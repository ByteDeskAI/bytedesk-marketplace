/**
 * A history router in ninety lines.
 *
 * bin/tm-dashboard already answers every unmatched path with index.html, so real paths
 * (`/tasks/TM-014`) deep-link without a hash. ponytail: a pattern table, pushState and
 * popstate — react-router is sixty kilobytes for a dozen routes; wouter is a dependency for
 * the same lines as this file. Precedent: fleet/web/src/hooks/useRoute.ts.
 */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { createElement } from "react";

export type Params = Record<string, string>;

export interface Location {
  path: string;
  query: URLSearchParams;
  /**
   * The list route an entity route was opened over, kept in history state so the inspector
   * knows what to draw underneath — and what to return to on close.
   */
  background: string | null;
}

const listeners = new Set<() => void>();
let current = read();

function read(): Location {
  const state = (history.state ?? {}) as { background?: string };
  return {
    path: location.pathname.replace(/\/+$/, "") || "/",
    query: new URLSearchParams(location.search),
    background: typeof state.background === "string" ? state.background : null,
  };
}

function emit() {
  current = read();
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") window.addEventListener("popstate", emit);

export interface NavigateOptions {
  replace?: boolean;
  /** Open as an inspector over the current list route (or over `background` if given). */
  inspector?: boolean | string;
}

export function navigate(to: string, opts: NavigateOptions = {}) {
  const state: { background?: string } = {};
  if (opts.inspector) {
    const bg = typeof opts.inspector === "string" ? opts.inspector : current.background ?? current.path + location.search;
    state.background = bg;
  }
  if (to === current.path + location.search && !opts.inspector) return;
  history[opts.replace ? "replaceState" : "pushState"](state, "", to);
  emit();
}

/** Close an inspector: back to the background route without a new history entry. */
export function closeInspector(fallback = "/board") {
  navigate(current.background ?? fallback, { replace: true });
}

export function useLocation(): Location {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** `/tasks/:id` against `/tasks/TM-014` → `{ id: "TM-014" }`; null when it does not match. */
export function matchRoute(pattern: string, path: string): Params | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** Replace one query key in place — the way a filter writes itself into the URL. */
export function setQuery(patch: Record<string, string | null>, opts: NavigateOptions = { replace: true }) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) v == null || v === "" ? q.delete(k) : q.set(k, v);
  const s = q.toString();
  navigate(location.pathname + (s ? `?${s}` : ""), opts);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; inspector?: boolean | string; replace?: boolean };

/** A real anchor, so middle-click and copy-link work; plain clicks stay in the app. */
export function Link({ to, inspector, replace, onClick, ...rest }: LinkProps) {
  return createElement("a", {
    ...rest,
    href: to,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to, { inspector, replace });
    },
  });
}
