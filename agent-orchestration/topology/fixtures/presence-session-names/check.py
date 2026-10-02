#!/usr/bin/env python3
"""Acceptance for the Presence session-names addendum (marketplace TM-274, ADR-0030). Stdlib only.

    python3 check.py                     # the fixture acceptance below
    python3 check.py --snapshot a.json   # the session-name rules alone, over a produced snapshot

Two gates, because neither is enough on its own:

  * the schema validator for the fixture's declared version, UNMODIFIED — the frozen
    ../presence-v1/validate_presence.py for schemaVersion 1, ../presence-v2/validate_presence_v2.py
    for 2. Every h*.json must pass it: the new names change no key, type or vocabulary.
  * the session-name rules in this file: which name shapes the producer may publish for each
    `session.kind`. The frozen validator checks only the legacy spawn shape.

Every n*.json declares how it must fail. `schema` negatives must be REJECTED by the schema validator
for the declared reason. `naive` negatives are the opposite: they are VALID snapshots — both gates
accept them — on which a consumer that reads role or kind out of the session name gets the wrong
answer. They are the evidence for addendum §6: the name is display only.
"""
import json, re, subprocess, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
FROZEN = HERE.parent / "presence-v1" / "validate_presence.py"
V2 = HERE.parent / "presence-v2" / "validate_presence_v2.py"

SEGMENT = r"[a-z0-9]+(?:-[a-z0-9]+)*"
# [team--]node--repo--role--persona: four or five slugged segments joined by "--" (ADR-0030).
NEW_NAME = re.compile(rf"^{SEGMENT}(?:--{SEGMENT}){{3,4}}$")
PRODUCER_MAX = 160   # launch.mjs / spec.mjs assertSessionName
GATEWAY_MAX = 256    # what the gateway accepts; any name longer is invalid whoever made it

# gate, and a substring its output must contain. A new negative must be declared here.
NEGATIVES = {
    "n01-spawn-kind-new-name.json": ("schema", "spawn sessionName must be <agentId>-<spawn>"),
    "n02-lead-name-on-external.json": ("naive", "lead"),
    "n03-workflow-named-reviewer.json": ("naive", "reviewer"),
}


def name_shape(entry):
    """`new`, `legacy-role-session`, `legacy-spawn` or `other`, judged against this entry's own ids."""
    s = entry.get("session") or {}
    name, aid = s.get("sessionName"), entry.get("agentId")
    if not isinstance(name, str):
        return "other"
    if NEW_NAME.fullmatch(name) and len(name) <= PRODUCER_MAX:
        return "new"
    if name == f"ao-{aid}":
        return "legacy-role-session"
    if isinstance(s.get("spawn"), str) and name == f"{aid}-{s['spawn']}":
        return "legacy-spawn"
    return "other"


# The shapes the producer may publish for each kind (addendum §3).
ALLOWED = {
    "role-session": {"new", "legacy-role-session"},
    "run": {"new"},
    "spawn": {"legacy-spawn"},
}


def rule_violations(name, snapshot):
    fails, checked = [], 0
    for entry in snapshot.get("agents") or []:
        who = f"{name}: {entry.get('agentId', '?')}"
        s = entry.get("session") or {}
        kind, sname = s.get("kind"), s.get("sessionName")
        checked += 1
        if not isinstance(sname, str) or not sname or len(sname) > GATEWAY_MAX:
            fails.append(f"{who}: sessionName must be a non-empty string of at most {GATEWAY_MAX} characters")
            continue
        if kind == "external":
            continue   # anything the operator named it; display only
        shape = name_shape(entry)
        if shape not in ALLOWED.get(kind, set()):
            fails.append(f"{who}: kind={kind!r} may not carry a {shape} name {sname!r}")
    return fails, checked


def naive_reading(entry):
    """What a consumer that PARSES the name would conclude — the reading §4.4 forbids.

    Splits a new-style name on "--", takes the role segment, and treats `lead` / `reviewer` as a
    standing role-session. Returns that guess, or None when the name gives it nothing to go on.
    """
    sname = (entry.get("session") or {}).get("sessionName")
    if not isinstance(sname, str) or not NEW_NAME.fullmatch(sname):
        return None
    role = sname.split("--")[-2]
    return {"kind": "role-session", "repoRole": role} if role in ("lead", "reviewer") else None


def naive_contradictions(snapshot):
    out = []
    for entry in snapshot.get("agents") or []:
        guess = naive_reading(entry)
        actual = {"kind": (entry.get("session") or {}).get("kind"), "repoRole": entry.get("repoRole")}
        if guess and guess != actual:
            out.append(f"{entry.get('agentId')}: the name reads as {guess}, presence says {actual}")
    return out


