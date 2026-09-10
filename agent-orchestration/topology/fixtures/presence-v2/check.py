#!/usr/bin/env python3
"""Acceptance for Presence **v2** (marketplace TM-137). Stdlib only.

    python3 check.py

Three claims, each a command rather than an opinion, so neither repository needs the other's
toolchain to check them:

  1. the FROZEN v1 validator REJECTS every v2 fixture   -> necessary, but NOT sufficient (see 1b)
  1b. it still rejects them with schemaVersion FORCED BACK TO 1 -> the vocabulary is what closed
  2. the v2 validator ACCEPTS every v2 fixture          -> v2 says what it means to say
  3. BOTH validators ACCEPT the unchanged v1 fixture    -> a v2 consumer keeps parsing v1

Claim 1b is the one that matters, and claim 1 alone is not enough — a defect found in review by the
gateway coordinator, whose reviewer could not confirm what this file asked them to confirm.

A v2 fixture differs from a passing v1 snapshot in TWO ways: the role values and the version number.
So claim 1's rejection is OVERDETERMINED. A version-1 validator refuses anything declaring version 2
by definition, whatever the vocabulary does, and the output cannot tell the two causes apart. As a
proof that the role vocabulary is closed it is circular: it can only ever come back red, so it
carries no information about roles at all.

Claim 1b removes the version as a variable. It rewrites schemaVersion to 1 in a temporary copy,
changing nothing else, and requires the frozen validator to STILL reject — naming the role. That run
CAN come back green: if the vocabulary were open, a v1-declaring snapshot carrying repoRole
"designer" would pass, and this check would fail and tell us the bump is unnecessary. Falsifiable,
where claim 1 was not.

Claim 3 is the obligation from PRESENCE-HEADER-ADDENDUM.md section 9.6 expressed as a file instead
of a sentence.
"""
import json, os, subprocess, sys, tempfile, pathlib

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

    # 1b. Force schemaVersion back to 1 and require the frozen validator to STILL reject, on the
    # ROLE. This is the claim that carries the version bump; claim 1 above cannot, being circular.
    # The mutated copy goes to a temp dir rather than beside the fixtures, because the v2 validator
    # globs *.json in its own directory and a deliberately-invalid snapshot there would fail the
    # suite it is meant to support.
    for path in v2_only:
        snapshot = json.loads(path.read_text())
        snapshot["schemaVersion"] = 1
        with tempfile.TemporaryDirectory() as tmp:
            downgraded = pathlib.Path(tmp) / f"downgraded-{path.name}"
            downgraded.write_text(json.dumps(snapshot, indent=2))
            outcome = run(FROZEN, [downgraded])
            if outcome.returncode == 0:
                failures.append(
                    f"{path.name} with schemaVersion forced to 1 PASSED the frozen v1 validator — "
                    "the role vocabulary is not closed after all, and no version bump is needed")
            elif "schemaVersion" in outcome.stdout:
                failures.append(
                    f"{path.name} downgrade still tripped the schemaVersion check; the copy did not "
                    "neutralise the version, so this run proves nothing about roles")
            elif "Role" not in outcome.stdout and "role" not in outcome.stdout:
                failures.append(
                    f"{path.name} with schemaVersion 1 was rejected, but not for a role:\n{outcome.stdout}")

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
    print(f"ok — frozen v1 rejects {len(v2_only)} v2 fixture(s) AND still rejects each on the role "
          f"alone with schemaVersion forced to 1, v2 accepts them, "
          f"and both accept {len(v1_compat)} unchanged v1 snapshot(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
