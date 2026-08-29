Tool: codex exec (codex-cli 0.146.0), text mode, via scripts/codex-exec.sh
Date: 2026-08-28
Requested by: Ryan Helms (via team-lead)
Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r5-q3.png — codex image_gen, prompt at prompts/r5-q3.txt in that run
Authority: ~/Documents/GitHub/ByteDeskAI/design-system @ 9845b41 (1 uncommitted change) — tokens/css/bytedesk.css vendored to surfaces/tokens/design.css (.source-sha)
Logical size: 1280×800 (mockup 1586×992, scale 1.2391)
Status: surface = measured translation; mockup = direction only, not a pixel source

## Round 1 — build
Hotspots (raw): 17,6 14,7 18,6 15,7 16,5 14,4 15,4 16,7 — all inside the stage rect (fog image). Skipped per loop rule.
Masked-stage compare (translate/mockup-stage-masked.png): hotspots 26,18 24,18 23,18 27,16 = Brief paragraph (mockup drew it in mono; surface uses sans per the authority — text speckle, skipped); 7,3 lumDiff 0.113 = Connect buttons: agent rows 13px low, provider rows 5px low (probe: mockup name bands 57/85/112/140, surface 70/97/125/152). Cause: Codex read the spec's row centres as tops.
Scores: layoutScore 0.9797 (raw) / 0.9922 (masked). pixelDiff vs mockup 0.0996 — not a gate number.

## Round 2 — patch
Change: .agent-row tops 60/87/115/142 → 47/74/102/129; .provider-row tops 174/200 → 168/193. Six lines changed, verified by diff. Everything else frozen.
Scores: layoutScore 0.9799 (raw) / 0.9924 (masked). Moved 0.0002 < 0.005; top non-text hotspot gone. STOP.
Not attempted: mono→sans on Brief/Conversation would raise the score but contradict the authority (mono only for paths/ids/versions).

## Implementation gate — http://127.0.0.1:4174 (Vite dev shell, no Tauri backend)
pixelDiff 0.1112 at --threshold 16 (gate is 0.01). FAIL — but read it: the browser shell mounts no solution, no projects, no Git section, no run, so most of the diff is absent content, not drifted CSS. The structural drift measured against the shell's chrome is in RESULT.md.
