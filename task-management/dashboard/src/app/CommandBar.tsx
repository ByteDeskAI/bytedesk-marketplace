import { Bell, Command, Moon, Search, Sun, SunMoon } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { TextField } from "../components/ui/Field";
import { Kbd } from "../components/ui/Kbd";
import { Menu } from "../components/ui/Menu";
import { Link, navigate, setQuery, useLocation } from "../lib/router";
import { useBoard, useLive, useMeta } from "../lib/store";
import { setTheme, useTheme, type Theme } from "../lib/theme";
import type { usePwa } from "../pwa/usePwa";

type Pwa = ReturnType<typeof usePwa>;

/** Project, active epic and sprint, live dot, search, notifications, who you are. */
export const CommandBar = forwardRef<HTMLInputElement, { pwa: Pwa; onPalette: () => void }>(function CommandBar({ pwa, onPalette }, searchRef) {
  const board = useBoard();
  const meta = useMeta();
  const live = useLive();
  const theme = useTheme();
  const { path, query } = useLocation();
  const [q, setQ] = useState(query.get("q") ?? "");
  useEffect(() => setQ(query.get("q") ?? ""), [query]);

  const epic = board?.state?.activeEpic ?? null;
  const sprintId = board?.state?.activeSprint ?? null;
  const sprint = board?.sprints.find((s) => s.id === sprintId);
  const sprintText = sprint?.report ? `${sprint.id} ${sprint.report.done}/${sprint.report.committed} pts${sprint.report.unsized ? ` · ${sprint.report.unsized} unsized` : ""}` : sprint?.id;
  const queued = pwa.queue.filter((e) => e.status === "queued").length;
  const refused = pwa.queue.filter((e) => e.status === "failed").length;
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : SunMoon;
  const cycle: Record<Theme, Theme> = { auto: "dark", dark: "light", light: "auto" };

  return (
    <header className="tm-commandbar">
      <span className="tm-commandbar__project">{board?.project ?? "…"}</span>
      {epic ? (
        <Link to={`/epics/${epic}`} inspector><Chip tone="accent" dot>{epic}</Chip></Link>
      ) : (
        <Link to="/epics"><Chip>no active epic</Chip></Link>
      )}
      {sprintText && <Link to={`/sprints/${sprintId}`} inspector><Chip kind="count">{sprintText}</Chip></Link>}
      <form
        className="tm-commandbar__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          // On a list route the query filters in place; anywhere else it is a search.
          const listy = ["/board", "/backlog", "/epics", "/search", "/activity", "/capabilities", "/decisions"].includes(path);
          if (listy) setQuery({ q: q || null });
          else navigate(`/search?q=${encodeURIComponent(q)}`);
        }}
      >
        <TextField
          ref={searchRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search — status:open label:ui, or words"
          aria-label="search"
          leading={<Search size={14} />}
          trailing={<Kbd>/</Kbd>}
        />
      </form>
      <div className="tm-commandbar__end">
        <span className="tm-live" data-live={live} title={live ? "live: the feed is connected" : "reconnecting to the feed"}>
          {live ? "live" : "reconnecting"}
        </span>
        {pwa.stale && <Chip tone="warn" dot>offline copy</Chip>}
        {queued > 0 && <Chip tone="info" dot>{queued} queued</Chip>}
        {refused > 0 && <Link to="/settings#outbox"><Chip tone="bad" dot>{refused} refused</Chip></Link>}
        <Button variant="ghost" size="sm" icon={<Command size={16} />} aria-label="command palette (⌘K)" title="⌘K / Ctrl-K" onClick={onPalette} />
        <Button variant="ghost" size="sm" icon={<ThemeIcon size={16} />} aria-label={`theme: ${theme}`} title={`theme: ${theme} — click to change`} onClick={() => setTheme(cycle[theme])} />
        <Link to="/settings#notifications" aria-label="notifications" title="notifications"><Button variant="ghost" size="sm" icon={<Bell size={16} />} aria-label="notifications" tabIndex={-1} /></Link>
        <Menu
          label="profile"
          trigger={(p) => (
            <button type="button" className="tm-btn" data-variant="ghost" data-size="sm" data-icon="true" aria-label={`you: ${pwa.me ?? meta?.actor ?? "unknown"}`} {...p}>
              <Avatar name={pwa.me ?? meta?.actor ?? "?"} agent={!pwa.me && meta?.actor !== "main"} />
            </button>
          )}
          items={[
            { label: <span className="tm-stack" style={{ gap: 0 }}><strong>{pwa.me ?? "name yourself"}</strong><span className="tm-faint">actor: {meta?.actor ?? "…"} · {meta?.harness ?? "no agent CLI"}</span></span>, onSelect: () => navigate("/settings#identity") },
            "sep",
            { label: "Settings", onSelect: () => navigate("/settings") },
            { label: "Keyboard shortcuts", onSelect: () => navigate("/help") },
          ]}
        />
      </div>
    </header>
  );
});
