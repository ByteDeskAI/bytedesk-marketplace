#!/usr/bin/env bash
# Build the skill-creator review page for one iteration in a way its viewer can read:
#  - eval_metadata.json copied beside each run (the viewer looks in run_dir and its parent)
#  - key with-skill artefacts surfaced flat into outputs/ (the viewer lists only top-level files)
#  - '</' escaped inside the embedded JSON line (an output HTML containing </script> otherwise cuts the page's script short)
set -euo pipefail
I="${1:?iteration dir}"; SC="${2:?skill-creator dir}"; NAME="${3:-skill}"
for run in "$I"/eval-*/*/run-*; do
  [ -d "$run/outputs" ] || continue
  cp "$(dirname "$(dirname "$run")")/eval_metadata.json" "$run/eval_metadata.json"
  for rf in "$run"/outputs/*/; do
    [ -d "$rf" ] || continue
    for f in RESULT.md state.json translate/SPEC.md translate/notes.md; do [ -f "$rf/$f" ] && cp -n "$rf/$f" "$run/outputs/$(basename "$f")" 2>/dev/null || true; done
    for f in "$rf"/surfaces/*.html "$rf"/translate/shots/*.png; do [ -f "$f" ] && cp -n "$f" "$run/outputs/" 2>/dev/null || true; done
    for d in "$rf"/translate/diff/*/; do [ -f "$d/diff.png" ] && cp -n "$d/diff.png" "$run/outputs/diff-$(basename "$d").png" 2>/dev/null || true; done
  done
done
python3 "$SC/eval-viewer/generate_review.py" "$I" --skill-name "$NAME" --benchmark "$I/benchmark.json" --static "$I/review.html" ${PREV:+--previous-workspace "$PREV"} >/dev/null
python3 - "$I/review.html" <<'PY'
import sys
p=sys.argv[1]; lines=open(p).read().split('\n')
for k,l in enumerate(lines):
    if 'const EMBEDDED_DATA' in l: lines[k]=l.replace('</','<\\/')
open(p,'w').write('\n'.join(lines))
PY
echo "$I/review.html"
