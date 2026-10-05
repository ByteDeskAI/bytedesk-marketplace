# TM-302 round 2 — evidence

Commit: 90921961c901d2ac279a3612addfaee2596bb856 (branch tm/TM-302-…, base origin/fix/ao-local-nats-autostart 37918336, merged — no movement). Tree: only pre-existing graft/opencode tool noise uncommitted, not in the commit.

## Restart tests (topology-reviewer-restart.test.mjs)
ok 1 - TM-302 restart applies a staged prompt by a read-only relaunch and clears restart_required
ok 2 - TM-302 restart is refused TOPOLOGY_AGENT_BUSY only while a current-incarnation request is in flight
ok 3 - TM-302 a withdrawn or stale-incarnation request does not block a restart
ok 4 - TM-302 the record is marked restarting before the old incarnation ends, so a new request is refused until the relaunch
ok 5 - TM-302 resume on a reviewer is a fresh read-only launch and says so
ok 6 - TM-302 restart refuses an agent that is not the registered reviewer
# pass 6
# fail 0

Mutation checks: dropping the restarting-mark write fails test 4; dropping the sameIncarnation clause fails tests 2 and 3.

## Read-only busy check against this machine's real inbox (faro c164bf8b) — nothing restarted
```
reviewer c164bf8b session mass-laptop01--bytedesk-marketplace--reviewer--faro pane %222 restarting null
ok     TM-195-770702086b44218c9b30c4e8bb5c441acdad51b6.json state=collected collected=true collection=TOPOLOGY_VERDICT_TIMEOUT sameIncarnation=true
ok     TM-214-6a3cb38083530f771918162cd5cd9045273bbcb2.json state=published collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-214-6c93e69fee0e82d78e86784bcbba7d471912b7ff.json state=published collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-214-8965c3a55f4e620b66dbea1b6d426315f2af998f.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-215-983a44396c24922ae8d188233d6869dc2aaac89d.json state=published collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-215-a592a38c767e0143bc6dd02bdd41badaf4c35872.json state=published collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-215-c14ee60ebcb15a53b1d9100f3f36509d7ec69d8d.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-217-b65c48c75523933bf732cd22f0307630a59822b7.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-217-f69a7f2dabab48a1f68b6d65ab894dac6b354ed9.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-218-0253bde67719552537b63c9e129a7b2c56e31a37.json state=collected collected=true collection=TOPOLOGY_REVIEWER_FINDINGS sameIncarnation=false
ok     TM-218-061104ad09cf2308f57a84996d4051b497cec47f.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-221-321e1c7a6431aaed7eb5fbd43aff1d2185924171.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-224-5229cdaf055e679d7e8aa27652408c6bb85f6411.json state=collected collected=true collection=TOPOLOGY_REVIEWER_FINDINGS sameIncarnation=false
ok     TM-224-6ac58dfc0fb1374ed0362feef2bcdad0db505ca6.json state=failed collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-233-4bdb9a622d975a7c16962577894b5a80dbc2459f.json state=collected collected=true collection=TOPOLOGY_REVIEWER_FINDINGS sameIncarnation=false
ok     TM-234-2edd178e9824dd4fa90c88fa57d7ca721db36f22.json state=published collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-234-4d2974ad08888207f7021bd6959c0f90ee5f0535.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-234-6d02f9595994cf24715f8ac9c8a8443dd8bb9a34.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-234-8f5530a12bddae5ba3ff5d366f054e598b35c921.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-234-92bb318d8c3a9fb8db1d84cec2f9de3e7f8a2de1.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-234-a219445ec21002f0b13a99aab019d447fffc6264.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-240-f20d03bef30f7595eb484260ab8a2b03487a20da.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-241-386da2509e71e9aa36cbfc5bc2f9cff015733040.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-241-44e9fd4998554e99aeeb3468e39609fbd8f6236e.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-241-a7c5196cad7a78c85577136845b54d61e7d3ec70.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-241-b3c9ba70c08f35215af7b738e85b89c8603e90a9.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-242-1b88efedffdc9109bd4f8c2290e68d5015376b47.json state=published collected=false collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-243-3ef226377fe5e55d1b65f2f83216a8574e28b0cc.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-248-da06a4708f08cae65151d9c1a20742801997bfd5.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-248-e357d4dbd215e9600c5d6a9aa2dac75919032d1e.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE sameIncarnation=false
ok     TM-249-207e7e65ee7e93af5b68aaa7ddbed96316c40fe0.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-249-a08c1e2f374341462d7ff9b39f2e1e308f20eaa1.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-257-f981146b11902b26556e28c5176cd460eef56b4d.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE sameIncarnation=false
ok     TM-258-cb1fba3f16e2f79c05976d6d5922c5880ce897a1.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE sameIncarnation=false
ok     TM-263-32b49d7178eb5823555c378a83ef8074da227b74.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-263-cb3658339ac4e95613034d0d9e027c2315585379.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RANGE sameIncarnation=false
ok     TM-264-c3888f807e95eaf56d078b6012e7e3a5fd96fe7b.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=false
ok     TM-276-618d38816ddab2ab76243eda8ee8cfa2b16cfb3d.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE sameIncarnation=true
ok     TM-276-ae921f609634807ae908fd0fb136d348b8f33415.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE sameIncarnation=true
ok     TM-276-d3e88a2f6828056151fc19e15fcd1737249a0d25.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=true
ok     TM-276-f42aba7a2c2e0a98d1bd540a86f8b3acfb971e56.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=true
ok     TM-287-b070c9f8850bc1b268ed7f612041cd3c5c517496.json state=collected collected=true collection=TOPOLOGY_VERDICT_TIMEOUT sameIncarnation=true
ok     TM-287-b561eaec815660314ed2330bcdbdcdfb4b05ca10.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=true
ok     TM-290-3237930758c228d1669fe1b9092e8a855b2c6b52.json state=collected collected=true collection=TOPOLOGY_VERDICT_TIMEOUT sameIncarnation=true
ok     TM-294-832b347d8508711cf68732bb05e5d21027273d41.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=true
ok     TM-295-c3997262535b867d75cec7f0a0ba4110234d2895.json state=collected collected=true collection=TOPOLOGY_REVIEWER_RESPONSE sameIncarnation=true
ok     TM-296-abb2c7f876cf554818761c0e58ff22a22807f661.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-296-d019e0c869becdcf7c8df951ac27c4c2b0fdaac2.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-297-42b3c55413d9147b55dd1e40bcbe070bc43af5ee.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-297-c78aac29502d9fb3a5a0f3aaae57737dbec1c9ed.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-298-0312d24a3738d173d3f97209e3f6979ab5bebeb6.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-298-65700d16ab39860f62d605fd487ac07e53e5e54d.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-299-0085a30c11d0c4c8af28373b3ead6ba3385a176e.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-299-360941bf86f49d77bdaddfe65892959be1b9ea6b.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-299-99da80881e289e0861107a4b7daf1bfbb6be709d.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-299-b447b01bed253065c511a8667194b20f8e95f73b.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-300-1934b60f16de1ea6130b0548114304b457b865bd.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-300-dd2aada7364a9af659b64d24e35c2abf8ae2308d.json state=collected collected=true collection=- sameIncarnation=true
ok     TM-302-fc0cb3865cb38726dd5b33a6380232d0324150aa.json state=collected collected=true collection=- sameIncarnation=true
requests for this reviewer scanned: 59 files; blocking: 0; decision: restart allowed
```
The round-1 predicate would have refused faro on the 6 withdrawn requests (state=published, collection=TOPOLOGY_REVIEWER_RANGE, earlier incarnation).

## Build
npm ci / build / build:check: 0 / 0 / 0; git status clean after build:check (except pre-existing tool noise)

## Contract (TMUX= , private TMUX_TMPDIR)
# pass 19
# fail 0
contract exit=0

## Unit (full)
not ok 532 - record-landing records an operator landing that governed completion accepts, without merging
not ok 539 - governed completion accepts a delegated integration record unchanged
not ok 563 - TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
not ok 579 - TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
# pass 1011
# fail 4
unit exit=1

The same 4 fail on a clean worktree of origin/fix/ao-local-nats-autostart without this change (tracked as TM-293). With TM_DISPATCH_*/TM_ACTOR/TM_SESSION_ID/TM_ROOT unset, topology-management.test.mjs on this branch: 76 ok, 0 not ok (76 tests). After its last test that process stayed open on a leftover handle and was stopped.
