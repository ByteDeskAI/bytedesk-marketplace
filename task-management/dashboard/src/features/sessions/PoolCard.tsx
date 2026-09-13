/**
 * What the dispatch pool is doing, and the switch (TM-188).
 *
 * Reads `GET /api/pool`, which is the object `tm pool status` prints — so the board and the
 * terminal cannot disagree about whether the pool is running. The wording below deliberately
 * echoes `poolLine` in lib/dispatch/pool.mjs for the same reason.
 *
 * The toggle writes `dispatch.enabled` through `POST /api/settings`, the one route that already
 * validates the field and calls `ensurePool` — so switching it on here starts the pool now, and
 * off stops it within one poll. There is no pool-specific write route, and adding one would be a
 * second way to change the same setting.
 */
import { Bot } from "lucide-react";
import { Chip } from "../../components/ui/Chip";
import { Progress } from "../../components/ui/Progress";
import { Toggle } from "../../components/ui/Toggle";
import { fetchPool, write } from "../../lib/api";
import { useNow, useWrite } from "../../lib/store";
import type { Pool } from "../../lib/types";
import { Loaded, ago, useAsync } from "../ops/shared";

/** Running, paused, off, or between polls — one sentence, in the pool's own words. */
function state(pool: Pool, now: number): { tone: "ok" | "warn" | "bad" | undefined; word: string; detail: string } {
  if (!pool.enabled) return { tone: undefined, word: "off", detail: "nothing is picked up until this is on" };
  if (pool.paused) {
    return {
      tone: "bad",
      word: "paused",
      detail: `${pool.pausedReason ?? "no reason recorded"} — ${pool.failures} failure${pool.failures === 1 ? "" : "s"} in a row; \`tm pool resume\` clears it`,
    };
  }
  if (pool.running) {
    return { tone: "ok", word: `running (pid ${pool.pid})`, detail: pool.started ? `started ${ago(pool.started, now)}` : "started" };
  }
  return { tone: "warn", word: "not running", detail: "the next session, prompt or dispatch.* change starts one" };
}

export function PoolCard() {
  const now = useNow();
  const { run, pending } = useWrite();
  // `now` ticks every 15 s, so a pool that starts or stops shows up here within one tick — shorter
  // than the 30 s default poll the pool itself runs on. Store events are not enough: the pool
  // starting writes no store event.
  const pool = useAsync(fetchPool, [now]);

  return (
    <Loaded q={pool} rows={2}>
      {(d) => {
        const s = state(d, now);
        return (
          <section className="tm-sessions__wip tm-sessions__pool" aria-label="dispatch pool">
            <div className="tm-row">
              <Bot size={16} aria-hidden />
              <span className="tm-caps">Pool</span>
              <Chip tone={s.tone} dot>{s.word}</Chip>
              <span className="tm-id">{d.workers} / {d.poolWip} working</span>
              <Chip kind="count" title="tasks the pool could pick up right now">{d.poolable} ready</Chip>
              <span className="tm-grow" />
              <Toggle
                checked={d.enabled}
                disabled={pending}
                onChange={(v) =>
                  void run(() => write.settings({ "dispatch.enabled": v }), { ok: `pool ${v ? "on" : "off"}` }).then(pool.reload)
                }
              >
                let the pool pick up work
              </Toggle>
            </div>
            <Progress value={d.workers} max={d.poolWip} label={`${d.workers} of ${d.poolWip} workers`} tone={d.workers < d.poolWip ? "ok" : undefined} />
            <p className="tm-muted">{s.detail}</p>
            <p className="tm-muted tm-sessions__poolmeta">
              polls every {d.pollSeconds}s · {d.idleExitMinutes > 0 ? `exits after ${d.idleExitMinutes}m idle` : "never exits when idle"} ·{" "}
              <span className="tm-id" title={d.log}>{d.log}</span>
            </p>
          </section>
        );
      }}
    </Loaded>
  );
}
