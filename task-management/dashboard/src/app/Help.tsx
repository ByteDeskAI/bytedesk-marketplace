import { Keys } from "../components/ui/Kbd";
import { keymapByGroup, PALETTE_HINT } from "../lib/keys.mjs";

type Row = { keys: string[]; label: string };

/** Rendered from the same KEYMAP the handler reads, so this list cannot rot. Stub: FE-ops adds the skills catalog. */
export default function Help() {
  const groups = keymapByGroup() as { group: string; rows: Row[] }[];
  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Help</h1>
          <p>Every shortcut the board answers to. Shortcuts go quiet while you type in a field or a dialog is up.</p>
        </div>
      </div>
      <div className="tm-keys">
        {groups.map((g) => (
          <section key={g.group}>
            <h3 style={{ marginBottom: "var(--tm-s3)" }}>{g.group}</h3>
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
          <h3 style={{ marginBottom: "var(--tm-s3)" }}>Everywhere</h3>
          <dl>
            <div style={{ display: "contents" }}><dt><Keys keys={[PALETTE_HINT]} /></dt><dd>command palette</dd></div>
            <div style={{ display: "contents" }}><dt><Keys keys={["Esc"]} /></dt><dd>close the inspector or dialog</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

const pretty = (k: string) => ({ ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Enter: "⏎" })[k] ?? k;
