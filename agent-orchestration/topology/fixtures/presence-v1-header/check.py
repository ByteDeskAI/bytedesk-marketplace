#!/usr/bin/env python3
"""Acceptance for the Presence v1 header extension (marketplace TM-136). Stdlib only.

    python3 check.py

Runs the FROZEN validator, unmodified, from ../presence-v1/validate_presence.py:

  * every extended fixture (h*.json) must PASS  -> additive keys are still v1
  * the negative fixture (n*.json) must FAIL    -> opening a closed vocabulary is v2

The second half is the point. "Additive keys are safe" is only a real claim if the same validator
is shown to go red for the change that is NOT additive, on a file that differs by one value.

Neither repository needs the other's toolchain to run this: it is python3 and nothing else, exactly
as the frozen suite is, so "we agree on the extension" is a command rather than an opinion.
"""
import subprocess, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
VALIDATOR = HERE.parent / "presence-v1" / "validate_presence.py"

def run(paths):
    return subprocess.run([sys.executable, str(VALIDATOR), *[str(p) for p in paths]],
                          capture_output=True, text=True)

def main():
    if not VALIDATOR.is_file():
        print(f"FAIL frozen validator missing at {VALIDATOR}"); return 1
    positives = sorted(HERE.glob("h*.json"))
    negatives = sorted(HERE.glob("n*.json"))
    if not positives or not negatives:
        print("FAIL expected at least one h*.json and one n*.json fixture"); return 1

    failures = []
    result = run(positives)
    if result.returncode != 0:
        failures.append(f"extended fixtures rejected by the frozen validator:\n{result.stdout}{result.stderr}")
    else:
        print(f"  ok  frozen validator accepts {len(positives)} extended fixture(s) — additive keys are v1")

    for path in negatives:
        result = run([path])
        if result.returncode == 0:
            failures.append(f"{path.name}: expected the frozen validator to REJECT it, it passed")
        elif "repoRole" not in result.stdout:
            failures.append(f"{path.name}: rejected, but not for its repoRole:\n{result.stdout}")
        else:
            print(f"  ok  frozen validator rejects {path.name} — opening a role vocabulary is v2")

    for f in failures:
        print("FAIL", f)
    print(f"\n{len(failures)} failure(s)" if failures else "\nheader extension conforms; the frozen validator is unmodified")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main())
