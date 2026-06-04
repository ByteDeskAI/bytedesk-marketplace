---
name: pm-init
description: Initialize a localized project management workspace.
when_to_use: Use when the user requests to set up, initialize, or start project tracking, Jira board, or Confluence documentation in the current project directory. Typical phrases: "/pm:init", "initialize project management", "set up local jira".
argument-hint: "[project_name] [--prefix KEY]"
user-invokable: true
disable-model-invocation: false
allowed-tools:
  - pm_init
model: inherit
---

# Project Management Workspace Initialization

Use this skill to initialize a new localized project management workspace.

## Steps

1. Run the `pm_init` tool with optional arguments `project_name` and `key_prefix`.
2. The tool will create a `.pm/` folder in the current directory containing:
   - `issues/` (tickets database)
   - `docs/` (wiki pages database)
   - `project.json` (sprints, configurations, logs)
3. Report success to the user and explain that they can now use `/pm:ticket` and `/pm:doc` to manage their tasks and documentation.
