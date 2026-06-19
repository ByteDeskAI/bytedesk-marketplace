#!/usr/bin/env python3
"""Generate deterministic Structurizr DSL reference data for the plugin catalog."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

KEYWORDS: list[dict] = [
    {
        "slug": "workspace",
        "keyword": "workspace",
        "category": "root",
        "grammar": 'workspace [name] [description] { ... }',
        "description": "Top-level wrapper for model and views. May extend another workspace.",
        "permitted_children": ["name", "description", "properties", "!identifiers", "!docs", "!adrs", "model", "views", "configuration"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#workspace",
        "examples": ['workspace "My System" "Description" {\n    model { }\n    views { }\n}'],
        "common_mistakes": ["Opening brace must be on same line as workspace keyword", "extends makes DSL non-portable"],
    },
    {
        "slug": "model",
        "keyword": "model",
        "category": "root",
        "grammar": "model { ... }",
        "description": "Required block containing elements and relationships.",
        "permitted_children": ["!identifiers", "archetypes", "group", "person", "softwareSystem", "deploymentEnvironment", "element", "->"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#model",
        "examples": ["model {\n    user = person \"User\"\n}"],
        "common_mistakes": ["Forward references are not supported"],
    },
    {
        "slug": "person",
        "keyword": "person",
        "category": "element",
        "grammar": 'person <name> [description] [tags] { ... }',
        "description": "A user, actor, role, or persona.",
        "permitted_children": ["description", "tags", "url", "properties", "perspectives", "->"],
        "default_tags": ["Element", "Person"],
        "doc_url": "https://docs.structurizr.com/dsl/language#person",
        "examples": ['user = person "User" "Uses the system"'],
        "common_mistakes": ["Person names must be unique across workspace"],
    },
    {
        "slug": "softwareSystem",
        "keyword": "softwareSystem",
        "category": "element",
        "grammar": 'softwareSystem <name> [description] [tags] { ... }',
        "description": "A software system — highest level of software abstraction.",
        "permitted_children": ["!docs", "!adrs", "group", "container", "description", "tags", "url", "properties", "perspectives", "->"],
        "default_tags": ["Element", "Software System"],
        "doc_url": "https://docs.structurizr.com/dsl/language#softwaresystem",
        "examples": ['platform = softwareSystem "Platform" "Core SaaS" {\n    api = container "API"\n}'],
        "common_mistakes": ["Do not put infrastructure detail at C1 without containers"],
    },
    {
        "slug": "container",
        "keyword": "container",
        "category": "element",
        "grammar": 'container <name> [description] [technology] [tags] { ... }',
        "description": "Deployable/runnable unit within a software system.",
        "permitted_children": ["!docs", "!adrs", "group", "component", "!components", "description", "technology", "tags", "url", "properties", "perspectives", "->"],
        "default_tags": ["Element", "Container"],
        "doc_url": "https://docs.structurizr.com/dsl/language#container",
        "examples": ['api = container "API" "REST API" ".NET 10"'],
        "common_mistakes": ["Container names must be unique within parent software system", "Always set technology for enterprise models"],
    },
    {
        "slug": "component",
        "keyword": "component",
        "category": "element",
        "grammar": 'component <name> [description] [technology] [tags] { ... }',
        "description": "Logical module inside a container.",
        "permitted_children": ["!docs", "!adrs", "description", "technology", "tags", "url", "properties", "perspectives", "group", "->"],
        "default_tags": ["Element", "Component"],
        "doc_url": "https://docs.structurizr.com/dsl/language#component",
        "examples": ['authService = component "Auth Service" "JWT validation" "Scoped Service"'],
        "common_mistakes": ["Component names must be unique within parent container"],
    },
    {
        "slug": "deploymentEnvironment",
        "keyword": "deploymentEnvironment",
        "category": "deployment",
        "grammar": "deploymentEnvironment <name> { ... }",
        "description": "Named deployment target (dev, staging, production).",
        "permitted_children": ["group", "deploymentGroup", "deploymentNode", "->", "-/>"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#deploymentenvironment",
        "examples": ['production = deploymentEnvironment "Production" {\n    k8s = deploymentNode "Kubernetes"\n}'],
        "common_mistakes": ["Deployment model is separate from structural model"],
    },
    {
        "slug": "deploymentNode",
        "keyword": "deploymentNode",
        "category": "deployment",
        "grammar": 'deploymentNode <name> [description] [technology] [tags] [instances] { ... }',
        "description": "Infrastructure host or grouping (can nest).",
        "permitted_children": ["group", "deploymentNode", "infrastructureNode", "softwareSystemInstance", "containerInstance", "instanceOf", "->", "description", "technology", "instances", "tags", "url", "properties", "perspectives"],
        "default_tags": ["Element", "Deployment Node"],
        "doc_url": "https://docs.structurizr.com/dsl/language#deploymentnode",
        "examples": ['node = deploymentNode "App Server" "VM" "Linux" "1..N"'],
        "common_mistakes": ["Set instances for elastic scaling notation"],
    },
    {
        "slug": "infrastructureNode",
        "keyword": "infrastructureNode",
        "category": "deployment",
        "grammar": 'infrastructureNode <name> [description] [technology] [tags] { ... }',
        "description": "Load balancer, firewall, DNS, etc.",
        "permitted_children": ["->", "description", "technology", "tags", "url", "properties", "perspectives"],
        "default_tags": ["Element", "Infrastructure Node"],
        "doc_url": "https://docs.structurizr.com/dsl/language#infrastructurenode",
        "examples": ['lb = infrastructureNode "Load Balancer" "Ingress" "nginx"'],
        "common_mistakes": [],
    },
    {
        "slug": "relationship",
        "keyword": "->",
        "category": "relationship",
        "grammar": "<source> -> <destination> [description] [technology] [tags] { ... }",
        "description": "Uni-directional relationship between elements.",
        "permitted_children": ["tags", "url", "properties", "perspectives"],
        "default_tags": ["Relationship"],
        "doc_url": "https://docs.structurizr.com/dsl/language#relationship",
        "examples": ['user -> api "Uses" "HTTPS"', 'api -> database "Reads from and writes to" "TCP"'],
        "common_mistakes": ["Relationship descriptions must be unique per source-destination pair", "Use relationship archetypes for protocol defaults"],
    },
    {
        "slug": "views",
        "keyword": "views",
        "category": "views",
        "grammar": "views { ... }",
        "description": "Diagram definitions, styles, themes.",
        "permitted_children": ["systemLandscape", "systemContext", "container", "component", "filtered", "dynamic", "deployment", "custom", "image", "styles", "theme", "themes", "terminology", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#views",
        "examples": ["views {\n    systemContext platform \"PlatformContext\" {\n        include *\n        autoLayout lr\n    }\n}"],
        "common_mistakes": ["Defining any custom view removes auto-generated defaults", "Always set explicit view keys for layout stability"],
    },
    {
        "slug": "systemContext",
        "keyword": "systemContext",
        "category": "view",
        "grammar": "systemContext <softwareSystem> [key] [description] { ... }",
        "description": "C1 system context diagram for one software system.",
        "permitted_children": ["include", "exclude", "autoLayout", "default", "animation", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#systemcontext-view",
        "examples": ['systemContext platform "Context" {\n    include *\n    autoLayout lr\n}'],
        "common_mistakes": ["Auto-generated view keys are unstable — always specify key"],
    },
    {
        "slug": "containerView",
        "keyword": "container",
        "category": "view",
        "grammar": "container <softwareSystem> [key] [description] { ... }",
        "description": "C2 container diagram (view keyword, not element).",
        "permitted_children": ["include", "exclude", "autoLayout", "default", "animation", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#container-view",
        "examples": ['container platform "Containers" {\n    include *\n    autoLayout tb\n}'],
        "common_mistakes": ["Do not confuse container view with container element"],
    },
    {
        "slug": "componentView",
        "keyword": "component",
        "category": "view",
        "grammar": "component <container> [key] [description] { ... }",
        "description": "C3 component diagram for a container.",
        "permitted_children": ["include", "exclude", "autoLayout", "default", "animation", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#component-view",
        "examples": ['component api "APIComponents" {\n    include *\n}'],
        "common_mistakes": [],
    },
    {
        "slug": "dynamic",
        "keyword": "dynamic",
        "category": "view",
        "grammar": "dynamic <*|softwareSystem|container> [key] [description] { ... }",
        "description": "Interaction/sequence diagram.",
        "permitted_children": ["include", "exclude", "autoLayout", "default", "animation", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#dynamic-view",
        "examples": ['dynamic platform "AuthFlow" {\n    user -> gateway "Authenticates"\n    gateway -> identity "Validates"\n}'],
        "common_mistakes": ["Order of relationships defines sequence", "Expressions not supported in dynamic views"],
    },
    {
        "slug": "deployment",
        "keyword": "deployment",
        "category": "view",
        "grammar": "deployment <softwareSystem> <environment> [key] [description] { ... }",
        "description": "Deployment diagram for system in environment.",
        "permitted_children": ["include", "exclude", "autoLayout", "default", "animation", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#deployment-view",
        "examples": ['deployment platform production "Production" {\n    include *\n}'],
        "common_mistakes": [],
    },
    {
        "slug": "filtered",
        "keyword": "filtered",
        "category": "view",
        "grammar": 'filtered <baseKey> <include|exclude> <tags> [key] [description] { ... }',
        "description": "Stakeholder-specific view derived from base view.",
        "permitted_children": ["default", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#filtered-view",
        "examples": ['filtered Containers include "Service" "ServicesOnly"'],
        "common_mistakes": ["Base view disappears from diagram list once filtered views exist"],
    },
    {
        "slug": "archetypes",
        "keyword": "archetypes",
        "category": "model",
        "grammar": "archetypes { <name> = <type> { defaults } }",
        "description": "User-defined element/relationship types with defaults.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/archetypes",
        "examples": ['archetypes {\n    application = container { technology "Java" tag "Application" }\n    https = --sync-> { technology "HTTPS" }\n}'],
        "common_mistakes": ["Relationship archetypes use --name-> syntax"],
    },
    {
        "slug": "include",
        "keyword": "!include",
        "category": "directive",
        "grammar": "!include <file|directory|url>",
        "description": "Inline external DSL fragments for modularity.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/includes",
        "examples": ["!include model/people.dsl", "!include model/"],
        "common_mistakes": ["Makes workspace non-portable when using local files"],
    },
    {
        "slug": "identifiers",
        "keyword": "!identifiers",
        "category": "directive",
        "grammar": "!identifiers hierarchical|flat",
        "description": "Hierarchical identifiers allow duplicate short names in different scopes.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/identifiers",
        "examples": ["!identifiers hierarchical"],
        "common_mistakes": ["Default is flat — duplicate container names across systems fail"],
    },
    {
        "slug": "docs",
        "keyword": "!docs",
        "category": "directive",
        "grammar": "!docs <path> [importer]",
        "description": "Attach Markdown/AsciiDoc documentation to workspace/system/container.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/docs",
        "examples": ["!docs docs"],
        "common_mistakes": ["Path must be relative to DSL file"],
    },
    {
        "slug": "adrs",
        "keyword": "!adrs",
        "category": "directive",
        "grammar": "!adrs <path> [adrtools|madr|log4brains|fqn]",
        "description": "Import architecture decision records.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/adrs",
        "examples": ["!adrs adr", "!adrs decisions madr"],
        "common_mistakes": [],
    },
    {
        "slug": "script",
        "keyword": "!script",
        "category": "directive",
        "grammar": "!script <groovy|kotlin|ruby|javascript|file>",
        "description": "Inline or external script for programmatic workspace manipulation.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/scripts",
        "examples": ["!script groovy {\n    workspace.views.createDefaultViews()\n}"],
        "common_mistakes": ["Inline scripts cannot have a line with only }"],
    },
    {
        "slug": "styles",
        "keyword": "styles",
        "category": "views",
        "grammar": "styles { element <tag> { ... } relationship <tag> { ... } }",
        "description": "Visual styling for elements and relationships by tag.",
        "permitted_children": ["element", "relationship", "light", "dark"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#styles",
        "examples": ['styles {\n    element "Service" { background #1168bd }\n}'],
        "common_mistakes": ["Use tags consistently for styling"],
    },
    {
        "slug": "properties",
        "keyword": "properties",
        "category": "metadata",
        "grammar": "properties { <name> <value> ... }",
        "description": "Name/value metadata on elements, relationships, views.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#properties",
        "examples": ['properties {\n    "structurizr.inspection.model.component.description" "info"\n}'],
        "common_mistakes": ["structurizr.* properties have special meaning"],
    },
    {
        "slug": "group",
        "keyword": "group",
        "category": "model",
        "grammar": 'group <name> { ... }',
        "description": "Named boundary grouping elements at same abstraction level.",
        "permitted_children": ["varies by scope"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#group",
        "examples": ['group "Platform Services" {\n    api = container "API"\n}'],
        "common_mistakes": ["Cannot mix abstraction levels in one group"],
    },
    {
        "slug": "perspectives",
        "keyword": "perspectives",
        "category": "metadata",
        "grammar": "perspectives { <name> <description> [value] }",
        "description": "Named dimensions (security, data, ownership).",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#perspectives",
        "examples": ['perspectives {\n    "Security" "Handles PII" "Yes"\n}'],
        "common_mistakes": [],
    },
    {
        "slug": "autoLayout",
        "keyword": "autoLayout",
        "category": "view",
        "grammar": "autoLayout [lr|tb|rl|bt]",
        "description": "Automatic diagram layout direction.",
        "permitted_children": [],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#autolayout",
        "examples": ["autoLayout lr"],
        "common_mistakes": ["Manual layout is lost when autoLayout re-run"],
    },
    {
        "slug": "element",
        "keyword": "element",
        "category": "element",
        "grammar": 'element <name> [metadata] [description] [tags] { ... }',
        "description": "Custom element outside standard C4 types.",
        "permitted_children": ["description", "tags", "url", "properties", "perspectives", "->"],
        "default_tags": ["Element"],
        "doc_url": "https://docs.structurizr.com/dsl/language#element",
        "examples": ['regulation = element "GDPR" "Compliance boundary"'],
        "common_mistakes": [],
    },
    {
        "slug": "systemLandscape",
        "keyword": "systemLandscape",
        "category": "view",
        "grammar": "systemLandscape [key] [description] { ... }",
        "description": "Enterprise landscape across all software systems.",
        "permitted_children": ["include", "exclude", "autoLayout", "default", "animation", "title", "description", "properties"],
        "default_tags": [],
        "doc_url": "https://docs.structurizr.com/dsl/language#systemlandscape-view",
        "examples": ['systemLandscape "Landscape" {\n    include *\n}'],
        "common_mistakes": [],
    },
]

ELEMENT_EXPRESSIONS = [
    {"form": "-><identifier|expression>", "meaning": "element(s) plus afferent couplings"},
    {"form": "<identifier|expression>->", "meaning": "element(s) plus efferent couplings"},
    {"form": "-><identifier|expression>->", "meaning": "element(s) plus afferent and efferent couplings"},
    {"form": "element.type==<type>", "meaning": "Person, SoftwareSystem, Container, Component, DeploymentNode, InfrastructureNode, SoftwareSystemInstance, ContainerInstance, Custom"},
    {"form": "element.parent==<identifier>", "meaning": "elements with specified parent"},
    {"form": "element.tag==<tag>[,tag]", "meaning": "elements having all specified tags"},
    {"form": "element.tag!=<tag>[,tag]", "meaning": "elements not having all specified tags"},
    {"form": "element.technology==<technology>", "meaning": "elements with technology"},
    {"form": "element.properties[name]==value", "meaning": "elements with property value"},
    {"form": "element.group==name", "meaning": "elements in group"},
]

RELATIONSHIP_EXPRESSIONS = [
    {"form": "*->*", "meaning": "all relationships"},
    {"form": "<identifier>->*", "meaning": "relationships from source"},
    {"form": "*-><identifier>", "meaning": "relationships to destination"},
    {"form": "relationship.tag==<tag>", "meaning": "relationships with tags"},
    {"form": "relationship.source==<identifier>", "meaning": "relationships from element"},
    {"form": "relationship.destination==<identifier>", "meaning": "relationships to element"},
    {"form": "relationship==<id>-><id>", "meaning": "relationships between two elements"},
]

INSPECTIONS = [
    {"type": "workspace.scope", "description": "Workspace scope inspections"},
    {"type": "workspace.tooling", "description": "Tooling inspections"},
    {"type": "model.empty", "description": "Empty model"},
    {"type": "model.person.description", "description": "Person with no description"},
    {"type": "model.softwaresystem.description", "description": "Software system with no description"},
    {"type": "model.container.description", "description": "Container with no description"},
    {"type": "model.container.technology", "description": "Container with no technology"},
    {"type": "model.component.description", "description": "Component with no description"},
    {"type": "model.component.technology", "description": "Component with no technology"},
    {"type": "model.element.disconnected", "description": "Disconnected element"},
    {"type": "model.element.noview", "description": "Element not in any view"},
    {"type": "model.relationship.description", "description": "Relationship with no description"},
    {"type": "model.relationship.technology", "description": "Relationship with no technology"},
    {"type": "views.empty", "description": "Empty viewset"},
    {"type": "views.view.empty", "description": "Empty view"},
    {"type": "views.view.key", "description": "View key inspections"},
    {"type": "views.view.layout", "description": "Layout inspections"},
]

PATTERNS = [
    {"slug": "kubernetes", "name": "Kubernetes", "doc_url": "https://docs.structurizr.com/dsl/patterns/kubernetes"},
    {"slug": "microservice", "name": "Microservice", "doc_url": "https://docs.structurizr.com/dsl/patterns/microservice"},
    {"slug": "api-gateway", "name": "API Gateway", "doc_url": "https://docs.structurizr.com/dsl/patterns/api-gateway"},
    {"slug": "load-balancer", "name": "Load Balancer", "doc_url": "https://docs.structurizr.com/dsl/patterns/load-balancer"},
    {"slug": "docker", "name": "Docker", "doc_url": "https://docs.structurizr.com/dsl/patterns/docker"},
    {"slug": "firewall", "name": "Firewall", "doc_url": "https://docs.structurizr.com/dsl/patterns/firewall"},
    {"slug": "aws-eks", "name": "AWS EKS", "doc_url": "https://docs.structurizr.com/dsl/patterns/aws-eks"},
    {"slug": "aws-fargate", "name": "AWS Fargate", "doc_url": "https://docs.structurizr.com/dsl/patterns/aws-fargate"},
    {"slug": "aws-lambda", "name": "AWS Lambda", "doc_url": "https://docs.structurizr.com/dsl/patterns/aws-lambda"},
    {"slug": "aws-app-runner", "name": "AWS App Runner", "doc_url": "https://docs.structurizr.com/dsl/patterns/aws-app-runner"},
    {"slug": "hardware-system", "name": "Hardware System", "doc_url": "https://docs.structurizr.com/dsl/patterns/hardware-system"},
]

COOKBOOK = [
    {"slug": "system-context-view", "name": "System Context View"},
    {"slug": "container-view", "name": "Container View"},
    {"slug": "component-view", "name": "Component View"},
    {"slug": "deployment-view", "name": "Deployment View"},
    {"slug": "dynamic-view", "name": "Dynamic View"},
    {"slug": "filtered-view", "name": "Filtered View"},
    {"slug": "workspace-extension", "name": "Workspace Extension"},
    {"slug": "implied-relationships", "name": "Implied Relationships"},
    {"slug": "groups", "name": "Groups"},
    {"slug": "deployment-groups", "name": "Deployment Groups"},
    {"slug": "element-styles", "name": "Element Styles"},
    {"slug": "relationship-styles", "name": "Relationship Styles"},
    {"slug": "themes", "name": "Themes"},
    {"slug": "perspectives-static", "name": "Perspectives (Static)"},
    {"slug": "perspectives-dynamic", "name": "Perspectives (Dynamic)"},
    {"slug": "custom-elements", "name": "Custom Elements"},
    {"slug": "custom-view", "name": "Custom View"},
    {"slug": "scripts", "name": "Scripts"},
    {"slug": "shared-components", "name": "Shared Components"},
    {"slug": "bulk-operations-elements", "name": "Bulk Operations - Elements"},
    {"slug": "amazon-web-services", "name": "Amazon Web Services"},
    {"slug": "image-view", "name": "Image View"},
]

RELATIONSHIP_MATRIX = [
    {"source": "Person", "destinations": ["Person", "SoftwareSystem", "Container", "Component"]},
    {"source": "SoftwareSystem", "destinations": ["Person", "SoftwareSystem", "Container", "Component"]},
    {"source": "Container", "destinations": ["Person", "SoftwareSystem", "Container", "Component"]},
    {"source": "Component", "destinations": ["Person", "SoftwareSystem", "Container", "Component"]},
    {"source": "DeploymentNode", "destinations": ["DeploymentNode"]},
    {"source": "InfrastructureNode", "destinations": ["DeploymentNode", "InfrastructureNode", "SoftwareSystemInstance", "ContainerInstance"]},
]

SKILLS = [
    ("structurizr-orchestrator", "Route Structurizr/C4 modeling work and enforce validate gates.", True),
    ("c4-model-architect", "C4 abstraction level decisions and anti-patterns.", True),
    ("structurizr-workspace-scaffold", "Bootstrap workspace.dsl with enterprise layout.", True),
    ("structurizr-model-builder", "Author model elements: people, systems, groups.", False),
    ("structurizr-container-component-designer", "C2/C3 container and component decomposition.", False),
    ("structurizr-relationship-designer", "Relationships, implied relationships, archetypes.", False),
    ("structurizr-view-composer", "Static views: landscape, context, container, component.", False),
    ("structurizr-dynamic-view-author", "Dynamic interaction/sequence views.", False),
    ("structurizr-deployment-modeler", "Deployment environments, nodes, instances.", False),
    ("structurizr-dsl-language-reference", "Deterministic DSL keyword lookup — never guess syntax.", True),
    ("structurizr-expression-builder", "Build include/exclude and bulk expressions.", False),
    ("structurizr-archetype-designer", "Element and relationship archetypes.", False),
    ("structurizr-filtered-views", "Stakeholder-specific filtered views.", False),
    ("structurizr-perspectives", "Static and dynamic perspectives.", False),
    ("structurizr-styles-themer", "Element/relationship styles and themes.", False),
    ("structurizr-modular-dsl", "Includes, constants, workspace extension.", False),
    ("structurizr-docs-adrs", "Attach documentation and ADRs.", False),
    ("structurizr-pattern-catalog", "Apply Structurizr pattern catalog entries.", False),
    ("structurizr-cookbook-executor", "Follow cookbook recipes step by step.", False),
    ("structurizr-custom-elements", "Custom elements outside C4.", False),
    ("structurizr-validator", "Validate and lint workspaces.", True),
    ("structurizr-inspector", "Workspace inspections and severity tuning.", False),
    ("structurizr-consistency-reviewer", "Pre-PR model consistency review.", False),
    ("structurizr-abstraction-auditor", "Verify correct C4 abstraction level.", False),
    ("structurizr-drift-detector", "Compare model against codebase reality.", False),
    ("structurizr-diff-reviewer", "Workspace diff for PR review.", False),
    ("structurizr-export-engineer", "Export to PlantUML, Mermaid, DOT, JSON.", False),
    ("structurizr-cli-operator", "Structurizr CLI push/pull/lock/merge.", False),
    ("structurizr-layout-merge", "Merge layout from JSON exports.", False),
    ("structurizr-onprem-lite", "Structurizr Lite local workflow.", False),
    ("structurizr-script-plugin-author", "Scripts and Java plugins.", False),
    ("structurizr-enterprise-governance", "Multi-team workspace extension and governance.", False),
]

COMMANDS = [
    ("structurizr-help", "Show command catalog"),
    ("structurizr-lookup", "DSL language reference lookup"),
    ("structurizr-validate", "Validate and inspect workspace"),
    ("structurizr-scaffold", "Bootstrap workspace"),
    ("structurizr-pattern", "Pattern catalog lookup"),
    ("structurizr-cookbook", "Cookbook recipe"),
    ("structurizr-export", "Export diagrams"),
    ("structurizr-explain", "Explain C4/DSL concept"),
    ("structurizr-expression", "Build include/exclude expression"),
    ("structurizr-inspect", "Run inspections"),
    ("structurizr-examples", "Copyable MCP/CLI examples"),
    ("structurizr-diff", "Model diff"),
]


def write_yaml(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")


def write_md(path: Path, title: str, body: str, meta: dict | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    front = "---\n"
    if meta:
        for k, v in meta.items():
            front += f"{k}: {json.dumps(v) if isinstance(v, (list, dict)) else v}\n"
    front += "---\n\n"
    path.write_text(front + f"# {title}\n\n{body}\n", encoding="utf-8")


def skill_template(name: str, description: str, user_invocable: bool) -> str:
    title = name.replace("-", " ").title()
    invocable = "true" if user_invocable else "false"
    return f"""---
