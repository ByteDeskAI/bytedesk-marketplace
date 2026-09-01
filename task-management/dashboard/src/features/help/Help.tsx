import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Keys } from "../../components/ui/Kbd";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { fetchSkills } from "../../lib/api";
import { keymapByGroup, PALETTE_HINT } from "../../lib/keys.mjs";
import { useMeta } from "../../lib/store";
import { toast } from "../../lib/toast";
import type { Skill } from "../../lib/types";
import type { ScreenProps } from "../../app/routes";
import "../../styles/help.css";

type Row = { keys: string[]; label: string };
const pretty = (k: string) => ({ ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Enter: "⏎" })[k] ?? k;

/** The verbs a person types most. The README has the whole list; this is the cheat sheet. */
const CLI: [string, string][] = [
  ["tm board | next | stale | standup", "read the board (add --json to any of these)"],
  ["tm task new \"<title>\" [--template bug]", "dup-guarded; files under the active epic"],
  ["tm start | done | park | block | unblock <id>", "move a card; done refuses until every criterion is ticked"],
  ["tm ac <id> \"<criterion>\"  ·  tm accept <id> <n>", "acceptance criteria — the gate `done` checks"],
  ["tm evidence <id> <path|->", "attach a log or screenshot as proof"],
  ["tm why <id>  ·  tm graph [--epic EP-1]", "what is really holding a task up; the dependency graph"],
  ["tm find status:open -label:stale", "field:value filters AND together; a leading - negates"],
  ["tm claim | release <id>  ·  tm sweep", "claims across sessions; sweep drops expired ones"],
  ["tm worktree new <id>  ·  tm parallel", "an isolated checkout per task; batches that do not collide"],
  ["tm export md|csv|json  ·  tm doctor --fix", "the board out; repair what is unambiguous"],
  ["tm override \"<why>\"", "bypass exactly one gate, logged"],
];

export default function Help(_: ScreenProps) {
  const meta = useMeta();
  const groups = keymapByGroup() as { group: string; rows: Row[] }[];
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchSkills().then(setSkills).catch((e: Error) => setError(e.message));
  }, []);

  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => toast("ok", "copied", text)).catch(() => toast("warn", "could not copy", text));

  return (
    <div className="tm-screen tm-help">
      <div className="tm-screen__head">
        <div>
          <h1>Help</h1>
          <p>Every shortcut the board answers to, every skill the plugin ships, and the CLI verbs behind both. Shortcuts go quiet while you type in a field or a dialog is up.</p>
        </div>
      </div>

      <section aria-labelledby="h-keys">
        <h2 id="h-keys">Keyboard</h2>
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
      </section>

      <section aria-labelledby="h-skills">
        <h2 id="h-skills">Skills</h2>
        <p className="tm-muted">Type one into Claude Code. Internal skills run inside another skill and are listed for completeness.</p>
        {error && <ErrorPanel title="Skills could not be listed" detail={error} />}
        {!skills && !error && <SkeletonRows rows={5} height={36} />}
        {skills && (
          <ul className="tm-skills" aria-label="skills">
            {skills.map((s) => (
              <li key={s.name} className="tm-skill">
                <div className="tm-row">
                  <code className="tm-skill__cmd">{s.command}</code>
                  <Chip tone={s.userInvokable ? "accent" : undefined} dot={s.userInvokable}>{s.userInvokable ? "invokable" : "internal"}</Chip>
                  <span className="tm-grow" />
                  <Button size="sm" variant="ghost" icon={<Copy size={14} />} aria-label={`copy ${s.command}`} onClick={() => void copy(s.command)} />
                </div>
                <p className="tm-muted">{s.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-cli">
        <h2 id="h-cli">CLI cheatsheet</h2>
        <p className="tm-muted">Run from the repo: <code>.bytedesk/task-management/bin/tm …</code>. Every write here is also a route on this board and a tool over MCP, behind the same gates.</p>
        <dl className="tm-cli">
          {CLI.map(([cmd, what]) => (
            <div key={cmd} style={{ display: "contents" }}>
              <dt><code>{cmd}</code></dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="h-about">
        <h2 id="h-about">About</h2>
        <dl className="tm-about">
          <div style={{ display: "contents" }}><dt>plugin</dt><dd className="tm-id">{meta?.plugin.version ?? "…"}</dd></div>
          <div style={{ display: "contents" }}><dt>store</dt><dd className="tm-id">{meta?.store.base ?? "…"}</dd></div>
          <div style={{ display: "contents" }}><dt>board</dt><dd className="tm-id">{meta?.store.boardId ?? "…"}</dd></div>
          <div style={{ display: "contents" }}><dt>harness</dt><dd className="tm-id">{meta?.harness ?? "no agent CLI is running this board"}</dd></div>
          <div style={{ display: "contents" }}><dt>actor</dt><dd className="tm-id">{meta?.actor ?? "…"}{meta?.session ? ` · ${meta.session}` : ""}</dd></div>
        </dl>
      </section>
    </div>
  );
}
