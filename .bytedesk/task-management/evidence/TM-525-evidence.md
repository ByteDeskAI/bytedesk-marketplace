# TM-525 evidence — head d1f8e1ba601ae4474a1378fa558b3ccc300d8ff7 (clean tree)

## Required checks at head
```
npm-ci exit=0
build-check exit=0
validate-ao exit=0
validate-tm exit=0
rsync exit=0
tm-unit exit=1
tm-unit-control origin/main 377e2886 exit=0
ao-unit exit=1
head=d1f8e1ba601ae4474a1378fa558b3ccc300d8ff7
```

## New tests (targeted run)
```
ok 1 - TM-302 restart applies a staged prompt by a read-only relaunch and clears restart_required
ok 2 - TM-302 restart is refused TOPOLOGY_AGENT_BUSY only while a current-incarnation request is in flight
ok 3 - TM-302 a withdrawn or stale-incarnation request does not block a restart
ok 4 - TM-302 the record is marked restarting before the old incarnation ends, so a new request is refused until the relaunch
ok 5 - TM-302 resume on a reviewer is a fresh read-only launch and says so
ok 6 - TM-302 restart refuses an agent that is not the registered reviewer
ok 7 - TM-365 a verdict submitted before a reviewer restart is still collected after it
ok 8 - TM-365 without a submitted verdict, a request sent to a replaced incarnation cannot be collected
ok 9 - TM-525 a worker or the reviewer cannot withdraw a review request; nothing changes
ok 10 - TM-525 after a lead withdraw the restart proceeds, the re-request reaches the new incarnation, and the old one can never be collected
ok 11 - TM-525 a request the reviewer already answered cannot be withdrawn; its verdict is still collected
ok 12 - TM-520: doctor names the live reviewer that lacks review_submit and passes the healthy lead
ok 13 - TM-520: role status carries the same verdict, and "expected none" is explicit
ok 14 - TM-520: a relaunched reviewer whose ao-review child runs is healthy; one whose child died is not
ok 15 - TM-525: with a request pending, doctor names the withdraw, restart, re-request sequence
# tests 15
# pass 15
# fail 0
```

## Unit-suite failures are the dispatched-worker environment (TM-306), not this change
Same session, origin/main 377e2886 control, both suites:
```
task-management unit: head # fail 41 | origin/main # fail 41
failing test names identical: yes
agent-orchestration unit: head # tests 1341 # fail 10  | origin/main # tests 1337 # fail 11 
head failures not on main:
(end)
```
Failure text: 'a dispatched worker cannot grant or change governed task ownership' (worker-identity guard via process tree).
Note: a first origin/main tm-unit control run in this session passed (exit 0) and did not reproduce on rerun (41 fail).
