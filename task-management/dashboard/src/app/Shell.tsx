import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeysSheetModal, openKeysSheet } from "./KeysSheet";
import { LiveRegion } from "../components/ui/LiveRegion";
import { SkeletonRows } from "../components/ui/Skeleton";
import { Toasts } from "../components/ui/Toast";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { isTypingTarget, resolve } from "../lib/keys.mjs";
import { closeInspector, matchRoute, navigate, useLocation } from "../lib/router";
import { startStore, useBoard, useEvents, useLoading } from "../lib/store";
import { usePwa } from "../pwa/usePwa";
import { CommandBar } from "./CommandBar";
import { Palette } from "./Palette";
import { Rail } from "./Rail";
import { ROUTES, type Route } from "./routes";
import { ScreenBoundary } from "./ScreenBoundary";

function match(path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    const params = matchRoute(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

/**
 * rail | canvas (+ command bar) | inspector. The canvas draws the list route; an inspector route
 * draws over the list it was opened from (history state), or over its fallback list.
 */
export function Shell() {
  const { path, background } = useLocation();
  const board = useBoard();
  const events = useEvents();
  const { error } = useLoading();
  const [palette, setPalette] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => startStore(), []);
  useEffect(() => {
    if (board?.project) document.title = `${board.project} — board`;
  }, [board?.project]);

  const pwa = usePwa(events, board?.tasks.filter((t) => t.status === "in_progress").length ?? 0);
  useEffect(() => {
    if (board?.settings) pwa.adoptServerPrefs(board.settings);
  }, [board?.settings, pwa.adoptServerPrefs]); // eslint-disable-line react-hooks/exhaustive-deps

  const hit = useMemo(() => match(path), [path]);
  const inspector = hit?.route.inspector ? hit : null;
  const canvasPath = inspector ? (background ?? inspector.route.fallback ?? "/board").split("?")[0] : path;
  const canvas = useMemo(() => match(canvasPath), [canvasPath]);

  // Remember what opened the inspector, and give focus back when it closes.
  useEffect(() => {
    if (inspector) opener.current = (document.activeElement as HTMLElement) ?? null;
    else opener.current?.focus?.();
  }, [inspector?.params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => closeInspector(inspector?.route.fallback), [inspector]);

  // Shell-wide keys. The board owns `/`, `?`, `c` while mounted (useBoardKeys); ⌘K and Esc are ours everywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target as HTMLElement);
      const modal = Boolean(document.querySelector("dialog[open]"));
      const intent = resolve(e, { typing, modal }) as { action: string } | null;
      if (!intent) return;
      if (intent.action === "palette") { e.preventDefault(); setPalette(true); return; }
      if (canvas?.route.ownsKeys && !inspector) return;
      if (intent.action === "escape" && inspector) { e.preventDefault(); close(); return; }
      if (intent.action === "search") { e.preventDefault(); search.current?.focus(); return; }
      if (intent.action === "help") { e.preventDefault(); openKeysSheet(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canvas?.route.ownsKeys, inspector, close]);

  useEffect(() => {
    if (path === "/") navigate("/board", { replace: true });
  }, [path]);

  const Canvas = canvas?.route.screen;
  const Panel = inspector?.route.screen;
  const wide = inspector?.route.pattern === "/tasks/:id";

  return (
    <div className="tm-shell" data-inspector={inspector ? "open" : undefined} data-inspector-wide={wide || undefined}>
      <Rail />
      <div className="tm-main">
        <CommandBar ref={search} pwa={pwa} onPalette={() => setPalette(true)} />
        <main className="tm-canvas" id="tm-canvas">
          {error && !board && <div className="tm-screen"><ErrorPanel title="The board could not be loaded" detail={error} /></div>}
          {Canvas ? (
            <ScreenBoundary name={canvas!.route.title}>
              <Suspense fallback={<div className="tm-screen"><SkeletonRows /></div>}>
                <Canvas params={canvas!.params} />
              </Suspense>
            </ScreenBoundary>
          ) : (
            <div className="tm-screen"><ErrorPanel title="No such screen" detail={path} /></div>
          )}
        </main>
      </div>
      {inspector && Panel && (
        <>
          <div className="tm-inspector__scrim" onClick={close} aria-hidden />
          <ScreenBoundary name={inspector.route.title}>
            <Suspense fallback={<aside className="tm-inspector"><div className="tm-inspector__body"><SkeletonRows /></div></aside>}>
              <Panel params={inspector.params} />
            </Suspense>
          </ScreenBoundary>
        </>
      )}
      <Palette open={palette} onClose={() => setPalette(false)} />
      <KeysSheetModal />
      <Toasts />
      <LiveRegion />
    </div>
  );
}
