---
name: pm-doc
description: Create, view, list, or search wiki/confluence documentation pages.
when_to_use: Use when the user wants to write wiki pages, create documentation, search documentation, view a wiki article, or modify an existing document page. Typical phrases: "/pm:doc", "create confluence page", "write doc", "view wiki page DOC-1", "search documentation".
argument-hint: "[action] [id/title] [options]"
user-invokable: true
disable-model-invocation: false
allowed-tools:
  - pm_doc_create
  - pm_doc_update
  - pm_doc_get
  - pm_doc_list
model: inherit
---

# Documentation / Wiki (Confluence equivalent)

Create and manage markdown wiki pages in your local workspace.

## Documentation Actions

- **Create**: Call `pm_doc_create` with a title, markdown content, and an optional `parent_id` to build a page hierarchy.
- **Update**: Modify a page's title, body, or parent page using `pm_doc_update`.
- **View Details**: Read a wiki page's markdown body and metadata using `pm_doc_get`.
- **List / Search**: List all pages or search page contents using `pm_doc_list`.
