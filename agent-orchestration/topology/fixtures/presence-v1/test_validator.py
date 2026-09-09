#!/usr/bin/env python3
"""Negative tests for validate_presence.py — the checks seven positive fixtures cannot provide.

    python3 test_validator.py

Gateway TM-222 found three defects that every valid fixture passed straight over. A validator is
only worth its green tick if it is proven to go red, so each case below asserts a REJECTION, and
the cross-digit ordering case asserts an ACCEPTANCE that was previously a false alarm.
"""
import copy, json, pathlib, sys
import validate_presence as V

HERE = pathlib.Path(__file__).resolve().parent
ONE = json.loads((HERE / "01-exact-match.json").read_text())
SIX = json.loads((HERE / "06-membership-removal.json").read_text())

failures = []

def rejects(label, mutate, needle=None):
    d = copy.deepcopy(ONE)
    mutate(d)
    errs = V.check_one("case", d)
    if not errs:
        failures.append(f"{label}: expected a violation, got none")
    elif needle and not any(needle in e for e in errs):
        failures.append(f"{label}: expected {needle!r} in {errs}")
    else:
        print(f"  ok  rejects {label}")

def accepts(label, mutate):
    d = copy.deepcopy(ONE)
    mutate(d)
    errs = V.check_one("case", d)
    if errs:
        failures.append(f"{label}: expected clean, got {errs}")
    else:
        print(f"  ok  accepts {label}")

def setk(k, v):
    return lambda d: d.__setitem__(k, v)

print("counter typing (§2.1)")
rejects("generation as a JSON number", setk("generation", 7), "ASCII decimal digits")
rejects("revision as a JSON number", setk("revision", 417), "ASCII decimal digits")
rejects("generation as a float", setk("generation", 7.0))
rejects("non-ASCII digit U+00B2", setk("generation", "²"))
rejects("non-ASCII digit U+0667", setk("generation", "٧"))
rejects("signed counter", setk("generation", "-1"))
rejects("empty counter", setk("generation", ""))
rejects("counter as null", setk("generation", None))
accepts("multi-digit counter", setk("generation", "1024"))

print("bounds (§2.2)")
rejects("staleAfterMs negative", setk("staleAfterMs", -1), "outside the agreed bound")
rejects("staleAfterMs zero", setk("staleAfterMs", 0), "outside the agreed bound")
rejects("staleAfterMs below floor", setk("staleAfterMs", 999), "outside the agreed bound")
rejects("staleAfterMs above ceiling", setk("staleAfterMs", 300_001), "outside the agreed bound")
rejects("staleAfterMs as bool", setk("staleAfterMs", True), "strict integer")
rejects("skew negative", setk("clockSkewToleranceMs", -1), "outside the agreed bound")
rejects("skew above ceiling", setk("clockSkewToleranceMs", 30_001), "outside the agreed bound")
rejects("skew as bool", setk("clockSkewToleranceMs", False), "strict integer")
accepts("staleAfterMs at floor", setk("staleAfterMs", 1000))
accepts("staleAfterMs at ceiling", setk("staleAfterMs", 300_000))
accepts("skew at zero", setk("clockSkewToleranceMs", 0))

print("depth bound (§4.5)")
def set_depth(n):
    def go(d):
        m = d["agents"][0]["memberships"][0]
        m.update(depth=n, parentRunId="run-parent", rootRunId="run-elsewhere")
    return go
rejects("depth above 64", set_depth(65), "0..64")
rejects("depth as bool", set_depth(True))
accepts("depth 5 — raised --max-depth is legal", set_depth(5))
accepts("depth 64 — the agreed ceiling", set_depth(64))

print("incarnation fields (§4.1)")
rejects("serverPid as bool", lambda d: d["agents"][0]["session"].__setitem__("serverPid", True),
        "positive integer")
rejects("panePid zero", lambda d: d["agents"][0]["session"].__setitem__("panePid", 0))

print("cross-snapshot ordering (§2.1) — the false alarm")
a, b = copy.deepcopy(ONE), copy.deepcopy(SIX)
a["generation"], b["generation"] = "9", "10"          # 10 supersedes 9; text compare said otherwise
errs = V.check_pairs([(pathlib.Path("01-exact-match.json"), a),
                      (pathlib.Path("06-membership-removal.json"), b)])
if any("must supersede" in e for e in errs):
    failures.append(f"generation 9 -> 10 wrongly reported as non-supersession: {errs}")
else:
    print("  ok  generation \"9\" -> \"10\" accepted as supersession")

a2, b2 = copy.deepcopy(ONE), copy.deepcopy(SIX)
a2["generation"], b2["generation"] = "10", "9"        # genuinely backwards; must still be caught
if not any("must supersede" in e for e in V.check_pairs(
        [(pathlib.Path("01-exact-match.json"), a2), (pathlib.Path("06-membership-removal.json"), b2)])):
    failures.append("generation 10 -> 9 should be reported as non-supersession")
else:
    print("  ok  generation \"10\" -> \"9\" still caught as backwards")

print()
for f in failures:
    print("FAIL", f)
print(f"{len(failures)} failure(s)" if failures else "all negative tests pass")
sys.exit(1 if failures else 0)