name: {name}
description: {description}
when_to_use: Use for Structurizr DSL and C4 modeling tasks involving {title.lower()}.
argument-hint: "[workspace-or-keyword]"
user-invocable: {invocable}
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(structurizr *)
model: inherit
---

# {title}

Use the bundled Structurizr reference catalog and CLI — never guess DSL syntax from memory.

## Deterministic workflow

1. Run `structurizr lookup <keyword>` before using unfamiliar syntax.
2. Run `structurizr lint <file.dsl>` after edits.
3. Run `structurizr validate <file.dsl>` when Structurizr CLI is installed.
4. Run `structurizr inspect <file.dsl>` for workspace inspections.

## References

- Keyword index: `data/keywords/`
- Expressions: `data/expressions/`
- Patterns: `data/patterns/`
- Cookbook: `data/cookbook/`
- C4 guidance: `data/c4/`
- Inspections: `data/inspections/types.yaml`

## Useful commands

```bash
structurizr lookup container
structurizr expressions element
structurizr pattern kubernetes
structurizr cookbook deployment-view
structurizr scaffold monolith
structurizr lint workspace.dsl
structurizr validate workspace.dsl
```
"""


def main() -> None:
    keywords_dir = DATA / "keywords"
    for entry in KEYWORDS:
        write_yaml(keywords_dir / f"{entry['slug']}.yaml", entry)

    write_yaml(DATA / "expressions" / "element-expressions.yaml", {"expressions": ELEMENT_EXPRESSIONS})
    write_yaml(DATA / "expressions" / "relationship-expressions.yaml", {"expressions": RELATIONSHIP_EXPRESSIONS})
    write_yaml(DATA / "inspections" / "types.yaml", {"inspections": INSPECTIONS})
    write_yaml(DATA / "relationship-matrix.yaml", {"matrix": RELATIONSHIP_MATRIX})

    for p in PATTERNS:
        write_md(
            DATA / "patterns" / f"{p['slug']}.md",
            p["name"],
            f"Structurizr pattern: **{p['name']}**.\n\nSee official docs: {p['doc_url']}\n\nUse `structurizr pattern {p['slug']}` for CLI summary.",
            {"slug": p["slug"], "doc_url": p["doc_url"]},
        )

    for c in COOKBOOK:
        slug = c["slug"]
        write_md(
            DATA / "cookbook" / f"{slug}.md",
            c["name"],
            f"Cookbook recipe: **{c['name']}**.\n\nOfficial: https://docs.structurizr.com/dsl/cookbook/{slug}/\n\nUse `structurizr cookbook {slug}`.",
            {"slug": slug},
        )

    write_md(
        DATA / "c4" / "levels.md",
        "C4 Model Levels",
        """| Level | DSL element | View |
