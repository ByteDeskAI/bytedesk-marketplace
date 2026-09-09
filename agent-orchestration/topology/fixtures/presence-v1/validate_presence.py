#!/usr/bin/env python3
"""Conformance check for Presence v1 (contract revision 3). Stdlib only.

    python3 validate_presence.py [file.json ...]    # defaults to the fixtures beside this file

Both the producer (bytedesk-marketplace TM-128) and the consumer (Gateway TM-222) run this against
the same files, so "we agree on the schema" is a command rather than an opinion.

Per-snapshot checks enforce the envelope, roles, the six-tuple binding and ancestry. Cross-snapshot
checks enforce the three rules the integration review found missing in revision 1: authoritative
replacement, server-incarnation invalidation, and no grouping by resemblance.
"""
import json, re, sys, pathlib

REPO_ROLES = {"lead", "reviewer", "member"}
RUN_ROLES  = {"orchestrator", "worker", "designer", "judge", "reviewer", "researcher", "implementer"}
ENROLLMENT = {"pending", "enrolled", "detached"}
LIFECYCLE  = {"starting", "ready", "busy", "unresponsive", "dead"}
KINDS      = {"spawn", "role-session", "run", "external"}
# lineage.mjs MAX_DEPTH=3 is the DEFAULT limit; --max-depth raises it. 64 is the agreed contract
# bound (§4.5) so producer and consumer reject the same values -- it is not a guess local to here.
DEPTH_MAX = 64
# Agreed practical bounds (§2.2). Outside these a snapshot is invalid, not merely unusual.
STALE_MS_RANGE = (1000, 300_000)
SKEW_MS_RANGE = (0, 30_000)
RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
EXCLUDED = ("token", "tokens", "env", "prompt", "prompts", "messages", "auth",
            "credentials", "diff", "capture")

def is_counter(v):
    """A contract counter is a STRING of ASCII decimal digits (§2.1).

    `str(v).isdigit()` was wrong twice over: it accepted a JSON number (`str(7).isdigit()` is True),
    and `.isdigit()` is true for non-ASCII digits such as '\u00b2' and '\u0667'. Both would have
    reached a consumer that then compared them as text.
    """
    return isinstance(v, str) and v.isascii() and v.isdigit()


def is_int(v):
    """A strict integer. `isinstance(True, int)` is True in Python, so booleans need excluding."""
    return isinstance(v, int) and not isinstance(v, bool)


def order_key(d):
    """Total order across restarts: both components as INTEGERS (§2.1).

    Comparing generation as text put "10" before "9".
    """
    return (int(d["generation"]), int(d["revision"]))


def binding(s):
    """The six-tuple. Identity AND incarnation — see contract §4.1."""
    return (s.get("serverKey"), s.get("serverPid"), s.get("sessionId"),
            s.get("sessionCreated"), s.get("paneId"), s.get("panePid"))

def check_one(path, d):
    fails = []
    def bad(m): fails.append(f"{path}: {m}")

    if d.get("schemaVersion") != 1: bad("schemaVersion must be 1")
    if not re.fullmatch(r"[0-9a-f]{16}", d.get("repositoryKey", "")):
        bad("repositoryKey must be 16 lowercase hex chars")
    for k in ("generation", "revision"):
        if not is_counter(d.get(k)):
            bad(f"{k} must be a STRING of ASCII decimal digits, got {d.get(k)!r} (§2.1)")
    if not RFC3339.match(d.get("generatedAt", "")): bad("generatedAt must be RFC3339 with Z")
    for k, (lo, hi) in (("staleAfterMs", STALE_MS_RANGE), ("clockSkewToleranceMs", SKEW_MS_RANGE)):
        v = d.get(k)
        if not is_int(v):
            bad(f"{k} must be a strict integer (not a boolean), got {v!r}")
        elif not lo <= v <= hi:
            bad(f"{k}={v} outside the agreed bound {lo}..{hi} (§2.2)")
    if "epoch" in d: bad("'epoch' was replaced by 'generation' in revision 2 (§2.1)")
    if not isinstance(d.get("agents"), list):
        bad("agents must be a list"); return fails

    seen = set()
    for a in d["agents"]:
        who = a.get("agentId", "?")
        if not re.fullmatch(r"[0-9a-z]{8}", str(who)): bad(f"agentId {who!r} must be 8 chars")
        if a.get("repoRole") not in REPO_ROLES: bad(f"{who}: repoRole {a.get('repoRole')!r}")
        rr = a.get("runRole")
        if rr is not None and rr not in RUN_ROLES: bad(f"{who}: runRole {rr!r}")
        if a.get("enrollment") not in ENROLLMENT: bad(f"{who}: enrollment {a.get('enrollment')!r}")
        if a.get("lifecycle") not in LIFECYCLE: bad(f"{who}: lifecycle {a.get('lifecycle')!r}")
        for banned in EXCLUDED:
            if banned in a: bad(f"{who}: excluded field {banned!r} present (§5)")

        s = a.get("session") or {}
        if s.get("kind") not in KINDS: bad(f"{who}: session.kind {s.get('kind')!r}")
        for k in ("serverKey", "sessionId", "sessionName", "paneId"):
            if not s.get(k): bad(f"{who}: session.{k} is required")
        for k in ("serverPid", "sessionCreated", "panePid"):
            if not is_int(s.get(k)) or s[k] <= 0:
                bad(f"{who}: session.{k} must be a positive integer (§4.1 incarnation)")

        spawn = s.get("spawn")
        if s.get("kind") == "spawn":
            if not (isinstance(spawn, str) and re.fullmatch(r"[0-9a-f]{7}", spawn)):
                bad(f"{who}: kind=spawn needs a 7-hex spawn, got {spawn!r}")
            elif s.get("sessionName") != f"{who}-{spawn}":
                bad(f"{who}: spawn sessionName must be <agentId>-<spawn>, got {s['sessionName']!r}")
        elif spawn is not None:
            bad(f"{who}: spawn must be null when kind={s.get('kind')}")

        b = binding(s)
        if b in seen: bad(f"duplicate binding {b} — the six-tuple must be unique (§4.1)")
        seen.add(b)

        runs = set()
        for m in a.get("memberships", []):
            depth = m.get("depth")
            if not is_int(depth) or depth < 0 or depth > DEPTH_MAX:
                bad(f"{who}: depth {depth!r} must be an integer in 0..{DEPTH_MAX} (§4.5)")
            if depth == 0:
                if m.get("parentRunId") is not None:
                    bad(f"{who}: depth 0 must have parentRunId null")
                if m.get("rootRunId") != m.get("runId"):
                    bad(f"{who}: a depth-0 run is its own root")
            else:
                if not m.get("parentRunId"): bad(f"{who}: depth>0 needs a parentRunId")
                if m.get("rootRunId") == m.get("runId"):
                    bad(f"{who}: depth>0 must not claim itself as root")
            if not isinstance(m.get("chain"), list) or not m["chain"]:
                bad(f"{who}: chain must be a non-empty list of workflow names")
            runs.add(m.get("runId"))

        prim = a.get("primaryRunId")
        if prim is not None and prim not in runs:
            bad(f"{who}: primaryRunId {prim!r} is not among its memberships")
        if not a.get("memberships") and prim is not None:
            bad(f"{who}: a standing session must have primaryRunId null (§6.1)")
    return fails

