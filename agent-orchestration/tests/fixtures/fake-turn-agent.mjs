#!/usr/bin/env node
// TM-280 test stand-in: an interactive agent that has TURNS. While a turn runs it shows the busy line
// census.mjs recognises ("… (1s · esc to interrupt)"); when the turn ends it erases that line in place
// (so it never scrolls into the captured tail) and logs `turn-end`. Every line typed into it is logged
// with the phase it arrived in, so a test can prove nothing was typed mid-turn.
//
//   FAKE_TURN_LOG          JSONL event log (shared by every incarnation; entries carry the pid)
//   FAKE_TURN_START_BUSY_MS  begin mid-turn for this long
//   FAKE_TURN_BUSY_MS      each ordinary line typed in starts a turn this long
//   FAKE_TURN_HANDOFF=1    answer a handoff request by writing the file (tmp + rename)
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

const LOG = process.env.FAKE_TURN_LOG;
const log = (entry) => { if (LOG) appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...entry })}\n`); };
let busyUntil = 0;
let timer = null;
function turn(ms) {
  if (!(ms > 0)) return;
  busyUntil = Date.now() + ms;
  process.stdout.write("\r✻ Thinking… (1s · esc to interrupt)");
  clearTimeout(timer);
  timer = setTimeout(() => { busyUntil = 0; process.stdout.write("\r\x1b[K> "); log({ event: "turn-end" }); }, ms);
}

log({ event: "start", session: process.env.AO_SESSION ?? null });
process.stdout.write("fake-turn ready\n> ");
turn(Number(process.env.FAKE_TURN_START_BUSY_MS ?? 0));

createInterface({ input: process.stdin, terminal: false }).on("line", (line) => {
  log({ event: "received", phase: Date.now() < busyUntil ? "busy" : "idle", line });
  if (line.trim() === "/exit") { log({ event: "exit" }); process.exit(0); }
  const handoff = /to (\S+)\.tmp, then rename/.exec(line);
  if (handoff) {
    if (process.env.FAKE_TURN_HANDOFF === "1") {
      mkdirSync(dirname(handoff[1]), { recursive: true });
      writeFileSync(`${handoff[1]}.tmp`, `## Goal\nfinish the widget\n## State\nhalf done by pid ${process.pid}\n## Open questions\nnone\n## Files\n- src/widget.mjs\n`);
      renameSync(`${handoff[1]}.tmp`, handoff[1]);
      process.stdout.write("DONE\n> ");
    }
    return;
  }
  turn(Number(process.env.FAKE_TURN_BUSY_MS ?? 0));
});
