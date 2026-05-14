#!/usr/bin/env python3
"""Run lightweight golden-output checks for design-pattern skill eval prompts."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVALS = ROOT / "evals" / "evals.json"
# ROOT is the self-contained plugin dir inside bytedesk-marketplace; evals/ and bin/
# live directly under it. See BDM-53.


def fail(message: str) -> None:
    raise SystemExit(message)


def load_payload() -> dict:
    with EVALS.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def assert_sections(text: str, sections: list[str], label: str) -> None:
    for section in sections:
        marker = f"## {section}"
        if marker not in text:
            fail(f"{label}: missing section {marker}")


def assert_terms(text: str, terms: list[str], label: str) -> None:
    folded = text.casefold()
    for term in terms:
        if term.casefold() not in folded:
            fail(f"{label}: missing term {term!r}")


def command_output(item: dict, label: str) -> object:
    command = item.get("command")
    if not command:
        fail(f"{label}: command assertion requires top-level command")
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        fail(f"{label}: command failed with {result.returncode}: {result.stderr.strip()}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        fail(f"{label}: command did not emit JSON: {exc}")


def resolve_path(value: object, path: str) -> object:
    current = value
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(current, list):
            current = current[int(part)]
        elif isinstance(current, dict):
            current = current[part]
        else:
            fail(f"Cannot resolve path {path!r}")
    return current


def main() -> int:
    payload = load_payload()
    evals = payload.get("evals", [])
    if not evals:
        fail("evals/evals.json contains no evals")
    for item in evals:
        label = f"eval {item.get('id')}"
        output_path = ROOT / item.get("golden_output", "")
        if not output_path.exists():
            fail(f"{label}: missing golden output {output_path}")
        text = output_path.read_text(encoding="utf-8")
        assertions = item.get("assertions", [])
        if not assertions:
            fail(f"{label}: missing assertions")
        cached_command_output: object | None = None
        for assertion in assertions:
            assertion_type = assertion.get("type")
            if assertion_type == "contains_sections":
                assert_sections(text, assertion.get("sections", []), label)
            elif assertion_type == "contains_terms":
                assert_terms(text, assertion.get("terms", []), label)
            elif assertion_type == "command_json_top_slug":
                if cached_command_output is None:
                    cached_command_output = command_output(item, label)
                collection = resolve_path(cached_command_output, assertion.get("path", ""))
                if not isinstance(collection, list) or not collection:
                    fail(f"{label}: command path did not resolve to a non-empty list")
                expected = assertion.get("slug")
                actual = collection[0].get("slug") if isinstance(collection[0], dict) else None
                if actual != expected:
                    fail(f"{label}: expected top slug {expected!r}, got {actual!r}")
            elif assertion_type == "command_json_contains":
                if cached_command_output is None:
                    cached_command_output = command_output(item, label)
                folded = json.dumps(cached_command_output, sort_keys=True).casefold()
                for term in assertion.get("terms", []):
                    if term.casefold() not in folded:
                        fail(f"{label}: command JSON missing term {term!r}")
            elif assertion_type == "command_json_count_at_most":
                if cached_command_output is None:
                    cached_command_output = command_output(item, label)
                value = resolve_path(cached_command_output, assertion.get("path", "count"))
                if int(value) > int(assertion.get("max", 0)):
                    fail(f"{label}: expected {value} to be <= {assertion.get('max')}")
            else:
                fail(f"{label}: unknown assertion type {assertion_type!r}")
    print(f"Validated {len(evals)} golden evals.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
