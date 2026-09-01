import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { filterCommands } from "../lib/keys.mjs";
import { allCommands, usePaletteVersion, type Command } from "../lib/palette";
import { navigate } from "../lib/router";
import { useBoard } from "../lib/store";
import { ROUTES, routeForId } from "./routes";

/**
 * ⌘K over everything: screens, every entity on the board, and whatever the mounted screen
 * registered (the board: move the focused card). Ranking is keys.mjs filterCommands.
 */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const board = useBoard();
  const version = usePaletteVersion();

  const rows = useMemo<Command[]>(() => {
    const screens: Command[] = ROUTES.filter((r) => r.nav).map((r) => ({ id: r.pattern, label: `Go to ${r.title}`, group: "Screens", run: () => navigate(r.pattern) }));
    const ents: Command[] = [];
    if (board) {
      for (const t of board.tasks) ents.push({ id: t.id, label: t.title, hint: t.status, group: "Tasks", run: () => navigate(routeForId(t.id)!, { inspector: true }) });
      for (const e of board.epics) ents.push({ id: e.id, label: e.title, hint: "epic", group: "Epics", run: () => navigate(routeForId(e.id)!, { inspector: true }) });
      for (const a of board.adrs) ents.push({ id: a.id, label: a.title, hint: "decision", group: "Decisions", run: () => navigate(routeForId(a.id)!, { inspector: true }) });
      for (const c of board.capabilities ?? []) ents.push({ id: c.id, label: c.title, hint: "capability", group: "Capabilities", run: () => navigate(routeForId(c.id)!, { inspector: true }) });
    }
    return [...allCommands(), ...screens, ...ents];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, version]);

  const shown = useMemo(() => (filterCommands(q, rows) as Command[]).slice(0, 60), [q, rows]);
  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  const run = (c: Command) => {
    onClose();
    c.run();
  };

  let lastGroup = "";
  return (
    <Modal open={open} onClose={onClose} size="bare">
      <div className="tm-palette">
        <input
          ref={input}
          className="tm-palette__input"
          placeholder="Type a command, a screen, or an id…"
          aria-label="command palette"
          aria-controls="tm-palette-list"
          aria-activedescendant={shown[cursor] ? `tm-palette-${cursor}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === "Enter" && shown[cursor]) { e.preventDefault(); run(shown[cursor]); }
          }}
        />
        <div className="tm-palette__list" id="tm-palette-list" role="listbox">
          {shown.length === 0 && <div className="tm-palette__empty">Nothing matches “{q}”.</div>}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={`${c.group}:${c.id ?? c.label}:${i}`}>
                {head && <div className="tm-caps tm-palette__group">{head}</div>}
                <button type="button" id={`tm-palette-${i}`} role="option" aria-selected={i === cursor} className="tm-palette__item" onMouseEnter={() => setCursor(i)} onClick={() => run(c)}>
                  {c.id && <span className="tm-id">{c.id}</span>}
                  <span className="tm-truncate">{c.label}</span>
                  {c.hint && <span className="tm-palette__hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
