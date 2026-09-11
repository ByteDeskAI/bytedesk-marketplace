#!/usr/bin/env python3
"""Acceptance for the Presence role-icon extension (marketplace TM-168). Stdlib only.

    python3 check.py                     # the fixture acceptance below
    python3 check.py --snapshot a.json   # the role-icon rules alone, over a produced snapshot

Two gates, because neither is enough on its own:

  * the schema validator for the fixture's declared version, UNMODIFIED — the frozen
    ../presence-v1/validate_presence.py for schemaVersion 1, ../presence-v2/validate_presence_v2.py
    for 2. Every h*.json must pass it: roleIcon and roleLabel are additive keys.
  * the role-icon rules in this file. The frozen validator has no key whitelist, so it cannot see a
    wrong icon, an icon with escape bytes, or an icon without its accessible label. Those rules are
    here, and ../presence-role-icon/role-icon-map.json (generated from the registry) is their source.

Every n*.json must be REJECTED, and by the gate this file expects, for the reason it expects. For the
negatives the rules catch, this file also requires the frozen validator to ACCEPT them — that is the
evidence the rules are necessary rather than decorative.
"""
import json, re, subprocess, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
FROZEN = HERE.parent / "presence-v1" / "validate_presence.py"
V2 = HERE.parent / "presence-v2" / "validate_presence_v2.py"
MAP = json.loads((HERE / "role-icon-map.json").read_text(encoding="utf-8"))
# C0, DEL and C1: every byte a terminal treats as the start of a control or escape sequence.
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
PAIRS = {v["roleIcon"]: v["roleLabel"] for v in [*MAP["roles"].values(), MAP["nestedTeam"], MAP["unknown"]]}

# gate, and a substring its output must contain. A new negative must be declared here.
NEGATIVES = {
    "n01-icon-as-repo-role.json": ("frozen", "repoRole"),
    "n02-lead-icon-on-worker.json": ("rules", "does not match the derivation"),
    "n03-escape-in-icon.json": ("rules", "control character"),
    "n04-icon-without-label.json": ("rules", "roleLabel"),
}


def expected_visual(agent):
    """The wire-level derivation: repoRole "lead" wins, then roleName, then the fallback.

    roleName already carries the run's declared role when the agent is in a run and the library role
    otherwise, so this is the producer's precedence restated over fields a consumer can see. A nested
    team has no pane and therefore no presence entry, so the nested-team icon never derives here.
    """
    effective = "lead" if agent.get("repoRole") == "lead" else agent.get("roleName")
    return MAP["roles"].get(effective, MAP["unknown"]) if isinstance(effective, str) else MAP["unknown"]


def rule_violations(name, snapshot, require_keys):
    fails, checked = [], 0
    for agent in snapshot.get("agents") or []:
        who = f"{name}: {agent.get('agentId', '?')}"
        icon, label = agent.get("roleIcon"), agent.get("roleLabel")
        if icon is None and label is None:
            if require_keys:
                fails.append(f"{who}: carries no roleIcon/roleLabel")
            continue
        checked += 1
        broken = False
        for key, value in (("roleIcon", icon), ("roleLabel", label)):
            if not isinstance(value, str) or not value:
                fails.append(f"{who}: {key} must be a non-empty string whenever either role-visual key is present")
                broken = True
            elif CONTROL.search(value):
                fails.append(f"{who}: {key} contains a control character (terminal escape data)")
                broken = True
        if broken:
            continue
        if PAIRS.get(icon) != label:
            fails.append(f"{who}: ({icon!r}, {label!r}) is not a registry pair")
            continue
        want = expected_visual(agent)
        if (icon, label) != (want["roleIcon"], want["roleLabel"]):
            fails.append(f"{who}: roleIcon {icon!r} does not match the derivation — repoRole "
                         f"{agent.get('repoRole')!r}, roleName {agent.get('roleName')!r} gives {want['roleIcon']!r}")
    return fails, checked


def validate(tool, path):
    return subprocess.run([sys.executable, str(tool), str(path)], capture_output=True, text=True)


def schema_tool(snapshot):
    return FROZEN if snapshot.get("schemaVersion") == 1 else V2


def acceptance():
    for tool in (FROZEN, V2):
        if not tool.is_file():
            print(f"FAIL missing validator {tool}")
            return 1
    positives, negatives = sorted(HERE.glob("h*.json")), sorted(HERE.glob("n*.json"))
    if len(positives) < 2 or len(negatives) < 3 or len(MAP["roles"]) < 10:
        print(f"FAIL fixture set incomplete: {len(positives)} h, {len(negatives)} n, {len(MAP['roles'])} mapped roles")
        return 1

    failures = []
    for path in positives:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        tool = schema_tool(snapshot)
        result = validate(tool, path)
        if result.returncode != 0:
            failures.append(f"{path.name}: rejected by {tool.name}:\n{result.stdout}{result.stderr}")
        if validate(V2, path).returncode != 0:
            failures.append(f"{path.name}: rejected by the v2 validator; a v2 consumer must read it")
        fails, checked = rule_violations(path.name, snapshot, require_keys=True)
        failures += fails
        if not fails:
            print(f"  ok  {path.name}: {tool.name} accepts it and the role-icon rules pass for {checked} agent(s)")

    for path in negatives:
        expectation = NEGATIVES.get(path.name)
        if not expectation:
            failures.append(f"{path.name}: no declared expectation; add it to NEGATIVES")
            continue
        gate, reason = expectation
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        frozen = validate(FROZEN, path)
        if gate == "frozen":
            if frozen.returncode == 0:
                failures.append(f"{path.name}: expected the frozen validator to REJECT it, it passed")
            elif reason not in frozen.stdout:
                failures.append(f"{path.name}: rejected by the frozen validator, but not for {reason}:\n{frozen.stdout}")
            else:
                print(f"  ok  {path.name}: the frozen validator rejects it on {reason}")
            continue
        if frozen.returncode != 0:
            failures.append(f"{path.name}: the frozen validator rejected it, so it does not show the rules are needed:\n{frozen.stdout}")
        fails, _ = rule_violations(path.name, snapshot, require_keys=False)
        if not fails:
            failures.append(f"{path.name}: expected the role-icon rules to REJECT it, they passed")
        elif not any(reason in f for f in fails):
            failures.append(f"{path.name}: rejected by the rules, but not for {reason!r}: {fails}")
        else:
            print(f"  ok  {path.name}: the frozen validator accepts it and the role-icon rules reject it ({reason})")

    for line in failures:
        print("FAIL", line)
    print(f"\n{len(failures)} failure(s)" if failures else "\nrole-icon extension conforms; the frozen and v2 validators are unmodified")
    return 1 if failures else 0


def snapshots(paths):
    failures, total = [], 0
    for arg in paths:
        path = pathlib.Path(arg)
        fails, checked = rule_violations(path.name, json.loads(path.read_text(encoding="utf-8")), require_keys=True)
        failures += fails
        total += checked
    for line in failures:
        print("FAIL", line)
    if failures:
        return 1
    print(f"ok — role-icon rules pass for {total} agent(s) in {len(paths)} snapshot(s)")
    return 0 if total else 1


if __name__ == "__main__":
    if sys.argv[1:2] == ["--snapshot"]:
        sys.exit(snapshots(sys.argv[2:]))
    sys.exit(acceptance())
