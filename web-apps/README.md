# Web Apps

Web Apps adds a project-level workspace to ByteDesk Gateway. Each discovered
`.bytedesk-webapp.json` marker gets its own application selector entry, coding
conversation, agent runs, services, logs, and preview state. Selecting another
application or project view does not stop active work.

The plugin follows the Gateway plugin template: one SDK plugin implementation runs
linked or as the `web-apps` process, while its trusted owner-local ES module mounts
inside Projects. A same-origin HTML fallback remains available for hosts that do not
admit module mounting.

## Package checks

```sh
go test ./...
node --test tests/*.test.mjs
go run ./cmd/manifest > plugin.json
go run github.com/ByteDeskAI/bytedesk-remote-gateway-plugin-sdk/cmd/plugin-sdk validate --dir .
```

Run `node tests/ui-lifecycle.mjs` when Playwright is importable. Set
`PLAYWRIGHT_MODULE` to its `index.js` path when using a shared installation. The fixture
checks the empty state, active app shell, narrow-screen Preview navigation, creation
wizard, and generation cleanup in Chromium.

The host owns project and worktree resolution, marker discovery, coding sessions,
processes, preview proxying, and shares. The browser module requests those typed host
operations; it never scans the filesystem or starts a process itself.

The version 1 marker contract is published with the plugin at
[`schema/bytedesk-webapp.schema.json`](./schema/bytedesk-webapp.schema.json). Commands
are argument arrays executed directly. The schema admits only `${PORT}` and
`${services.<id>.port}` placeholders and describes the optional HTTP readiness path,
timeout, and interval used by Gateway's strict configuration parser.
