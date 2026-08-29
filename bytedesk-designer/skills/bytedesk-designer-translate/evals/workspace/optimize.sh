#!/usr/bin/env bash
# Run the skill-creator description optimiser from the repo root (trusted .claude/), so the
# temporary command file it writes is actually loaded by `claude -p`.
SC=/home/ryan/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator
W=/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-designer/skills/bytedesk-designer-translate/evals/workspace
cd /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-designer
PYTHONPATH=$SC exec python3 -m scripts.run_loop --eval-set $W/trigger-eval.json --skill-path skills/bytedesk-designer-translate --model claude-opus-5 --max-iterations 5 --verbose
