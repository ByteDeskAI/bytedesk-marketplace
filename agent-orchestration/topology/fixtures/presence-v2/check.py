#!/usr/bin/env python3
"""Acceptance for Presence **v2** (marketplace TM-137). Stdlib only.

    python3 check.py

Three claims, each a command rather than an opinion, so neither repository needs the other's
toolchain to check them:

  1. the FROZEN v1 validator REJECTS every v2 fixture   -> opening a vocabulary really is v2
  2. the v2 validator ACCEPTS every v2 fixture          -> v2 says what it means to say
  3. BOTH validators ACCEPT the unchanged v1 fixture    -> a v2 consumer keeps parsing v1

Claim 1 is the one that matters. "This needs a version bump" is only a real claim if the frozen
validator is shown to go red for it, on files that differ from a passing v1 snapshot by the role
values and the version number and nothing else.

Claim 3 is the obligation from PRESENCE-HEADER-ADDENDUM.md section 9.6 expressed as a file instead
of a sentence.
"""
import subprocess, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
FROZEN = HERE.parent / "presence-v1" / "validate_presence.py"
V2 = HERE / "validate_presence_v2.py"


def run(validator, paths):
    return subprocess.run([sys.executable, str(validator), *[str(p) for p in paths]],
                          capture_output=True, text=True)


def main():
    for tool in (FROZEN, V2):
        if not tool.is_file():
            print(f"FAIL missing validator {tool}")
            return 1
    v2_only = sorted(HERE.glob("v0[12]*.json"))
    v1_compat = sorted(HERE.glob("v03*.json"))
    if len(v2_only) < 2 or len(v1_compat) < 1:
        print(f"FAIL fixture set incomplete: {len(v2_only)} v2, {len(v1_compat)} v1-compat")
        return 1

    failures = []

    # 1. the frozen validator must go RED on each v2 fixture, individually.
    for path in v2_only:
        if run(FROZEN, [path]).returncode == 0:
            failures.append(f"frozen v1 validator ACCEPTED {path.name}; then this is not a v2 change")

    # 2. the v2 validator must go GREEN on them.
    result = run(V2, v2_only)
    if result.returncode != 0:
        failures.append(f"v2 validator rejected its own fixtures:\n{result.stdout}{result.stderr}")

    # 3. both validators must accept the unchanged v1 snapshot.
    for name, tool in (("frozen v1", FROZEN), ("v2", V2)):
        if run(tool, v1_compat).returncode != 0:
            failures.append(f"{name} validator rejected an unchanged v1 snapshot; v2 must keep parsing v1")

    for line in failures:
        print("FAIL", line)
    if failures:
        return 1
    print(f"ok — frozen v1 rejects {len(v2_only)} v2 fixture(s), v2 accepts them, "
          f"and both accept {len(v1_compat)} unchanged v1 snapshot(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
