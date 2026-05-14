#!/usr/bin/env python3
"""Validate marketplace manifests and Markdown pattern catalog completeness."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


PLUGIN = Path(__file__).resolve().parents[1]
ROOT = PLUGIN  # plugin is self-contained inside bytedesk-marketplace; evals/ and docs/ live under it
MARKETPLACE_ROOT = PLUGIN.parent
sys.path.insert(0, str(PLUGIN / "lib"))

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
    scope_names,
)
from pattern_mcp_server import tool_definitions


KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MIN_PATTERN_COUNT = 88
MIN_OBJECT_DESIGN_COUNT = 23
MIN_INTEGRATION_DESIGN_COUNT = 65
MIN_PLAYBOOK_COUNT = 8
MIN_SMELL_COUNT = 10
MIN_FRAMEWORK_COUNT = 6
MIN_RECIPE_COUNT = 6
MIN_SCORECARD_COUNT = 1
MIN_SNIPPET_COUNT = 2
EXPECTED_LANGUAGES = {"csharp", "java", "typescript", "python", "go", "rust", "cpp"}
EXPECTED_CLASSIC_OBJECT_DESIGN_PATTERNS = {
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
EXPECTED_SKILLS = {
    "architecture-decision",
    "architecture-issue-scan",
    "integration-flow-review",
    "pattern-advisor",
    "pattern-application",
    "pattern-finder",
}
REQUIRED_SKILL_REFERENCE_FILES = {
    "usages.md",
    "examples.md",
    "implementation.md",
    "catalog.md",
}
OBJECT_DESIGN_REFERENCE_SKILLS = {
    "architecture-decision",
    "pattern-advisor",
    "pattern-finder",
    "pattern-application",
    "architecture-issue-scan",
}
INTEGRATION_DESIGN_REFERENCE_SKILLS = OBJECT_DESIGN_REFERENCE_SKILLS | {
    "integration-flow-review",
}
REQUIRED_SKILL_FRONTMATTER = {
    "name",
    "description",
    "when_to_use",
    "argument-hint",
    "user-invocable",
    "disable-model-invocation",
    "allowed-tools",
    "model",
}
EXPECTED_COMMANDS = {
    "patterns-adr",
    "patterns-context",
    "patterns-examples",
    "patterns-graph",
    "patterns-help",
    "patterns-migrate",
    "patterns-recommend",
    "patterns-scan",
    "patterns-simulate",
    "patterns-snippets",
}
COMMAND_TO_MCP_TOOL = {
    "patterns-adr": "patterns_adr",
    "patterns-context": "patterns_context",
    "patterns-examples": "patterns_examples",
    "patterns-graph": "patterns_graph",
    "patterns-help": "patterns_help",
    "patterns-migrate": "patterns_migrate",
    "patterns-recommend": "patterns_recommend",
    "patterns-scan": "patterns_scan",
    "patterns-simulate": "patterns_simulate",
    "patterns-snippets": "patterns_snippets",
}
EXPECTED_AGENTS = {"pattern-architect"}
REQUIRED_AGENT_FRONTMATTER = {
    "name",
    "description",
    "argument-hint",
    "tools",
}


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def parse_frontmatter(text: str, label: str) -> dict[str, str]:
    require(text.startswith("---\n"), f"{label}: missing YAML frontmatter")
    parts = text.split("---", 2)
    require(len(parts) == 3, f"{label}: malformed YAML frontmatter")
    frontmatter: dict[str, str] = {}
    for line in parts[1].splitlines():
        if not line.strip():
            continue
        require(":" in line, f"{label}: malformed frontmatter line {line!r}")
        key, value = line.split(":", 1)
        frontmatter[key.strip()] = value.strip().strip('"')
    return frontmatter


def validate_claude_manifest() -> None:
    marketplace = load_json(MARKETPLACE_ROOT / ".claude-plugin" / "marketplace.json")
    plugin = load_json(PLUGIN / ".claude-plugin" / "plugin.json")
    require(KEBAB.match(marketplace["name"]) is not None, "Claude marketplace name must be kebab-case")
    require(KEBAB.match(plugin["name"]) is not None, "Claude plugin name must be kebab-case")
    entries = [item for item in marketplace.get("plugins", []) if item.get("name") == plugin["name"]]
    require(len(entries) == 1, f"Marketplace must list exactly one '{plugin['name']}' plugin entry")
    entry = entries[0]
    require(entry["source"] == "./design-patterns", "Claude marketplace source must point at the bundled plugin directory")
    require(entry["version"] == plugin["version"], "Claude marketplace and plugin versions must match")


def validate_codex_manifest() -> None:
    # The standalone Codex marketplace manifest (.agents/plugins/marketplace.json) does not
    # travel with the plugin into bytedesk-marketplace; validate the bundled Codex plugin
    # manifest for internal consistency only. See BDM-53.
    plugin = load_json(PLUGIN / ".codex-plugin" / "plugin.json")
    require(KEBAB.match(plugin["name"]) is not None, "Codex plugin name must be kebab-case")
    require(plugin["skills"] == "./skills/", "Codex plugin must expose the shared skills directory")
    require(plugin["mcpServers"] == "./.codex-mcp.json", "Codex plugin must expose the Codex MCP server config")
    require(plugin["version"] == load_json(PLUGIN / ".claude-plugin" / "plugin.json")["version"], "Claude and Codex plugin versions must match")


def validate_mcp_metadata() -> None:
    # The repo-root project .mcp.json from the standalone repo does not travel with the
    # plugin; validate the bundled Claude + Codex MCP server configs only. See BDM-53.
    claude_plugin_config = load_json(PLUGIN / ".mcp.json")
    codex_plugin_config = load_json(PLUGIN / ".codex-mcp.json")
    claude_plugin_servers = claude_plugin_config.get("mcpServers", {})
    codex_plugin_servers = codex_plugin_config.get("mcpServers", {})
    require((PLUGIN / "bin" / "patterns-mcp").exists(), "Missing install-root-aware MCP launcher")
    require("design-patterns" in claude_plugin_servers, "Claude plugin .mcp.json must expose design-patterns server")
    require("design-patterns" in codex_plugin_servers, "Codex plugin .codex-mcp.json must expose design-patterns server")
    claude_plugin_server = claude_plugin_servers["design-patterns"]
    codex_plugin_server = codex_plugin_servers["design-patterns"]
    require(claude_plugin_server.get("type") == "stdio", "Claude plugin MCP server must be stdio")
    require(codex_plugin_server.get("type") == "stdio", "Codex plugin MCP server must be stdio")
    require(
        claude_plugin_server.get("command") == "${CLAUDE_PLUGIN_ROOT}/bin/patterns-mcp",
        "Claude plugin MCP server command must use the installed plugin root",
    )
    require(codex_plugin_server.get("command") == "./bin/patterns-mcp", "Codex plugin MCP server command must use the bundled launcher")
    require(not claude_plugin_server.get("args"), "Claude plugin MCP server should not need args")
    require(not codex_plugin_server.get("args"), "Codex plugin MCP server should not need args")
    require(codex_plugin_server.get("cwd") == ".", "Codex plugin MCP server cwd must be plugin root")


def validate_markdown_only_data() -> None:
    data_files = list((PLUGIN / "data").rglob("*"))
    json_files = [path for path in data_files if path.suffix == ".json"]
    require(not json_files, "Pattern data must be stored as Markdown, not JSON")
    require((PLUGIN / "data" / "patterns").is_dir(), "Missing data/patterns Markdown directory")
    require((PLUGIN / "data" / "languages").is_dir(), "Missing data/languages Markdown directory")
    require((PLUGIN / "data" / "playbooks").is_dir(), "Missing data/playbooks Markdown directory")
    require((PLUGIN / "data" / "smells").is_dir(), "Missing data/smells Markdown directory")
    require((PLUGIN / "data" / "frameworks").is_dir(), "Missing data/frameworks Markdown directory")
    require((PLUGIN / "data" / "recipes").is_dir(), "Missing data/recipes Markdown directory")
    require((PLUGIN / "data" / "scorecards").is_dir(), "Missing data/scorecards Markdown directory")
    require((PLUGIN / "data" / "snippets").is_dir(), "Missing data/snippets Markdown directory")
    require((PLUGIN / "data" / "taxonomy").is_dir(), "Missing data/taxonomy Markdown directory")


def validate_references(references: list[str], valid_reference_paths: set[str], label: str) -> None:
    require(references, f"{label}: missing references frontmatter")
    require(isinstance(references, list), f"{label}: references must be a list")
    for reference in references:
        require(reference in valid_reference_paths, f"{label}: reference does not exist: {reference}")


def validate_patterns() -> None:
    patterns = load_patterns()
    valid_reference_paths = {
        str(path.relative_to(PLUGIN))
        for skill in EXPECTED_SKILLS
        for path in (PLUGIN / "skills" / skill / "references").glob("*.md")
    }
    require(len(patterns) >= MIN_PATTERN_COUNT, f"Expected at least {MIN_PATTERN_COUNT} patterns, found {len(patterns)}")
    object_count = 0
    integration_count = 0
    seen = set()
    pattern_slugs = {pattern["slug"] for pattern in patterns}
    required_pattern_fields = {
        "qualityAttributes",
        "implementationComplexity",
        "operationalRisk",
        "tradeoffs",
        "failureModes",
        "testingFocus",
        "observabilityFocus",
    }
    required_pattern_sections = {
        "forces",
        "tradeoffNotes",
        "failureModeNotes",
        "testing",
        "observability",
        "implementationNotes",
    }
    for pattern in patterns:
        slug = pattern["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid slug {slug}")
        require(slug not in seen, f"Duplicate slug {slug}")
        seen.add(slug)
        require(pattern.get("name"), f"{slug}: missing name")
        require(pattern.get("domain"), f"{slug}: missing domain")
        require(pattern.get("category"), f"{slug}: missing category")
        require(pattern.get("groups"), f"{slug}: missing groups")
        require(pattern.get("languages"), f"{slug}: missing languages")
        require(set(pattern["languages"]) <= EXPECTED_LANGUAGES, f"{slug}: unknown language tag")
        require(pattern.get("intent"), f"{slug}: missing Intent section")
        require(pattern.get("whenToUse"), f"{slug}: missing When To Use bullets")
        require(pattern.get("avoidWhen"), f"{slug}: missing Avoid When bullets")
        for field in required_pattern_fields:
            require(pattern.get(field), f"{slug}: missing {field} frontmatter")
        for field in required_pattern_sections:
            require(pattern.get(field), f"{slug}: missing {field} section")
        references = pattern.get("references", [])
        validate_references(references, valid_reference_paths, slug)
        for related in pattern.get("related", []):
            require(related in pattern_slugs, f"{slug}: related target does not exist: {related}")
        relationships = pattern.get("relationships", [])
        require(relationships, f"{slug}: missing typed relationships")
        for relationship in relationships:
            require(":" in relationship, f"{slug}: relationship must use type:slug format")
            relation_type, target = relationship.split(":", 1)
            require(KEBAB.match(relation_type) is not None, f"{slug}: invalid relationship type {relation_type}")
            require(target in pattern_slugs, f"{slug}: relationship target does not exist: {target}")
        if "object-design" in pattern["groups"]:
            object_count += 1
            require(set(pattern.get("languageNotes", {})) == set(pattern["languages"]), f"{slug}: missing language notes")
            reference_skills = {reference.split("/", 2)[1] for reference in references}
            missing = OBJECT_DESIGN_REFERENCE_SKILLS - reference_skills
            require(not missing, f"{slug}: missing object-design reference skills {sorted(missing)}")
        if "integration-design" in pattern["groups"]:
            integration_count += 1
            reference_skills = {reference.split("/", 2)[1] for reference in references}
            missing = INTEGRATION_DESIGN_REFERENCE_SKILLS - reference_skills
            require(not missing, f"{slug}: missing integration-design reference skills {sorted(missing)}")
        require(KEBAB.match(pattern["domain"]) is not None, f"{slug}: invalid domain")
        for group in pattern["groups"]:
            require(KEBAB.match(group) is not None, f"{slug}: invalid group {group}")
    require(object_count >= MIN_OBJECT_DESIGN_COUNT, f"Expected at least {MIN_OBJECT_DESIGN_COUNT} object-design patterns, found {object_count}")
    require(integration_count >= MIN_INTEGRATION_DESIGN_COUNT, f"Expected at least {MIN_INTEGRATION_DESIGN_COUNT} integration-design patterns, found {integration_count}")
    object_slugs = {pattern["slug"] for pattern in patterns if "object-design" in pattern.get("groups", [])}
    missing_classic = EXPECTED_CLASSIC_OBJECT_DESIGN_PATTERNS - object_slugs
    require(not missing_classic, f"Missing classic object-design patterns: {sorted(missing_classic)}")
    missing_python = [pattern["slug"] for pattern in patterns if "python" not in pattern.get("languages", [])]
    require(not missing_python, f"Patterns missing python language coverage: {missing_python}")
    require({"all", "object-design", "integration-design"} <= scope_names(patterns), "Missing core query scopes")


def validate_playbooks_and_smells() -> None:
    patterns = load_patterns()
    playbooks = load_playbooks()
    smells = load_smells()
    pattern_slugs = {pattern["slug"] for pattern in patterns}
    smell_slugs = {smell["slug"] for smell in smells}
    valid_reference_paths = {
        str(path.relative_to(PLUGIN))
        for skill in EXPECTED_SKILLS
        for path in (PLUGIN / "skills" / skill / "references").glob("*.md")
    }
    require(len(playbooks) >= MIN_PLAYBOOK_COUNT, f"Expected at least {MIN_PLAYBOOK_COUNT} playbooks, found {len(playbooks)}")
    require(len(smells) >= MIN_SMELL_COUNT, f"Expected at least {MIN_SMELL_COUNT} smells, found {len(smells)}")
    seen = set()
    for playbook in playbooks:
        slug = playbook["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid playbook slug {slug}")
        require(slug not in seen, f"Duplicate playbook slug {slug}")
        seen.add(slug)
        require("architecture-playbook" in playbook.get("groups", []), f"{slug}: missing architecture-playbook group")
        require(playbook.get("patterns"), f"{slug}: missing playbook patterns")
        for pattern in playbook.get("patterns", []):
            require(pattern in pattern_slugs, f"{slug}: playbook pattern target does not exist: {pattern}")
        for smell in playbook.get("smells", []):
            require(smell in smell_slugs, f"{slug}: playbook smell target does not exist: {smell}")
        for section in ("intent", "whenToUse", "avoidWhen", "patternSet", "implementationSteps", "verification"):
            require(playbook.get(section), f"{slug}: missing {section} section")
        validate_references(playbook.get("references", []), valid_reference_paths, slug)
    seen.clear()
    for smell in smells:
        slug = smell["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid smell slug {slug}")
        require(slug not in seen, f"Duplicate smell slug {slug}")
        seen.add(slug)
        require("architecture-smell" in smell.get("groups", []), f"{slug}: missing architecture-smell group")
        require(smell.get("patterns"), f"{slug}: missing smell pattern responses")
        for pattern in smell.get("patterns", []):
            require(pattern in pattern_slugs, f"{slug}: smell pattern target does not exist: {pattern}")
        for section in ("symptom", "whyItMatters", "patternResponses", "falsePositives", "checks"):
            require(smell.get(section), f"{slug}: missing {section} section")
        validate_references(smell.get("references", []), valid_reference_paths, slug)


def validate_frameworks_recipes_and_scorecards() -> None:
    patterns = load_patterns()
    smells = load_smells()
    frameworks = load_frameworks()
    recipes = load_recipes()
    scorecards = load_scorecards()
    pattern_slugs = {pattern["slug"] for pattern in patterns}
    smell_slugs = {smell["slug"] for smell in smells}
    valid_reference_paths = {
        str(path.relative_to(PLUGIN))
        for skill in EXPECTED_SKILLS
        for path in (PLUGIN / "skills" / skill / "references").glob("*.md")
    }
    require(len(frameworks) >= MIN_FRAMEWORK_COUNT, f"Expected at least {MIN_FRAMEWORK_COUNT} framework packs, found {len(frameworks)}")
    require(len(recipes) >= MIN_RECIPE_COUNT, f"Expected at least {MIN_RECIPE_COUNT} recipes, found {len(recipes)}")
    require(len(scorecards) >= MIN_SCORECARD_COUNT, f"Expected at least {MIN_SCORECARD_COUNT} scorecards, found {len(scorecards)}")
    seen = set()
    for framework in frameworks:
        slug = framework["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid framework slug {slug}")
        require(slug not in seen, f"Duplicate framework slug {slug}")
        seen.add(slug)
        require("framework-implementation" in framework.get("groups", []), f"{slug}: missing framework-implementation group")
        require(set(framework.get("languages", [])) <= EXPECTED_LANGUAGES, f"{slug}: unknown framework language tag")
        for pattern in framework.get("patterns", []):
            require(pattern in pattern_slugs, f"{slug}: framework pattern target does not exist: {pattern}")
        for section in ("bestFor", "patternMapping", "implementationNotes", "testingGuidance", "operationalGuidance"):
            require(framework.get(section), f"{slug}: missing {section} section")
        validate_references(framework.get("references", []), valid_reference_paths, slug)
    seen.clear()
    for recipe in recipes:
        slug = recipe["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid recipe slug {slug}")
        require(slug not in seen, f"Duplicate recipe slug {slug}")
        seen.add(slug)
        require("pattern-recipe" in recipe.get("groups", []), f"{slug}: missing pattern-recipe group")
        for pattern in recipe.get("patterns", []):
            require(pattern in pattern_slugs, f"{slug}: recipe pattern target does not exist: {pattern}")
        for smell in recipe.get("smells", []):
            require(smell in smell_slugs, f"{slug}: recipe smell target does not exist: {smell}")
        for section in ("goal", "preconditions", "steps", "tests", "rollback"):
            require(recipe.get(section), f"{slug}: missing {section} section")
        validate_references(recipe.get("references", []), valid_reference_paths, slug)
    seen.clear()
    for scorecard in scorecards:
        slug = scorecard["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid scorecard slug {slug}")
        require(slug not in seen, f"Duplicate scorecard slug {slug}")
        seen.add(slug)
        require("architecture-scorecard" in scorecard.get("groups", []), f"{slug}: missing architecture-scorecard group")
        require(scorecard.get("criteria"), f"{slug}: missing criteria frontmatter")
        for section in ("intent", "scale", "criteriaNotes", "outputContract", "antiPatterns"):
            require(scorecard.get(section), f"{slug}: missing {section} section")
        validate_references(scorecard.get("references", []), valid_reference_paths, slug)


def validate_taxonomy_and_snippets() -> None:
    taxonomy = load_taxonomy()
    snippets = load_snippets()
    patterns = load_patterns()
    pattern_slugs = {pattern["slug"] for pattern in patterns}
    require("architecture-forces" in taxonomy, "Missing architecture-forces taxonomy")
    require("architecture-synonyms" in taxonomy, "Missing architecture-synonyms taxonomy")
    for slug, entry in taxonomy.items():
        require(KEBAB.match(slug) is not None, f"Invalid taxonomy slug {slug}")
        require(entry.get("groups"), f"{slug}: taxonomy must include grouped headings")
        for group_name, values in entry["groups"].items():
            require(group_name.strip(), f"{slug}: taxonomy group name is empty")
            require(values, f"{slug}: taxonomy group {group_name} is empty")
    require(len(snippets) >= MIN_SNIPPET_COUNT, f"Expected at least {MIN_SNIPPET_COUNT} snippets, found {len(snippets)}")
    seen = set()
    for snippet in snippets:
        slug = snippet["slug"]
        require(KEBAB.match(slug) is not None, f"Invalid snippet slug {slug}")
        require(slug not in seen, f"Duplicate snippet slug {slug}")
        seen.add(slug)
        require(snippet.get("language") in EXPECTED_LANGUAGES, f"{slug}: unknown snippet language")
        require(snippet.get("patterns"), f"{slug}: snippet must reference patterns")
        for pattern in snippet.get("patterns", []):
            require(pattern in pattern_slugs, f"{slug}: snippet pattern target does not exist: {pattern}")
        require(snippet.get("use"), f"{slug}: missing Use section")
        require(snippet.get("example"), f"{slug}: missing Example section")
        require(snippet.get("tests"), f"{slug}: missing Tests section")


def validate_languages() -> None:
    languages = load_language_profiles()
    require(set(languages) == EXPECTED_LANGUAGES, "Language Markdown catalog does not match expected language set")
    for slug, language in languages.items():
        require(language.get("displayName"), f"{slug}: missing displayName")
        require(language.get("objectDesignIdioms"), f"{slug}: missing Object Design Idioms")
        require(language.get("integrationStacks"), f"{slug}: missing Integration Stacks")
        require(language.get("implementationNotes"), f"{slug}: missing Implementation Notes")
        require(language.get("testingGuidance"), f"{slug}: missing Testing Guidance")
        require(language.get("operationalGuidance"), f"{slug}: missing Operational Guidance")


def validate_skills() -> None:
    skills_root = PLUGIN / "skills"
    skill_names = {path.name for path in skills_root.iterdir() if path.is_dir()}
    require(EXPECTED_SKILLS <= skill_names, "Plugin is missing required skills")
    for skill in sorted(skill_names):
        skill_file = skills_root / skill / "SKILL.md"
        require(skill_file.exists(), f"{skill}: missing SKILL.md")
        text = skill_file.read_text(encoding="utf-8")
        frontmatter = parse_frontmatter(text, skill)
        missing = REQUIRED_SKILL_FRONTMATTER - set(frontmatter)
        require(not missing, f"{skill}: missing frontmatter fields {sorted(missing)}")
        require(frontmatter["name"] == skill, f"{skill}: name must match skill directory")
        require(frontmatter["description"], f"{skill}: description must not be empty")
        require(frontmatter["when_to_use"], f"{skill}: when_to_use must not be empty")
        require(frontmatter["argument-hint"].startswith("["), f"{skill}: argument-hint should describe slash-command arguments")
        require(frontmatter["user-invocable"] == "true", f"{skill}: user-invocable must be explicit true")
        require(frontmatter["disable-model-invocation"] == "false", f"{skill}: disable-model-invocation must be explicit false")
        require(frontmatter["model"] == "inherit", f"{skill}: model must inherit caller context")
        require("Bash(patterns *)" in frontmatter["allowed-tools"], f"{skill}: allowed-tools must include patterns lookup")
        references_root = skills_root / skill / "references"
        require(references_root.is_dir(), f"{skill}: missing references directory")
        reference_files = {path.name for path in references_root.glob("*.md")}
        missing_references = REQUIRED_SKILL_REFERENCE_FILES - reference_files
        require(not missing_references, f"{skill}: missing reference files {sorted(missing_references)}")
        for reference_file in REQUIRED_SKILL_REFERENCE_FILES:
            reference_path = references_root / reference_file
            reference_text = reference_path.read_text(encoding="utf-8")
            require(f"(references/{reference_file})" in text, f"{skill}: SKILL.md must link references/{reference_file}")
            require(len(reference_text.split()) >= 80, f"{skill}: references/{reference_file} must contain substantive guidance")
        usages = (references_root / "usages.md").read_text(encoding="utf-8")
        require("## Output Contract" in usages, f"{skill}: usages.md must define an Output Contract")


def validate_commands() -> None:
    commands_root = PLUGIN / "commands"
    require(commands_root.is_dir(), "Plugin must expose slash commands in commands/")
    command_names = {path.stem for path in commands_root.glob("*.md")}
    missing_commands = EXPECTED_COMMANDS - command_names
    require(not missing_commands, f"Plugin slash commands missing: {sorted(missing_commands)}")
    examples_text = (commands_root / "patterns-examples.md").read_text(encoding="utf-8")
    require("Return copyable slash commands" in examples_text, "patterns-examples must prioritize copyable slash commands")
    for command in sorted(command_names):
        command_path = commands_root / f"{command}.md"
        text = command_path.read_text(encoding="utf-8")
        frontmatter = parse_frontmatter(text, command)
        require(frontmatter.get("description"), f"{command}: missing description")
        require(frontmatter.get("argument-hint"), f"{command}: missing argument-hint")
        require(f"/{command}" in text, f"{command}: must include a copyable slash example")
        require(f"/{command} help" in text, f"{command}: must document /{command} help")
        require("Help behavior:" in text, f"{command}: must define help behavior")
        require("help" in frontmatter["argument-hint"], f"{command}: argument-hint must mention help")
        if command != "patterns-help":
            require("Inference behavior:" in text, f"{command}: must define language/scope inference behavior")
            require("infer" in text.casefold(), f"{command}: must mention inference")
        if command in COMMAND_TO_MCP_TOOL:
            require(COMMAND_TO_MCP_TOOL[command] in text, f"{command}: must map to its MCP tool")
            require(f"/{command}" in examples_text, f"patterns-examples must include /{command}")


def validate_agents() -> None:
    agents_root = PLUGIN / "agents"
    require(agents_root.is_dir(), "Plugin must expose agents in agents/")
    agent_names = {path.stem for path in agents_root.glob("*.md")}
    missing_agents = EXPECTED_AGENTS - agent_names
    require(not missing_agents, f"Plugin agents missing: {sorted(missing_agents)}")
    for agent in sorted(agent_names):
        agent_path = agents_root / f"{agent}.md"
        text = agent_path.read_text(encoding="utf-8")
        frontmatter = parse_frontmatter(text, agent)
        missing = REQUIRED_AGENT_FRONTMATTER - set(frontmatter)
        require(not missing, f"{agent}: missing frontmatter fields {sorted(missing)}")
        require(frontmatter["name"] == agent, f"{agent}: name must match agent file")
        require(frontmatter["description"], f"{agent}: description must not be empty")
        require(frontmatter["argument-hint"].startswith("["), f"{agent}: argument-hint should describe agent arguments")
        require(frontmatter["tools"], f"{agent}: tools must not be empty")


def validate_mcp_tool_argument_helpers() -> None:
    tools = tool_definitions()
    require(tools, "MCP server must expose tool definitions")
    tool_map = {tool.get("name"): tool for tool in tools}
    require("pack" in tool_map["patterns_context"]["inputSchema"]["properties"], "patterns_context must expose inferrable pack")
    require("query" in tool_map["patterns_snippets"]["inputSchema"]["properties"], "patterns_snippets must expose query-based pattern inference")
    for tool in tools:
        name = tool.get("name", "<unknown>")
        schema = tool.get("inputSchema", {})
        properties = schema.get("properties", {})
        require(tool.get("description"), f"{name}: MCP tool description must not be empty")
        require(isinstance(properties, dict), f"{name}: MCP input properties must be an object")
        require(not schema.get("required"), f"{name}: MCP tool should return missing-argument detail instead of schema-required blocking")
        for argument_name, argument_schema in properties.items():
            label = f"{name}.{argument_name}"
            require(isinstance(argument_schema, dict), f"{label}: MCP argument schema must be an object")
            require(argument_schema.get("description"), f"{label}: missing MCP argument helper description")
            if argument_schema.get("type") == "array":
                item_schema = argument_schema.get("items", {})
                require(isinstance(item_schema, dict), f"{label}: array items schema must be an object")
                require(item_schema.get("description"), f"{label}: array item schema must include a helper description")


def validate_evals() -> None:
    evals_path = ROOT / "evals" / "evals.json"
    require(evals_path.exists(), "Missing evals/evals.json")
    payload = load_json(evals_path)
    require(payload.get("skill_name") == "design-patterns", "evals/evals.json: skill_name must be design-patterns")
    evals = payload.get("evals", [])
    require(len(evals) >= 3, "evals/evals.json: expected at least 3 evals")
    seen = set()
    for item in evals:
        eval_id = item.get("id")
        require(eval_id not in seen, f"evals/evals.json: duplicate eval id {eval_id}")
        seen.add(eval_id)
        require(item.get("prompt"), f"evals/evals.json: eval {eval_id} missing prompt")
        require(item.get("expected_output"), f"evals/evals.json: eval {eval_id} missing expected_output")
        require(isinstance(item.get("files", []), list), f"evals/evals.json: eval {eval_id} files must be a list")
        golden_output = item.get("golden_output")
        require(golden_output, f"evals/evals.json: eval {eval_id} missing golden_output")
        require((ROOT / golden_output).exists(), f"evals/evals.json: eval {eval_id} golden_output does not exist")
        assertions = item.get("assertions", [])
        require(assertions, f"evals/evals.json: eval {eval_id} missing assertions")
        for assertion in assertions:
            require(
                assertion.get("type")
                in {"contains_sections", "contains_terms", "command_json_top_slug", "command_json_contains", "command_json_count_at_most"},
                f"evals/evals.json: eval {eval_id} invalid assertion type",
            )


def validate_docs_site() -> None:
    site = PLUGIN / "site"
    require((ROOT / "docs" / "catalog-authoring.md").exists(), "Missing docs/catalog-authoring.md")
    require((ROOT / "docs" / "classic-object-pattern-coverage.md").exists(), "Missing docs/classic-object-pattern-coverage.md")
    require((site / "index.html").exists(), "Missing generated plugin site/index.html")
    require((site / "search-index.json").exists(), "Missing generated plugin site/search-index.json")
    index = load_json(site / "search-index.json")
    require(len(index) >= MIN_PATTERN_COUNT + MIN_PLAYBOOK_COUNT + MIN_SMELL_COUNT, "Generated site search index is incomplete")


def validate_plugin_workbench() -> None:
    workbench = PLUGIN / "lib" / "pattern_workbench.py"
    cli = PLUGIN / "bin" / "patterns"
    require(workbench.exists(), "Missing plugin dynamic workbench implementation")
    require(cli.exists(), "Missing plugin patterns CLI")
    workbench_text = workbench.read_text(encoding="utf-8")
    cli_text = cli.read_text(encoding="utf-8")
    required_modules = {
        "pattern_intelligence.py",
        "pattern_scanner.py",
        "pattern_context.py",
        "pattern_graph.py",
        "pattern_inference.py",
        "pattern_mcp_server.py",
        "workbench_analysis.py",
        "workbench_api.py",
        "workbench_assets.py",
        "workbench_views.py",
    }
    present_modules = {path.name for path in (PLUGIN / "lib").glob("*.py")}
    missing_modules = required_modules - present_modules
    require(not missing_modules, f"Plugin intelligence/workbench modules missing: {sorted(missing_modules)}")
    require("run_server" in workbench_text, "Plugin workbench must expose run_server")
    for command in ("serve", "context", "simulate", "migrate", "snippets", "mcp", "graph"):
        require(f'"{command}"' in cli_text, f"Plugin CLI must expose {command} subcommand")
    require("pattern_workbench" in cli_text, "Plugin CLI serve command must use the plugin workbench module")
    require("serve_stdio" in cli_text, "Plugin CLI must expose the MCP stdio server")
    mcp_text = (PLUGIN / "lib" / "pattern_mcp_server.py").read_text(encoding="utf-8")
    require("infer_request_context" in mcp_text, "MCP server must infer language and scope when omitted")
    require("patterns_help" in mcp_text, "MCP server must expose pattern command help")


def main() -> int:
    validate_claude_manifest()
    validate_codex_manifest()
    validate_mcp_metadata()
    validate_markdown_only_data()
    validate_patterns()
    validate_playbooks_and_smells()
    validate_frameworks_recipes_and_scorecards()
    validate_taxonomy_and_snippets()
    validate_languages()
    validate_skills()
    validate_commands()
    validate_agents()
    validate_mcp_tool_argument_helpers()
    validate_evals()
    validate_docs_site()
    validate_plugin_workbench()
    print("Marketplace metadata, Markdown catalog, taxonomy, snippets, playbooks, smells, frameworks, recipes, scorecards, evals, docs, workbench, slash commands, agents, MCP helpers, and skill metadata validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
