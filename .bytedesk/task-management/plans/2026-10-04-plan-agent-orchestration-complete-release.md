# Plan: finish every open agent-orchestration task and release a complete plugin

Scope (ADR-0038): everything, including EP-026 (NATS-native coordination) and EP-025 (gateway console).
Credential scheme (ADR-0039): adopt the per-agent scheme from nats/integration (PR #179).

Wave 0 unblock: land PR #179 (closes TM-310/312/315/326/327/328/329/330 and resolves TM-335); TM-307, TM-308, TM-309; green suite (TM-293, 306/205, 256, 254, 262); TM-331, TM-334.
Wave 1 features and EP-019 hardening, in parallel on top of #179: TM-271, 275, 278, 314, reviewer, lead/supervisor, task-management items.
Wave 2 governed landing autonomy (EP-024), ending with TM-253.
Wave 3 managed services on every OS (EP-023): human merge of PRs #142, #143, TM-289; TM-282, 317, 288.
Wave 4 EP-026 remainder: TM-316, 332, 333, 311, 313/319, 318.
Wave 5 gateway console (EP-025): TM-226, 227, 228, 229, 230.
Wave 6 release, only with Ryan's go-ahead: clean-worktree suite, own-ecosystem version markers (no Claude-side version), dist rebuild, plain plugin validate, fresh-clone check, live acceptance.

Rules: workers finish at a PR, humans merge; landings need a fresh independent faro review; no deploy, tag or publish without separate authorization.
