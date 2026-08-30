# Agent Mail - Product Direction

## Purpose

Agent Mail is a self-hosted email client with a mailbox-scoped AI agent, running
on Cloudflare Workers. Incoming mail arrives through Cloudflare Email Routing;
each mailbox uses its own Durable Object and SQLite store, while attachments use
R2. The product keeps ordinary email work primary and makes agent assistance
inspectable and human-controlled.

## Users and promises

- Operators manage inboxes, threads, attachments, folders, drafts, and outbound
  mail through familiar, efficient email workflows.
- The mailbox agent can read, search, organize, and draft with visible tool
  activity and durable mailbox scope.
- Agent-produced replies remain drafts until a person reviews them in the
  composer and explicitly sends them.
- Cloudflare Access is the application trust boundary in shared environments;
  the interface does not imply per-mailbox authorization that the backend does
  not enforce.

## Primary surfaces

- Mailbox index and mailbox creation.
- Folder and conversation navigation.
- Single-message and expandable-thread reading.
- New, reply, reply-all, forward, and draft-editing compose workflows.
- Search with supported mail operators.
- Mailbox settings and agent prompt configuration.
- Agent chat with visible tools, draft review, and MCP connection details.

## Product truth boundaries

The product does not currently promise autonomous send, semantic search,
scheduled or undo send, delivery or bounce truth, offline/PWA operation, cloud
team collaboration, rules, or labels. Agent actions remain mailbox-scoped. The
agent does not gain a send tool through visual design.

## Voice

Calm, exact, and correspondence-first. Mail language remains human and readable;
addresses, timestamps, tool names, and infrastructure identifiers remain
verbatim. Approval boundaries state their consequence plainly.

## Register

Product.
