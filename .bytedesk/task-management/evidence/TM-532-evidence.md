# TM-532 evidence — commit 0f1c6e2c377952f2cd570d55af609b8072154d02 (clean tree), PR #260

## Required checks (management.required_checks, run at that commit)
- npm-ci: exit 0
- ao-unit: exit 0
- build-check: exit 0
- tm-unit: exit 0
- ao-validate: exit 0
- tm-validate: exit 0
- rsync-tests: exit 0

## agent-orchestration unit summary
```
# tests 1352
# pass 1348
# fail 0
# cancelled 0
# skipped 4

1301:ok 1301 - a supervisor retires itself when the repository it supervises is removed
1302:ok 1302 - a fresh cached proof yields no probe and no ring
1303:ok 1303 - a proof recorded while a caller queued for the probe lock stops it minting or ringing
1304:ok 1304 - every probe records requested_by and reason, and the ring outcome names them too
1305:ok 1305 - a probe is not judged unresponsive before the lead has had one poll interval to see it
1306:ok 1306 - lead status: a responsive lead reports no recovery error, and a resolved checkout alert is cleared
1307:ok 1307 - a duplicate held-mail delivery: dispose before the inbox pull succeeds, and the redelivery is a no-op
1308:ok 1308 - mailbox withdraw accepts --id like send, and the positional form still works
1309:ok 1309 - missing user-bus variables are recovered from the validated canonical runtime
```

## task-management unit summary
```
# tests 1726
# pass 1726
# fail 0
```

## Control (new tests against unfixed source)
6 of 7 new tests fail on the base source; 'a fresh cached proof yields no probe and no ring' passes there because it guards the pre-existing outer check.
