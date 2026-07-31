import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUMNS, focusedId, isTypingTarget, locate, move, resolve } from "./keys.mjs";
import type { Status, Task } from "./types";

export interface Focus {
  column: number;
  row: number;
}

/**
 * The board's keyboard. All decisions live in keys.mjs; this is the wiring —
 * one window listener, a roving focus index, and DOM focus moved to match so a
 * screen reader follows the same card the eye does.
 */
export function useBoardKeys({
  visible,
  modal,
  onOpen,
  onTransition,
  onRank,
  onSelect,
  onWatch,
  onCreate,
  onSearch,
  onHelp,
  onPalette,
  onEscape,
}: {
  visible: Task[];
  /** A drawer, dialog or palette is up: it owns the keyboard until it closes. */
  modal: boolean;
  onOpen: (id: string) => void;
  onTransition: (id: string, status: Status) => void;
  onRank: (id: string, target: string, where: "before" | "after") => void;
  onSelect: (id: string) => void;
  onWatch: (id: string) => void;
  onCreate: () => void;
  onSearch: () => void;
  onHelp: () => void;
  onPalette: () => void;
  onEscape: () => void;
}) {
  const [focus, setFocus] = useState<Focus | null>(null);

  // Ids per column, in screen order — the shape keys.mjs navigates.
  const columns = useMemo(
    () => COLUMNS.map((status) => visible.filter((t) => t.status === status).map((t) => t.id)),
    [visible],
  );

  const current = focusedId(focus, columns);

  // Hold the focused id across board reloads. A card that moves column keeps focus;
  // without this the index points at whatever task slid into that row.
  const held = useRef<string | null>(null);
  useEffect(() => {
    if (current) held.current = current;
  }, [current]);
  useEffect(() => {
    if (!held.current || current === held.current) return;
    const found = locate(held.current, columns);
    if (found) setFocus(found);
  }, [columns, current]);

  // Move real DOM focus, or the shortcuts work and assistive tech is left behind.
  useEffect(() => {
    if (!current) return;
    const el = document.querySelector<HTMLElement>(`[data-tm-card="${current}"]`);
    el?.focus({ preventScroll: false });
  }, [current]);

  const handler = useCallback(
    (event: KeyboardEvent) => {
      const intent = resolve(event, { typing: isTypingTarget(event.target as HTMLElement), modal });
      if (!intent) return;

      // Only now: an unhandled key must reach the browser untouched.
      const claim = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      switch (intent.action) {
        case "palette":
          claim();
          return onPalette();
        case "blur":
          claim();
          return (event.target as HTMLElement)?.blur();
        case "escape":
          claim();
          setFocus(null);
          return onEscape();
        case "create":
          claim();
          return onCreate();
        case "search":
          claim();
          return onSearch();
        case "help":
          claim();
          return onHelp();
        case "down":
        case "up":
        case "left":
        case "right":
        case "first":
        case "last": {
          claim();
          const next = move(focus, intent.action, columns);
          return setFocus(next);
        }
        default:
          break;
      }

      // Everything below acts on a card, so it needs one.
      if (!current) return;
      claim();
      switch (intent.action) {
        case "open":
          return onOpen(current);
        case "status":
          return onTransition(current, intent.status as Status);
        case "select":
          return onSelect(current);
        case "watch":
          return onWatch(current);
        case "rankUp":
        case "rankDown": {
          const ids = columns[focus!.column];
          const step = intent.action === "rankUp" ? -1 : 1;
          const neighbour = ids[focus!.row + step];
          // Nothing to swap with at the end of a column — say nothing, do nothing.
          if (!neighbour) return;
          return onRank(current, neighbour, step < 0 ? "before" : "after");
        }
        default:
          return;
      }
    },
    [columns, current, focus, modal, onCreate, onEscape, onHelp, onOpen, onPalette, onRank, onSearch, onSelect, onTransition, onWatch],
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);

  return { focusedId: current, focus, setFocus };
}