def check_pairs(snaps):
    """Cross-snapshot rules from the integration review."""
    fails = []
    by = {p.name: d for p, d in snaps}

    # [R1] 06 is a valid fresh successor of 01 that removes a binding without an empty list.
    a, b = by.get("01-exact-match.json"), by.get("06-membership-removal.json")
    if a and b:
        if order_key(b) <= order_key(a):
            fails.append("06 must supersede 01 by (generation, revision) (§2.1)")
        gone = {binding(x["session"]) for x in a["agents"]} - {binding(x["session"]) for x in b["agents"]}
        if not gone:
            fails.append("06 must DROP at least one binding present in 01 — that is the point (§6/R1)")
        if not any(x["enrollment"] == "detached" for x in b["agents"]):
            fails.append("06 must carry a detached entry as well as an absent one (§6)")
        if not b["agents"]:
            fails.append("06 must be NON-empty — 05 is the empty case")

    # [R2] 07 reuses 01's session/pane ids under a new serverPid: no binding may survive.
    c = by.get("07-server-restart.json")
    if a and c:
        old, new = {binding(x["session"]) for x in a["agents"]}, {binding(x["session"]) for x in c["agents"]}
        if old & new:
            fails.append(f"07 shares bindings with 01 {old & new} — a restart must invalidate every one (§4.1/R2)")
        reused = {(x["session"]["sessionId"], x["session"]["paneId"]) for x in c["agents"]} & \
                 {(x["session"]["sessionId"], x["session"]["paneId"]) for x in a["agents"]}
        if not reused:
            fails.append("07 must REUSE session/pane ids from 01, or it does not test id reuse (R2)")

    # [R6] 03 must hold two unresolved runs that look alike but are not related.
    d = by.get("03-nested-runs.json")
    if d:
        unres = [m for x in d["agents"] for m in x["memberships"] if m["rootRunId"] is None]
        if len(unres) < 2:
            fails.append("03 needs >=2 unresolved-root memberships to test no-grouping-by-resemblance (§6.2/R6)")
        else:
            alike = [(m["runName"], m["depth"], tuple(m["chain"])) for m in unres]
            if len(set(alike)) != 1:
                fails.append("03's unresolved entries must SHARE runName/depth/chain while having different runIds (§6.2)")
            if len({m["runId"] for m in unres}) != len(unres):
                fails.append("03's unresolved entries must have distinct runIds")
        if not any(m["depth"] > 3 for x in d["agents"] for m in x["memberships"]):
            fails.append("03 needs a depth>3 membership — MAX_DEPTH is a default, not a ceiling (§4.5/R4)")

    # [R1] 05 is the degenerate empty case.
    e = by.get("05-empty-clears.json")
    if e and e["agents"]:
        fails.append("05 must have an empty agents list")
    return fails

def main():
    here = pathlib.Path(__file__).resolve().parent
    args = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(here.glob("*.json"))
    snaps, fails = [], []
    for p in args:
        try:
            d = json.loads(p.read_text())
        except Exception as exc:
            fails.append(f"{p}: unreadable — {exc}"); continue
        snaps.append((p, d))
        fails += check_one(p.name, d)
    if len(args) > 1:
        fails += check_pairs(snaps)
    for f in fails: print("FAIL", f)
    if fails:
        print(f"\n{len(fails)} violation(s)"); return 1
    print(f"ok — {len(snaps)} snapshot(s) conform to Presence v1 (contract revision 3)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
