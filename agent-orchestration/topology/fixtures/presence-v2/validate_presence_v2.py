#!/usr/bin/env python3
"""Presence **v2** validator. Stdlib only, exactly like the frozen v1 one.

    python3 validate_presence_v2.py <snapshot.json> [...]

v2 opens two closed vocabularies and NOTHING else:

  * ``repoRole``  gains ``designer`` and ``image-gen``
  * ``runRole``   gains ``image-gen``
  * ``schemaVersion`` may be 1 or 2

This file does not reimplement the contract. It IMPORTS the frozen v1 validator and overrides
those two vocabularies, then delegates every remaining rule to the frozen code. That is deliberate:
a forked copy could drift on any of the other rules — the six-tuple, the counters, the bounds, the
pairing — and nobody would notice for months. Here drift is impossible by construction, and the
diff between v1 and v2 acceptance is provably the two sets plus the version number.

A v2 consumer MUST keep parsing v1, so a ``schemaVersion: 1`` snapshot is accepted unchanged.
"""
import copy, importlib.util, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
FROZEN = HERE.parent / "presence-v1" / "validate_presence.py"

V2_REPO_ROLES = {"lead", "reviewer", "member", "designer", "image-gen"}
V2_RUN_ROLES = {"orchestrator", "worker", "designer", "judge", "reviewer", "researcher",
                "implementer", "image-gen"}


def frozen_module():
    spec = importlib.util.spec_from_file_location("presence_v1_frozen", FROZEN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv):
    if not FROZEN.is_file():
        print(f"FAIL frozen v1 validator missing at {FROZEN}")
        return 1
    mod = frozen_module()
    # The only two rules v2 changes. Everything else stays exactly as the frozen file wrote it.
    mod.REPO_ROLES = V2_REPO_ROLES
    mod.RUN_ROLES = V2_RUN_ROLES

    fails, snaps = [], []
    # Default to this directory's own fixtures, exactly as the frozen v1 validator does. Without
    # this the no-argument run iterated NOTHING and printed "ok — 0 snapshot(s)", which reads as a
    # pass and proves nothing: the v2 fixtures had never been checked by the v2 validator at all.
    # `.claude/rules/verification-that-can-fail.md` §1 — a clean result that would look identical
    # if the thing being checked were absent.
    for arg in argv or sorted(HERE.glob("*.json")):
        path = pathlib.Path(arg)
        try:
            document = mod.json.loads(path.read_text())
        except Exception as exc:
            fails.append(f"{path}: unreadable — {exc}")
            continue
        version = document.get("schemaVersion")
        if version not in (1, 2):
            fails.append(f"{path.name}: schemaVersion must be 1 or 2, got {version!r}")
            continue
        # The frozen check_one insists on 1. Hand it a copy that says 1 and check the real version
        # ourselves, so the frozen body still evaluates every OTHER rule verbatim.
        probe = copy.deepcopy(document)
        probe["schemaVersion"] = 1
        snaps.append((path, document))
        fails += mod.check_one(path.name, probe)
    if len(argv) > 1:
        fails += mod.check_pairs([(p, d) for p, d in snaps])
    for f in fails:
        print("FAIL", f)
    if fails:
        print(f"\n{len(fails)} violation(s)")
        return 1
    print(f"ok — {len(snaps)} snapshot(s) conform to Presence v2 (v1 accepted unchanged)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
