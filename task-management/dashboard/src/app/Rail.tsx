import { KanbanSquare } from "lucide-react";
import { Link, useLocation } from "../lib/router";
import { useBoard } from "../lib/store";
import { ROUTES } from "./routes";

/** Left rail: icons, labels at ≥1600 px, a bottom tab bar on phones (shell.css). */
export function Rail() {
  const { path, background } = useLocation();
  const board = useBoard();
  const current = background ?? path;
  const inProgress = board?.tasks.filter((t) => t.status === "in_progress").length ?? 0;
  return (
    <nav className="tm-rail" aria-label="screens">
      <div className="tm-rail__brand">
        <KanbanSquare size={20} />
        <span>{board?.project ?? "task-management"}</span>
      </div>
      {ROUTES.filter((r) => r.nav).map((r) => {
        const Icon = r.icon!;
        const active = current === r.pattern || current.startsWith(`${r.pattern}?`);
        return (
          <Link key={r.pattern} to={r.pattern} className="tm-rail__item" data-nav={r.nav} aria-current={active ? "page" : undefined} title={r.title} aria-label={r.title}>
            <Icon size={18} />
            <span>{r.title}</span>
            {r.pattern === "/sessions" && inProgress > 0 && <span className="tm-rail__count" aria-label={`${inProgress} in progress`}>{inProgress}</span>}
          </Link>
        );
      })}
      <span className="tm-rail__spacer" />
    </nav>
  );
}
