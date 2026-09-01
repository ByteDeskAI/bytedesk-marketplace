import { Sunrise } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextField } from "../../components/ui/Field";
import { Markdown } from "../../components/ui/Markdown";
import { fetchStandup } from "../../lib/api";
import { setQuery, useLocation } from "../../lib/router";
import { useEvents } from "../../lib/store";
import { CopyButton, Loaded, ScreenHead, useAsync } from "../ops/shared";
import "../../styles/standup.css";

const PRESETS: [string, number][] = [["24h", 24], ["3d", 72], ["7d", 168]];
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
/** datetime-local wants local time without the zone; the URL keeps the ISO instant. */
const human = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
/**
 * The server text is one report: a "# Since <iso>" heading, then "## <group> (n)" sections.
 * The heading is replaced by the formatted line above the columns; the sections split into
 * what moved (finished, in progress) and what did not (stuck, also touched) so a wide canvas
 * reads as two columns instead of one 640 px card.
 */
function split(text: string): { left: string; right: string } {
  const sections = text.replace(/^# [^\n]*\n+/, "").split(/\n(?=## )/);
  const moved = (h: string) => /^## (Finished|Done|In progress|Doing)/i.test(h);
  return { left: sections.filter(moved).join("\n"), right: sections.filter((x) => !moved(x)).join("\n") };
}
const toLocal = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

export default function Standup() {
  const { query } = useLocation();
  const since = query.get("since") ?? "";
  const events = useEvents();
  // Re-render on any status move; standup is derived from the log the feed is tailing.
  const moves = events.filter((e) => e.event === "done" || e.event === "update" || e.event === "create").length;
  const q = useAsync(() => fetchStandup(since || undefined), [since, moves]);
  const empty = (t: string) => /Finished \(0\)[\s\S]*In progress \(0\)[\s\S]*(Stuck|Blocked) \(0\)/.test(t) || !/^- /m.test(t);

  return (
    <div className="tm-screen tm-standup">
      <ScreenHead title="Standup" blurb="Finished, in progress, stuck — with the stop reason on anything that stopped."
        actions={<>
          {PRESETS.map(([l, h]) => <Button key={l} size="sm" variant={!since && l === "24h" ? "primary" : "default"} onClick={() => setQuery({ since: l === "24h" ? null : hoursAgo(h) })}>{l}</Button>)}
          <TextField aria-label="since" type="datetime-local" value={since ? toLocal(since) : ""} onChange={(e) => setQuery({ since: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          {q.data && <CopyButton text={q.data.text} what="standup" label="Copy as markdown" />}
        </>} />
      <Loaded q={q} rows={5}>
        {(d) => (
          <div className="tm-standup__body">
            <p className="tm-muted">since <time dateTime={d.since}>{human(d.since)}</time></p>
            {empty(d.text) ? (
              <EmptyState icon={<Sunrise size={28} />} title={`Nothing moved since ${human(d.since)}`}>Widen the window, or check Activity for writes that did not change a status.</EmptyState>
            ) : (
              <div className="tm-standup__cols">
                {(() => { const { left, right } = split(d.text); return <>
                  <div className="tm-standup__md"><Markdown source={left || "_nothing moved_"} /></div>
                  <div className="tm-standup__md"><Markdown source={right || "_nothing stuck_"} /></div>
                </>; })()}
              </div>
            )}
          </div>
        )}
      </Loaded>
    </div>
  );
}
