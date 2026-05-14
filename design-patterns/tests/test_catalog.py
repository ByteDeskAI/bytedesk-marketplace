from __future__ import annotations

import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PLUGIN = Path(__file__).resolve().parents[1]
ROOT = PLUGIN
sys.path.insert(0, str(PLUGIN / "lib"))

# Isolate pattern-memory side effects: `patterns adr` / `patterns scan` and the
# patterns_* MCP tools now record to a journal. Point both the working directory
# and the global data root at a throwaway dir so test runs never touch the real
# project or per-user memory store. Inherited by the subprocesses below.
_MEMORY_TMP = tempfile.mkdtemp(prefix="dp-test-memory-")
atexit.register(shutil.rmtree, _MEMORY_TMP, ignore_errors=True)
os.environ["CLAUDE_PLUGIN_DATA"] = _MEMORY_TMP
os.environ["PWD"] = _MEMORY_TMP

from pattern_catalog import (
    load_frameworks,
    load_language_profiles,
    load_patterns,
    load_playbooks,
    load_recipes,
    load_scorecards,
    load_smells,
    load_snippets,
    load_taxonomy,
)
from pattern_context import context_pack, decision_simulation, migration_plan
from pattern_graph import catalog_graph, graph_query
from pattern_inference import infer_request_context
from pattern_intelligence import recommend_entries
from pattern_mcp_server import call_tool, tool_definitions
from pattern_scanner import scan_path, scan_text
from pattern_workbench import (
    adr_payload,
    app_html,
    brief_payload,
    coverage_payload,
    filtered_entries,
    graph_payload,
    matrix_payload,
    neighborhood_payload,
    recommendation_payload,
    scan_text_payload,
)


