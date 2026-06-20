---
name: bytedesk-confluence
description: ByteDesk Confluence knowledge operations. Use this skill for any interaction with the ByteDesk Platform Confluence space — searching for existing docs, creating new pages, linking pages to Jira tickets, and retrieving operational runbooks or architecture notes before making decisions. Invoke when the user says "search confluence", "find docs", "create confluence page", "document this in confluence", "link to jira", "check the docs", "write runbook", "what does confluence say about", or when making a decision that depends on project context not in the codebase.
user-invokable: true
argument-hint: "[search query | create <title> | update <page-id>]"
allowed-tools:
  - mcp__atlassian__search
  - mcp__atlassian__searchConfluenceUsingCql
  - mcp__atlassian__getConfluencePage
  - mcp__atlassian__getConfluenceSpaces
  - mcp__atlassian__getPagesInConfluenceSpace
  - mcp__atlassian__getConfluencePageDescendants
  - mcp__atlassian__createConfluencePage
  - mcp__atlassian__updateConfluencePage
  - mcp__atlassian__createConfluenceFooterComment
  - mcp__atlassian__addCommentToJiraIssue
  - mcp__atlassian__createIssueLink
---

## Fixed Defaults

Never call `getAccessibleAtlassianResources`:

- **cloudId**: `bytedesk.atlassian.net`
- **Primary space**: `491524` (name: "ByteDesk Platform")
- **maxResults**: 10 on all CQL unless user says otherwise

## Operation 1: Search for Existing Docs

Use Confluence search before creating new pages — avoid duplicates:

```
searchConfluenceUsingCql:
  cql: space = "491524" AND text ~ "<keyword>" ORDER BY lastmodified DESC
  maxResults: 10
```

Or use the general Atlassian search (searches across Jira + Confluence):

```
search:
  query: "<keyword>"
  maxResults: 10
```

Present results as a ranked list with page title, last modified date, and a one-sentence summary of what the page covers. If a good match exists, read that page before creating a new one.

## Operation 2: Read a Page

```
getConfluencePage:
  cloudId: bytedesk.atlassian.net
  pageId: <id-from-search-results>
```

Use this to pull in context before implementation decisions — architecture notes, runbooks, past review outcomes, design decisions not yet codified as ADRs.

## Operation 3: Create a New Page

Use `createConfluencePage` with these conventions:

**Required fields**:
- `spaceId`: `491524`
- `title`: Clear, searchable title (include service name or feature name if applicable)
- `parentId`: Use a relevant parent page if one exists (search for it first); omit if this is a top-level page
- `body`: Content in Atlassian storage format (HTML-like markup)

**Page types and where to put them**:

| Content type | Parent page to search for |
|---|---|
| Architecture / design notes | "Architecture" or "Design" |
| Runbooks / operational docs | "Runbooks" or "Operations" |
| Feature documentation | "Features" or service-specific page |
| Review notes / decisions | "Reviews" or "Decisions" |
| Onboarding / setup guides | "Onboarding" |

**Body format** (Confluence storage format):

```html
<p>Brief summary of what this page covers and why it exists.</p>

<h2>Context</h2>
<p>[Background and motivation]</p>

<h2>Details</h2>
<p>[Main content]</p>

<h2>Related</h2>
<ul>
  <li><a href="https://bytedesk.atlassian.net/browse/BDP-N">BDP-N: Related Jira task</a></li>
  <li><a href="https://github.com/ByteDeskAI/bytedesk-platform/docs/architecture/adr/NNN-title.md">ADR-NNN</a></li>
</ul>
```

## Operation 4: Update an Existing Page

```
updateConfluencePage:
  cloudId: bytedesk.atlassian.net
  pageId: <id>
  title: <unchanged or updated title>
  body: <updated content>
  version: <current version + 1>
```

Always fetch the current page first to get the current version number before updating. Updating with a stale version number will fail.

## Operation 5: Link a Confluence Page to a Jira Issue

After creating a page, add it as a remote link on the corresponding Jira issue so they're connected in both directions:

1. Get the new page URL from the `createConfluencePage` response
2. Use the Atlassian MCP to add a comment on the Jira issue with the Confluence page URL:

```
addCommentToJiraIssue:
  cloudId: bytedesk.atlassian.net
  issueIdOrKey: BDP-N
  body: "Confluence doc: <page URL>"
```

Alternatively, use `createIssueLink` if a formal remote link type is available.

## When to Search vs. Create

**Search first** when:
- Starting work on a known feature area ("what do the docs say about the prospecting pipeline?")
- Before an architecture decision ("is there prior context on multi-tenancy for the AI service?")
- When the user says "check the docs" or "what does Confluence say about X"

**Create** when:
- A decision was made that should survive session boundaries
- A runbook is needed that doesn't exist yet
- New architecture / design notes need to live somewhere discoverable
- After a daily review or sprint retrospective

## Output

After search:
```
Found 3 pages matching "prospecting pipeline":
  1. "Sales Service — Prospecting Architecture" (modified 3 days ago)
     ↳ Covers the radar scan workflow, mission control UI, and BDP-61 scope
  2. "HVAC Vertical — Phase 1 Launch Plan" (modified 1 week ago)
     ↳ Sun Belt metros, AZ ROC data source, Aug outbound timing
  3. ...
```

After creating:
```
Created: "AI Receptionist — Onboarding Flow Design"
URL: https://bytedesk.atlassian.net/wiki/spaces/BP/pages/NNNNNN
Linked to: BDP-N (Jira comment added)
```
