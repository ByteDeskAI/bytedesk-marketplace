# TM-294 checks at 832b347d8508711cf68732bb05e5d21027273d41

## npm run test:contract (exit 0)
```
# Subtest: tracked install bundle starts from plugin cwd but resolves only explicit consumerCwd
ok 1 - tracked install bundle starts from plugin cwd but resolves only explicit consumerCwd
# Subtest: packed plugin owns its complete design identity and rejects parent inheritance or payload drift
ok 2 - packed plugin owns its complete design identity and rejects parent inheritance or payload drift
# Subtest: Linux networking attaches to the pinned owner after Bubblewrap changes user namespace
ok 3 - Linux networking attaches to the pinned owner after Bubblewrap changes user namespace
# delayed attachment: net=4026535689, current-user=4026534850, owner-user=4026534848
# delayed attachment: net=4026534862, current-user=4026534844, owner-user=4026534849
# delayed attachment: net=4026534860, current-user=4026536250, owner-user=4026534844
# Subtest: an enrolled repository is activated by an ordinary verb and by a real session start
ok 4 - an enrolled repository is activated by an ordinary verb and by a real session start
# Subtest: an unenrolled repository gets no supervisor from an ordinary verb or a session start
ok 5 - an unenrolled repository gets no supervisor from an ordinary verb or a session start
# Subtest: concurrent activations from linked worktrees leave exactly one supervisor process
ok 6 - concurrent activations from linked worktrees leave exactly one supervisor process
# Subtest: concurrent session starts across linked worktrees converge on one supervisor and one managed lead
ok 7 - concurrent session starts across linked worktrees converge on one supervisor and one managed lead
# Subtest: held mail to an unenrolled destination never starts a lead or a supervisor there
ok 8 - held mail to an unenrolled destination never starts a lead or a supervisor there
# Subtest: a dead managed lead is restarted by its own supervisor, then held cross-repository mail is delivered once
ok 9 - a dead managed lead is restarted by its own supervisor, then held cross-repository mail is delivered once
# Subtest: a live unresponsive lead is left running, unrestarted and unduplicated, while its mail stays held
ok 10 - a live unresponsive lead is left running, unrestarted and unduplicated, while its mail stays held
# Subtest: role icons reach managed panes and title bars; the registered lead wears its icon in a run; ids, names and pane titles stay unchanged; hostile text is inert
ok 11 - role icons reach managed panes and title bars; the registered lead wears its icon in a run; ids, names and pane titles stay unchanged; hostile text is inert
# Subtest: launch → send → wait → status → stop with fake agents in tmux
ok 12 - launch → send → wait → status → stop with fake agents in tmux
# Subtest: a message rung at a deaf pane escalates rather than reporting a delivery
ok 13 - a message rung at a deaf pane escalates rather than reporting a delivery
# Subtest: a pointer stuck in the composer is resubmitted with the submit key alone, never re-typed
ok 14 - a pointer stuck in the composer is resubmitted with the submit key alone, never re-typed
# Subtest: managed shell ignores ambient default-command and an unsignalled timeout is never ready
ok 15 - managed shell ignores ambient default-command and an unsignalled timeout is never ready
# Subtest: observer start commits a v2 attachment only after its own pane acknowledges the current prompt
ok 16 - observer start commits a v2 attachment only after its own pane acknowledges the current prompt
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 188580.505443
```

## build:check + test:unit summary
```
not ok 522 - record-landing records an operator landing that governed completion accepts, without merging
not ok 529 - governed completion accepts a delegated integration record unchanged
not ok 553 - TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
not ok 569 - TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
# tests 994
# pass 986
# fail 4
```