class CatalogTests(unittest.TestCase):
    def test_patterns_include_decision_metadata(self) -> None:
        patterns = {pattern["slug"]: pattern for pattern in load_patterns()}
        strategy = patterns["strategy"]
        self.assertIn("maintainability", strategy["qualityAttributes"])
        self.assertIn("forces", strategy)
        self.assertTrue(strategy["tradeoffNotes"])
        self.assertIn("alternative", strategy["relationshipTypes"])

    def test_python_and_classic_object_pattern_coverage(self) -> None:
        patterns = load_patterns()
        classic_object_patterns = {
            "abstract-factory",
            "adapter",
            "bridge",
            "builder",
            "chain-of-responsibility",
            "command",
            "composite",
            "decorator",
            "facade",
            "factory-method",
            "flyweight",
            "interpreter",
            "iterator",
            "mediator",
            "memento",
            "observer",
            "prototype",
            "proxy",
            "singleton",
            "state",
            "strategy",
            "template-method",
            "visitor",
        }
        object_slugs = {pattern["slug"] for pattern in patterns if "object-design" in pattern.get("groups", [])}
        self.assertTrue(classic_object_patterns <= object_slugs)
        self.assertFalse([pattern["slug"] for pattern in patterns if "python" not in pattern.get("languages", [])])

    def test_playbooks_and_smells_are_loaded(self) -> None:
        playbooks = {playbook["slug"]: playbook for playbook in load_playbooks()}
        smells = {smell["slug"]: smell for smell in load_smells()}
        self.assertIn("event-fanout", playbooks)
        self.assertIn("naive-exactly-once", smells)
        self.assertIn("idempotent-receiver", playbooks["event-fanout"]["patterns"])
        self.assertIn("idempotent-receiver", smells["naive-exactly-once"]["patterns"])

    def test_language_profiles_include_guidance(self) -> None:
        languages = load_language_profiles()
        self.assertIn("MassTransit", languages["csharp"]["integrationStacks"])
        self.assertTrue(languages["typescript"]["implementationNotes"])
        self.assertTrue(languages["go"]["operationalGuidance"])

    def test_frameworks_recipes_and_scorecards_are_loaded(self) -> None:
        frameworks = {framework["slug"]: framework for framework in load_frameworks()}
        recipes = {recipe["slug"]: recipe for recipe in load_recipes()}
        scorecards = {scorecard["slug"]: scorecard for scorecard in load_scorecards()}
        self.assertIn("dotnet-masstransit", frameworks)
        self.assertIn("strategy-refactor", recipes)
        self.assertIn("standard-architecture-decision", scorecards)
        self.assertIn("idempotent-receiver", frameworks["dotnet-masstransit"]["patterns"])
        self.assertIn("strategy", recipes["strategy-refactor"]["patterns"])

    def test_taxonomy_snippets_and_recommendation_intelligence(self) -> None:
        taxonomy = load_taxonomy()
        snippets = {snippet["slug"]: snippet for snippet in load_snippets()}
        self.assertIn("architecture-forces", taxonomy)
        self.assertIn("Variation Point", taxonomy["architecture-forces"]["groups"])
        self.assertIn("csharp-strategy", snippets)
        self.assertIn("python-idempotent-receiver", snippets)

        recommendations = recommend_entries("provider selection leaks into domain code", limit=5)
        self.assertEqual("provider-abstraction", recommendations[0]["slug"])
        self.assertTrue(recommendations[0]["whyMatched"])
        self.assertTrue(recommendations[0]["whyMightBeWrong"])

    def test_cli_search_uses_full_pattern_fields(self) -> None:
        result = subprocess.run(
            [str(PLUGIN / "bin" / "patterns"), "search", "duplicate", "--scope", "integration-design", "--json"],
            cwd=ROOT,
            text=True,
            check=True,
            stdout=subprocess.PIPE,
        )
        payload = json.loads(result.stdout)
        self.assertIn("idempotent-receiver", {item["slug"] for item in payload})

    def test_cli_recommend_and_compare(self) -> None:
        recommend = subprocess.run(
            [str(PLUGIN / "bin" / "patterns"), "recommend", "duplicate delivery repeated side effects", "--json"],
            cwd=ROOT,
            text=True,
            check=True,
            stdout=subprocess.PIPE,
        )
        recommendations = json.loads(recommend.stdout)
        self.assertTrue(recommendations)
        self.assertIn("score", recommendations[0])

        compare = subprocess.run(
            [str(PLUGIN / "bin" / "patterns"), "compare", "strategy", "state", "--json"],
            cwd=ROOT,
            text=True,
            check=True,
            stdout=subprocess.PIPE,
        )
        compared = json.loads(compare.stdout)
        self.assertEqual(["strategy", "state"], [item["slug"] for item in compared])

    def test_cli_second_wave_commands(self) -> None:
        commands = [
            ["adr", "duplicate delivery repeats side effects", "--json"],
            ["graph", "--format", "json"],
            ["graph", "--query", "what mitigates naive exactly once", "--json"],
            ["explain", "strategy", "--json"],
            ["why", "provider selection leaks into domain code", "--json"],
            ["frameworks", "dotnet-masstransit", "--json"],
            ["recipes", "strategy-refactor", "--json"],
            ["scorecards", "standard-architecture-decision", "--json"],
            ["snippets", "strategy", "--json"],
            ["simulate", "duplicate delivery repeats side effects", "--json"],
            ["migrate", "provider-switch-sprawl", "--to", "bridge", "--json"],
            ["context", "data/playbooks/event-fanout.md", "--query", "duplicate delivery", "--json"],
            ["scan", "data/playbooks/event-fanout.md", "--json"],
        ]
        for args in commands:
            with self.subTest(args=args):
                result = subprocess.run(
                    [str(PLUGIN / "bin" / "patterns"), *args],
                    cwd=ROOT,
                    text=True,
                    check=True,
                    stdout=subprocess.PIPE,
                )
                self.assertTrue(json.loads(result.stdout))

    def test_scanner_context_simulation_graph_and_mcp_helpers(self) -> None:
        scan = scan_text("while (true) { Retry(); Consume(order); Publish(order); }")
        self.assertGreaterEqual(scan["count"], 1)
        self.assertIn("unbounded-retry", {finding["smell"] for finding in scan["findings"]})

        repo_scan = scan_path(PLUGIN)
        self.assertFalse([finding for finding in repo_scan["findings"] if finding["file"].startswith("site/")])

        context = context_pack(PLUGIN / "data" / "playbooks" / "event-fanout.md", "duplicate delivery", language="python")
        self.assertIn("Pattern Context Pack", context["markdown"])
        self.assertTrue(context["recommendations"])
        self.assertTrue(context["snippets"])

        simulation = decision_simulation("duplicate delivery repeats side effects", language="python")
        self.assertTrue(simulation["options"])
        self.assertIn("scores", simulation["options"][0])

        migration = migration_plan("provider-switch-sprawl", "bridge")
        self.assertTrue(migration["steps"])
        self.assertIn("Pattern Migration Plan", migration["markdown"])

        graph = catalog_graph()
        self.assertIn("mitigates", graph["edgeTypes"])
        answer = graph_query("what mitigates naive exactly once")
        self.assertTrue(answer["answers"])

        tools = tool_definitions()
        self.assertIn("patterns_context", {tool["name"] for tool in tools})
        self.assertIn("patterns_examples", {tool["name"] for tool in tools})
        self.assertIn("patterns_help", {tool["name"] for tool in tools})
        tool_descriptions = " ".join(tool["description"] for tool in tools)
        self.assertIn("/patterns-recommend", tool_descriptions)
        for tool in tools:
            with self.subTest(tool=tool["name"]):
                self.assertFalse(tool.get("inputSchema", {}).get("required"), f"{tool['name']} should return missing-argument diagnostics instead of schema-blocking calls")
                for argument_name, argument_schema in tool.get("inputSchema", {}).get("properties", {}).items():
                    self.assertTrue(argument_schema.get("description"), f"{tool['name']}.{argument_name}")
                    if argument_schema.get("type") == "array":
                        self.assertTrue(argument_schema.get("items", {}).get("description"), f"{tool['name']}.{argument_name} items")
        mcp_result = call_tool("patterns_simulate", {"query": "duplicate delivery repeats side effects", "language": "python"})
        self.assertTrue(mcp_result["options"])
        examples = call_tool("patterns_examples", {})
        self.assertIn("/patterns-recommend", examples["slashCommands"][0]["command"])
        self.assertIn("/patterns-recommend help", examples["slashCommands"][0]["helpCommand"])
        self.assertEqual("patterns_recommend", examples["slashCommands"][0]["tool"])
        help_index = call_tool("patterns_help", {})
        self.assertIn("patterns-scan", help_index["commands"])
        scan_help = call_tool("patterns_help", {"command": "scan"})
        self.assertTrue(scan_help["found"])
        self.assertEqual("/patterns-scan help", scan_help["help"]["helpCommand"])
        self.assertEqual("patterns_scan", scan_help["help"]["tool"])
        slash_help = call_tool("patterns_help", {"command": "/patterns-scan help"})
        self.assertTrue(slash_help["found"])
        self.assertEqual("patterns-scan", slash_help["command"])

    def test_mcp_infers_optional_parameters_and_reports_missing_intent(self) -> None:
        missing_recommend = call_tool("patterns_recommend", {})
        self.assertFalse(missing_recommend["ok"])
        self.assertEqual("query", missing_recommend["missingArguments"][0]["name"])
        self.assertIn("argumentResolution", missing_recommend)

        scan = call_tool("patterns_scan", {"path": str(PLUGIN / "data" / "playbooks" / "event-fanout.md")})
        self.assertTrue(scan["argumentResolution"]["inferred"])
        self.assertTrue(
            any(item["name"] == "include_docs" and item.get("value") is True for item in scan["argumentResolution"]["inferred"])
        )

        context = call_tool("patterns_context", {"path": str(PLUGIN / "data" / "playbooks" / "event-fanout.md")})
        self.assertIn("architecture guidance for", context["query"])
        self.assertTrue(any(item["name"] == "query" for item in context["argumentResolution"]["inferred"]))

        simulate = call_tool("patterns_simulate", {"query": "production retry outage and dead-letter recovery"})
        self.assertEqual("operability", simulate["risk"])
        self.assertTrue(any(item["name"] == "risk" and item.get("value") == "operability" for item in simulate["argumentResolution"]["inferred"]))

        missing_migration = call_tool("patterns_migrate", {"source": "hardcoded provider switch"})
        self.assertFalse(missing_migration["ok"])
        self.assertEqual("target", missing_migration["missingArguments"][0]["name"])

        snippets = call_tool("patterns_snippets", {"query": "provider selection leaks into domain code"})
        self.assertTrue(snippets["patterns"])
        self.assertTrue(any(item["name"] == "patterns" for item in snippets["argumentResolution"]["inferred"]))

    def test_language_and_scope_are_inferred_when_omitted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pyproject.toml").write_text("[project]\nname = 'sample'\n", encoding="utf-8")
            (root / "app").mkdir()
            (root / "app" / "providers.py").write_text("def select_provider(name):\n    pass\n", encoding="utf-8")
            inference = infer_request_context(
                query="hardcoded provider selection needs a cleaner strategy boundary",
                paths=[str(root / "app")],
            )
            self.assertEqual("python", inference["language"])
            self.assertEqual("object-design", inference["scope"])

            context = call_tool(
                "patterns_context",
                {"path": str(root / "app"), "query": "hardcoded provider selection needs a cleaner strategy boundary"},
            )
            self.assertEqual("python", context["language"])
            self.assertEqual("object-design", context["scope"])
            self.assertTrue(context["inference"]["languageWasInferred"])
            self.assertTrue(context["inference"]["scopeWasInferred"])

    def test_dynamic_workbench_is_plugin_backed(self) -> None:
        self.assertIn("Pattern Workbench", app_html())

        coverage = coverage_payload()
        self.assertTrue(coverage["pythonSupported"])
        self.assertFalse(coverage["missingClassicObjectPatterns"])

        search = filtered_entries({"q": ["duplicate delivery"], "kind": ["pattern"]})
        self.assertIn("idempotent-receiver", {entry["slug"] for entry in search})

        adr = adr_payload("duplicate delivery repeats side effects")
        self.assertTrue(adr["recommendedEntry"])
        self.assertIn("verification", adr)

        graph = graph_payload()
        self.assertTrue(graph["nodes"])
        self.assertTrue(graph["edges"])
        self.assertIn("mitigates", graph["edgeTypes"])

        recommendations = recommendation_payload({"q": ["provider selection leaks into domain code"], "risk": ["operability"]})
        self.assertTrue(recommendations["recommendations"])
        self.assertTrue(recommendations["paths"])

        scan = scan_text_payload("Consume(message); Publish(message); Retry();")
        self.assertGreaterEqual(scan["count"], 1)
        self.assertTrue(scan["patterns"])

        matrix = matrix_payload()
        self.assertTrue(matrix["languages"])
        self.assertTrue(matrix["qualities"])

        neighborhood = neighborhood_payload("strategy")
        self.assertEqual("strategy", neighborhood["entry"]["slug"])
        self.assertTrue(neighborhood["related"])

        brief = brief_payload({"slugs": ["strategy,state"], "context": ["provider selection"]})
        self.assertIn("Pattern Implementation Brief", brief["markdown"])

        help_result = subprocess.run(
            [str(PLUGIN / "bin" / "patterns"), "serve", "--help"],
            cwd=ROOT,
            text=True,
            check=True,
            stdout=subprocess.PIPE,
        )
        self.assertIn("dynamic Python-backed catalog workbench", help_result.stdout)


if __name__ == "__main__":
    unittest.main()
