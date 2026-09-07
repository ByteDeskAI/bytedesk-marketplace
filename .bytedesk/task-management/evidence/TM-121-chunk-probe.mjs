#!/usr/bin/env node
// One line per stdin read(), which is exactly what a TUI's key handler sees.
//
// The distinction this exists to make visible: text and a carriage return in ONE chunk is a PASTE
// of multiline text, which every modern TUI inserts into its composer; a carriage return arriving
// as its own chunk is the Enter KEY, which submits. `sendText` has to produce the second.
process.stdin.setRawMode?.(true);
process.stdin.resume();
let chunks = 0;
process.stdin.on("data", (buf) => {
  chunks += 1;
  process.stdout.write(`CHUNK ${chunks}: ${JSON.stringify(buf.toString("utf8"))}\r\n`);
});