|---|---|---|
| C1 Context | softwareSystem | systemContext |
| C2 Container | container | container view |
| C3 Component | component | component view |
| C4 Code | (optional, outside Structurizr) | — |
| Deployment | deploymentNode, instances | deployment view |
| Dynamic | relationships ordered | dynamic view |

**Rules:** Technology belongs at container+ level. People interact with systems or containers, not individual classes. One workspace, many views.""",
    )

    write_md(
        DATA / "c4" / "anti-patterns.md",
        "C4 Anti-Patterns",
        """- Database icon inside every component view
- HTTP/REST at system context (C1) without containers
- Duplicate relationship descriptions for same source→destination
- Auto-generated view keys (layout loss on regenerate)
- Mixing deployment nodes into structural container views
- Forward references in DSL (imperative ordering required)""",
    )

    dsl_index = {
        "version": "0.1.0",
        "source": "https://docs.structurizr.com/dsl/language",
        "keywords": [k["slug"] for k in KEYWORDS],
        "patterns": [p["slug"] for p in PATTERNS],
        "cookbook": [c["slug"] for c in COOKBOOK],
        "skills": [s[0] for s in SKILLS],
        "commands": [c[0] for c in COMMANDS],
    }
    (DATA / "dsl-index.json").write_text(json.dumps(dsl_index, indent=2) + "\n", encoding="utf-8")

    skills_dir = ROOT / "skills"
    for name, desc, invocable in SKILLS:
        skill_dir = skills_dir / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(skill_template(name, desc, invocable), encoding="utf-8")

    commands_dir = ROOT / "commands"
    for cmd, desc in COMMANDS:
        commands_dir.mkdir(parents=True, exist_ok=True)
        (commands_dir / f"{cmd}.md").write_text(
            f"""---
description: {desc}
argument-hint: "[args]"
---

Run the structurizr CLI:

```bash
structurizr {cmd.removeprefix('structurizr-').replace('-', ' ')} $ARGUMENTS
```

For MCP: use the `structurizr` MCP server tools.
""",
            encoding="utf-8",
        )

    agents_dir = ROOT / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    (agents_dir / "structurizr-architect.md").write_text(
        """---
name: structurizr-architect
description: Deep Structurizr workspace authoring — model, views, deployment, validation.
---

You are a Structurizr/C4 architect. Always use `structurizr lookup` before DSL syntax. Validate and inspect after every change. Prefer explicit view keys. Use hierarchical identifiers for multi-system workspaces.
""",
        encoding="utf-8",
    )

    print(f"Generated {len(KEYWORDS)} keywords, {len(PATTERNS)} patterns, {len(COOKBOOK)} cookbook entries, {len(SKILLS)} skills")


if __name__ == "__main__":
    main()