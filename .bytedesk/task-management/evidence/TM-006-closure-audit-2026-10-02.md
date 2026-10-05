# TM-006 closure audit (Bastion lead dc778cb2, 2026-10-02)

Read-only audit of each acceptance criterion against origin/fix/ao-local-nats-autostart (35488ce2; PRs #142-#150 merged there) and recorded evidence. Gateway TM-457: PR #324 merged to develop at 4d51bdf0.

No task can be closed against `main` yet. PRs #142–#150 all merged into `origin/fix/ao-local-nats-autostart` (head 35488ce2), and that branch is not in `origin/main`. Measured against that branch, most acceptance criteria (ACs) are proven, but five tasks still have an AC that is not proven or that the merged code contradicts. Also, no task has its AC boxes ticked in `tm`. Every PR merge commit and every "shipped locally" commit (28907b1, 737b728e, 4a4af11c, 60a33288, 46b33ea4, 4472a744, e2e7fb8d) is an ancestor of the branch. Test paths below are under `agent-orchestration/tests/unit/`.

| Task | Landed by (ancestor?) | ACs | Recommendation |
|---|---|---|---|
| TM-272 | #142 cbff251d (yes) | 1 met: services.test:143 (idempotent), :289 (bad SHA-256 refused). 2 met: live Linux run in comment 10-02 01:04, plus services.test:335. 3 partly met: session host, NATS and supervision all route through ensure (service.mjs:317, nats-local.mjs:149, supervision.mjs:493); hand-run exit 0 is tested at services.test:308. The fallback contradicts the AC (see note 3). 4 **not proven**: no test, and the comment says it was not live-verified. 5 met: services.test:44–72, :261, fake managers at :30. | Keep open: AC4, and decide on AC3 |
| TM-273 | #143 1d960d7b (yes) | 1 **contradicted**: darwin refuses to start a run (see note 4). 2 met: darwin-runtime.test:74, :102. | Keep open until TM-282 (in progress) lands and a real Mac run is recorded |
| TM-277 | #143 (yes) | 1 met: comment 10-02 02:30 (NATS killed, supervisor pids unchanged) and supervision-transport.test:193. 2 met: supervision-transport.test:102. | Close |
| TM-275 | #143, 11d9afad (yes) | 1 and 2 met, same tests as TM-277. 3 **not proven**: no grep of other uncaught NATS calls is in the evidence. | Close as duplicate of TM-277 (TM-288 §2) |
| TM-274 | #144 c3e95bda (yes) | 1 met: session-names.test:34, :65. 2 met: :225, :248. 3 met: :248. 4 met: :119, :151. 5 met: :74 (dotted hostname), :84 (spaces, no remote), :225 (legacy names). | Close |
| TM-270 | #144 (yes) | As written, not met: the `<repo-slug>-<role>` scheme was replaced by ADR-0030 naming, and `roleSessionName` was removed. | Close as superseded by TM-274, not as "met" |
| TM-281 | #145 cdc11e24 (yes) | 1 met: no unscoped kill-server/kill-session in tests/; topology-management.test:295 defaults to the isolated `-S` socket. 2 met: tmux-isolation.test:28, :37, :46. | Close |
| TM-184 | #145 (yes) | 1 and 2 met, as TM-281. 3 **not proven**: no run from inside tmux with TMUX inherited exists in TM-281's comments or evidence. The only run recorded used `TMUX=` (comment 10-02 03:32). | Keep open until that run is added, then close as duplicate |
| TM-256 | #137 5408a65c (on main), plus preflight 382a2f71 (branch only) | 1 met: TM-264 fix c3888f80 is in main. 2 met on the branch only: package.json:49 adds `--import tmux-preflight.mjs`; tmux-isolation.test:20, :64. | Close once the branch reaches main (TM-288 §2) |
| TM-283 | #146 43ae3c14 (yes) | 1, 2 and 3 met: services.test:188, :233. | Close |
| TM-279 | #148 f4b3b8ba (yes) | 1 met: persona-registry.test:244. 2 met: conformance case :114 (release), :275, :309. 3 met: :152. | Close |
| TM-280 | #148 (yes) | 1 met: respawn.test:63. 2 met: :63, :220. 3 met: :117. | Close |
| TM-284 | #149 3547ed7c (yes) | 1 met: setup-self-heal.test:75, :82. 2 met: :113, :126. 3 met: :139. | Close |
| TM-285 | #149 (yes) | 1 met: setup-self-heal.test:192. 2 met: :231, :261. 3 met: :280. 4 met: :302. | Close |
| TM-286 | #149 (yes) | 1 met: services.test:446. 2 met: :469. 3 met: README.md:121, setup SKILL.md:82. | Close |
| Gateway TM-457 | #324 4d51bdf0 (ancestor of origin/develop, yes) | 1 met through ao's process-compose: marketplace TM-272 comment 10-02 01:04 (session host killed, new pid in 2.2s). 2 met: deploy-safe.sh `session_host=` line; `sessionHost` in cutover_terminal_probe.go. 3 met: docs/install.md:246–254. | Close, but see note 2. Status is still `in_progress`; the comment hands bookkeeping to Bastion TM-006. |

**Surprises**

1. **"Merged" means merged into a feature branch, not `main`.** TM-288 §2 says "close after you merge the ao PRs". If that means merged to `main`, it has not happened yet.
2. **Gateway `develop` depends on unreleased ao code.** TM-457 runs `agent-orchestration services ensure`, which exists only on the fix branch. The `services` subcommand does not exist on marketplace `main`, so a gateway built from `develop` against an ao installed from `main` cannot auto-start the session host.
3. **TM-272 AC3 is contradicted by design.** The AC says the old 24-hour systemd scope stays only behind `AGENT_ORCHESTRATION_SERVICES=0`. The code also uses that scope whenever `services ensure` fails, logging a stderr warning (service.mjs:311–337, supervision.mjs:490). Either amend the AC or treat this as a defect.
4. **TM-273 AC1 is contradicted.** On darwin, a run is refused with `AO_SANDBOX_UNAVAILABLE` (provider-sandbox.mjs:679, service.mjs:248; darwin-runtime.test:111). The process-group backend exists, but a worker does not actually start until TM-282 lands.
5. **TM-272 AC4 is the only recovery claim with no proof.** Every unit test sets `autoRecover: false`; only the CLI session host enables it (cli.mjs:50).
6. **Comment typos.** TM-279 and TM-280 have "TM-27280" and "TM-279279"; corrections were posted one minute later.
