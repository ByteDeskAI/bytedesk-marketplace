import { useSyncExternalStore } from "react";
import { Keys } from "../components/ui/Kbd";
import { Modal } from "../components/ui/Modal";
import { keymapByGroup, PALETTE_HINT } from "../lib/keys.mjs";

/**
 * The shortcuts sheet `?` opens over whatever screen is up. A module flag rather than shell
 * state so the board (which owns `?` while mounted) can open it without threading a callback
 * through the route table.
 */
let open = false;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };
export function openKeysSheet() { open = true; emit(); }
export function closeKeysSheet() { open = false; emit(); }
const sub = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

type Row = { keys: string[]; label: string };
const pretty = (k: string) => ({ ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Enter: "⏎" })[k] ?? k;

/** The keymap rendered from the same array the handler reads, plus the two shell-wide keys. */
export function KeysGrid() {
  const groups = keymapByGroup() as { group: string; rows: Row[] }[];
  return (
    <div className="tm-keys">
      {groups.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <dl>
            {g.rows.map((r) => (
              <div key={r.label} style={{ display: "contents" }}>
                <dt><Keys keys={r.keys.map(pretty)} /></dt>
                <dd>{r.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section>
        <h3>Everywhere</h3>
        <dl>
          <div style={{ display: "contents" }}><dt><Keys keys={[PALETTE_HINT]} /></dt><dd>command palette</dd></div>
          <div style={{ display: "contents" }}><dt><Keys keys={["Esc"]} /></dt><dd>close the inspector or dialog</dd></div>
        </dl>
      </section>
    </div>
  );
}

export function KeysSheetModal() {
  const isOpen = useSyncExternalStore(sub, () => open);
  return (
    <Modal open={isOpen} onClose={closeKeysSheet} title="Keyboard shortcuts" size="lg">
      <KeysGrid />
      <p className="tm-muted">Shortcuts go quiet while you type in a field or a dialog is up. The full reference, skills and CLI cheatsheet live under Help.</p>
    </Modal>
  );
}
