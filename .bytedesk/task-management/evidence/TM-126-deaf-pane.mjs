#!/usr/bin/env node
// A pane that is ON but not listening — the state a CLI is in while it starts up.
//
// Raw mode is the load-bearing part. A process that simply ignores stdin (`sleep`) is NOT this:
// the tty's line discipline echoes what is typed at it, so the text appears on the pane anyway and
// any check for it passes. Raw mode turns that echo off, which is what a TUI does the moment it
// takes the terminal — and is why a pointer typed at a CLI mid-startup vanishes without trace.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", () => {});
setTimeout(() => process.exit(0), 60_000);
