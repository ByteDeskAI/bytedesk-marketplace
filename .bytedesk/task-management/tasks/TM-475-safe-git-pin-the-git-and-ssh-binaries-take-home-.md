---
id: "TM-475"
kind: "task"
status: "done"
created: "2026-10-05T18:12:54.610Z"
board: "bytedeskai/bytedesk-marketplace"
title: "safe-git: pin the git and ssh binaries, take HOME from the passwd entry, refuse redirected gh config"
epic: "EP-028"
acceptance: [{"text":"git and ssh are resolved through rootOwnedChain (pinned system paths) in both safe-git copies","done":true,"at":"2026-10-09T05:44:48.347Z"},{"text":"GIT_CONFIG_GLOBAL uses the passwd home, not $HOME (test)","done":true,"at":"2026-10-09T05:44:48.859Z"},{"text":"gh compare refuses when http_unix_socket or api_host is set and runs with GH_*/proxy/CA env removed (test)","done":true,"at":"2026-10-09T05:44:49.363Z"}]
evidence: [".bytedesk/task-management/evidence/TM-475-1791524689779.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/241"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T05:44:50.667Z"
comments: [{"author":"main","ts":"2026-10-09T01:24:07.891Z","text":"From the #198 delta review (safe-git level): (1) LIST(cwd) lists drivers in the process cwd, but callers like checkout-repair pass cwd=null and target via -C/--git-dir in args, so the driver listing reads the wrong repo — can cause a spurious exit-128 refusal when the lead's cwd repo sets url.*.insteadOf; (2) GIT_CONFIG_GLOBAL pinned to ~/.gitconfig drops credential helpers configured only in ~/.config/git/config (clean CLONE_FAILED refusal, not data loss)."},{"author":"main","ts":"2026-10-09T05:44:50.279Z","text":"review verdict: approved — independent reviewers rv-241 and rv-241b approved PR #241 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/241 (verdicts delivered to the lead session)."}]
links: [{"type":"relates to","id":"TM-505"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-475-1791524689779.log":{"source":null,"sha256":"915dc758fde0db4a59e5557efff35eaabf6f98342f0c6278a1500873b3f0f8f5","bytes":243,"at":"2026-10-09T05:44:49.780Z"}}
closed: "2026-10-09T05:44:50.657Z"
---

rv-222 final on #226 (LOW): (1) git and ssh still resolve from PATH (~/bin, /home/ryan are user-writable and earlier) while gh is pinned — rule 3; (2) GIT_CONFIG_GLOBAL pin uses os.homedir() which honours $HOME, so a worker-derived env picks the global .gitconfig; use os.userInfo().homedir; (3) gh honours same-UID config.yml http_unix_socket/api_host and GH_HOST/GH_CONFIG_DIR/HTTPS_PROXY/SSL_CERT_FILE env, so a compare can be answered by a worker-served socket; (4) core.attributesFile defaults to $XDG_CONFIG_HOME/git/attributes (informational).