def validate(tool, path):
    return subprocess.run([sys.executable, str(tool), str(path)], capture_output=True, text=True)


def schema_tool(snapshot):
    return FROZEN if snapshot.get("schemaVersion") == 1 else V2


def coverage(positives):
    """The h fixtures must exercise every shape the addendum describes, or a pass proves nothing."""
    entries = [e for _, d in positives for e in d.get("agents") or []]
    shapes = {((e.get("session") or {}).get("kind"), name_shape(e)) for e in entries}
    run_sessions = {}
    for e in entries:
        s = e.get("session") or {}
        if s.get("kind") == "run" and name_shape(e) == "new":
            run_sessions.setdefault((s.get("serverKey"), s.get("sessionId")), set()).add(e.get("agentId"))
    missing = [label for label, ok in (
        ("a new-style role-session", ("role-session", "new") in shapes),
        ("a legacy ao-<id> role-session", ("role-session", "legacy-role-session") in shapes),
        ("a legacy <id>-<7 hex> spawn", ("spawn", "legacy-spawn") in shapes),
        ("an external session", any(k == "external" for k, _ in shapes)),
        ("a one-agent run session", any(len(v) == 1 for v in run_sessions.values())),
        ("a team run session with two or more panes", any(len(v) >= 2 for v in run_sessions.values())),
    ) if not ok]
    return missing


def acceptance():
    for tool in (FROZEN, V2):
        if not tool.is_file():
            print(f"FAIL missing validator {tool}")
            return 1
    positives = [(p, json.loads(p.read_text(encoding="utf-8"))) for p in sorted(HERE.glob("h*.json"))]
    negatives = sorted(HERE.glob("n*.json"))
    failures = [f"fixture set does not cover {m}" for m in coverage(positives)]
    if len(negatives) < 3:
        failures.append(f"fixture set incomplete: {len(negatives)} negatives")

    for path, snapshot in positives:
        tool = schema_tool(snapshot)
        result = validate(tool, path)
        if result.returncode != 0:
            failures.append(f"{path.name}: rejected by {tool.name}:\n{result.stdout}{result.stderr}")
        fails, checked = rule_violations(path.name, snapshot)
        failures += fails
        if result.returncode == 0 and not fails:
            print(f"  ok  {path.name}: {tool.name} accepts it and the session-name rules pass for {checked} agent(s)")

    for path in negatives:
        expectation = NEGATIVES.get(path.name)
        if not expectation:
            failures.append(f"{path.name}: no declared expectation; add it to NEGATIVES")
            continue
        gate, reason = expectation
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        tool = schema_tool(snapshot)
        result = validate(tool, path)
        if gate == "schema":
            if result.returncode == 0:
                failures.append(f"{path.name}: expected {tool.name} to REJECT it, it passed")
            elif reason not in result.stdout:
                failures.append(f"{path.name}: rejected by {tool.name}, but not for {reason!r}:\n{result.stdout}")
            else:
                print(f"  ok  {path.name}: {tool.name} rejects it ({reason})")
            continue
        # naive: a valid snapshot that a name parser misreads.
        if result.returncode != 0:
            failures.append(f"{path.name}: {tool.name} rejected it, so it does not show a VALID snapshot misread:\n{result.stdout}")
        fails, _ = rule_violations(path.name, snapshot)
        failures += fails
        wrong = naive_contradictions(snapshot)
        if not wrong:
            failures.append(f"{path.name}: expected a name parser to misread it, it read every entry correctly")
        elif not any(reason in w for w in wrong):
            failures.append(f"{path.name}: misread, but not on {reason!r}: {wrong}")
        else:
            print(f"  ok  {path.name}: valid, and parsing the name gets it wrong — {wrong[0]}")

    for line in failures:
        print("FAIL", line)
    print(f"\n{len(failures)} failure(s)" if failures else "\nsession-names addendum conforms; the frozen and v2 validators are unmodified")
    return 1 if failures else 0


def snapshots(paths):
    failures, total = [], 0
    for arg in paths:
        path = pathlib.Path(arg)
        fails, checked = rule_violations(path.name, json.loads(path.read_text(encoding="utf-8")))
        failures += fails
        total += checked
    for line in failures:
        print("FAIL", line)
    if failures:
        return 1
    print(f"ok — session-name rules pass for {total} agent(s) in {len(paths)} snapshot(s)")
    return 0 if total else 1


if __name__ == "__main__":
    if sys.argv[1:2] == ["--snapshot"]:
        sys.exit(snapshots(sys.argv[2:]))
    sys.exit(acceptance())
