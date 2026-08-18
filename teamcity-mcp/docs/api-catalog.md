# TeamCity REST API catalog

Source: `swagger.json` captured live from the target server (TeamCity 2026.1, Swagger 2.0).
Totals: **268 paths**, 449 operations — 235 GET · 92 PUT · 62 POST · 60 DELETE.
Full machine-readable surface: `GET /app/rest/swagger.json` on the server.

**Auth:** Bearer token (`Authorization: Bearer <token>`) against `/app/rest/...`; HTTP basic auth uses
the same paths under the `/httpAuth` prefix (this MCP server's client inserts it automatically).

**Locators, fields, pagination:**

- Collection GETs accept `?locator=` and `?fields=`; single-entity paths embed the locator, e.g. `/builds/id:12345`.
- Locator DSL: comma-separated `dimension:value`, nested with parentheses — `buildType:(id:Deploy_Prod),status:FAILURE`.
- `?fields=` projects partial responses: `count,build(id,number,status)`. Lists otherwise return only basic fields.
- Paging: `count` (default 100) plus `start` (0-based offset); the response carries `nextHref` while more pages exist.
- Unbounded locators are capped server-side by `lookupLimit` (default 5000) — bound large scans with id/date dimensions.
- Discovery: `GET /app/rest/<collection>/$help` lists the locator dimensions that endpoint supports.

**Notation:** paths below are relative to `/app/rest`. Comma-joined backticked paths on one line share the listed
verbs. `{a,b,}` inside a path lists alternatives (empty = omit the segment): `artifacts/{archived,files,metadata,}{path}`
= `artifacts/archived{path}`, `artifacts/files{path}`, `artifacts/metadata{path}`, `artifacts/{path}`.

## buildTypes — 50 paths · configurations/templates: settings, steps, triggers, dependencies, parameters, VCS attachments

- `/buildTypes` — GET POST
- `/buildTypes/{btLocator}` — GET DELETE
- `/buildTypes/{btLocator}/{field}` — GET PUT
- `/buildTypes/{btLocator}/agent-requirements` — GET POST PUT
- `/buildTypes/{btLocator}/agent-requirements/{agentRequirementLocator}` — GET PUT DELETE
- `/buildTypes/{btLocator}/agent-requirements/{agentRequirementLocator}/{fieldName}` — GET PUT
- `/buildTypes/{btLocator}/aliases`, `.../branches`, `.../buildTags`, `.../builds`, `.../investigations`, `.../settingsFile`, `.../vcsRootInstances` — GET (all under the /buildTypes/{btLocator}/ prefix)
- `/buildTypes/{btLocator}/artifact-dependencies` — GET POST PUT
- `/buildTypes/{btLocator}/artifact-dependencies/{artifactDepLocator}` — GET PUT DELETE
- `/buildTypes/{btLocator}/artifact-dependencies/{artifactDepLocator}/{fieldName}` — GET PUT
- `/buildTypes/{btLocator}/features` — GET POST PUT
- `/buildTypes/{btLocator}/features/{featureId}` — GET PUT DELETE
- `/buildTypes/{btLocator}/features/{featureId}/parameters`, `.../parameters/{parameterName}` — GET PUT
- `/buildTypes/{btLocator}/features/{featureId}/{name}` — GET PUT
- `/buildTypes/{btLocator}/move` — POST
- `/buildTypes/{btLocator}/output-parameters` — GET POST PUT DELETE
- `/buildTypes/{btLocator}/output-parameters/{name}` — GET PUT DELETE
- `/buildTypes/{btLocator}/output-parameters/{name}/value` — GET PUT
- `/buildTypes/{btLocator}/parameters` — GET POST PUT DELETE
- `/buildTypes/{btLocator}/parameters/{name}` — GET PUT DELETE
- `/buildTypes/{btLocator}/parameters/{name}/type`, `.../type/rawValue`, `.../value` — GET PUT
- `/buildTypes/{btLocator}/snapshot-dependencies` — GET POST PUT
- `/buildTypes/{btLocator}/snapshot-dependencies/{snapshotDepLocator}` — GET PUT DELETE
- `/buildTypes/{btLocator}/steps` — GET POST PUT
- `/buildTypes/{btLocator}/steps/{stepId}` — GET PUT DELETE
- `/buildTypes/{btLocator}/steps/{stepId}/parameters`, `.../parameters/{parameterName}` — GET PUT
- `/buildTypes/{btLocator}/steps/{stepId}/{fieldName}` — GET PUT
- `/buildTypes/{btLocator}/templates` — GET POST PUT DELETE
- `/buildTypes/{btLocator}/templates/{templateLocator}` — GET DELETE
- `/buildTypes/{btLocator}/triggers` — GET POST PUT
- `/buildTypes/{btLocator}/triggers/{triggerLocator}` — GET PUT DELETE
- `/buildTypes/{btLocator}/triggers/{triggerLocator}/{fieldName}` — GET PUT
- `/buildTypes/{btLocator}/vcs-root-entries` — GET POST PUT
- `/buildTypes/{btLocator}/vcs-root-entries/{vcsRootLocator}` — GET PUT DELETE
- `/buildTypes/{btLocator}/vcs-root-entries/{vcsRootLocator}/checkout-rules` — GET PUT
- `/buildTypes/{btLocator}/vcs/files/latest` — GET
- `/buildTypes/{btLocator}/vcs/files/latest/{archived,files,metadata,}{path}` — GET (4 paths)

## builds — 41 paths · build instances: query, cancel, finish, comment, pin, tag, artifacts, statistics, tests

- `/builds` — GET
- `/builds/aggregated/{buildLocator}/status`, `.../statusIcon{suffix}` — GET (under the /builds/aggregated/{buildLocator}/ prefix)
- `/builds/multiple/{buildLocator}` — GET POST DELETE
- `/builds/multiple/{buildLocator}/comment` — PUT DELETE
- `/builds/multiple/{buildLocator}/pinInfo` — PUT
- `/builds/multiple/{buildLocator}/tags` — POST DELETE
- `/builds/{buildLocator}` — GET POST DELETE
- `/builds/{buildLocator}/{field}` — GET
- `/builds/{buildLocator}/artifactDependencyChanges`, `.../artifacts`, `.../artifactsDirectory`, `.../canceledInfo`, `.../relatedIssues`, `.../statusIcon{suffix}`, `.../testOccurrences` — GET (under the /builds/{buildLocator}/ prefix)
- `/builds/{buildLocator}/artifacts/{archived,files,metadata,}{path}` — GET (4 paths: zipped download, file download, metadata, list children)
- `/builds/{buildLocator}/caches/finishProperties` — DELETE
- `/builds/{buildLocator}/comment` — PUT DELETE
- `/builds/{buildLocator}/finish` — PUT
- `/builds/{buildLocator}/finishDate`, `.../number`, `.../statusText` — GET PUT
- `/builds/{buildLocator}/log` — POST
- `/builds/{buildLocator}/output-parameters`, `.../output-parameters/{propertyName}` — GET
- `/builds/{buildLocator}/pinInfo` — GET PUT
- `/builds/{buildLocator}/problemOccurrences` — GET POST
- `/builds/{buildLocator}/resolved/{value}` — GET
- `/builds/{buildLocator}/resulting-properties`, `.../resulting-properties/{propertyName}` — GET
- `/builds/{buildLocator}/runningData` — PUT
- `/builds/{buildLocator}/sources/files/{fileName}` — GET
- `/builds/{buildLocator}/statistics`, `.../statistics/{name}` — GET
- `/builds/{buildLocator}/status` — GET POST
- `/builds/{buildLocator}/tags` — GET POST PUT
- `/builds/{buildLocator}/vcsLabels` — GET POST

## projects — 35 paths · project tree, project-level settings and parameters, features, versioned settings

- `/projects` — GET POST
- `/projects/{projectLocator}` — GET DELETE
- `/projects/{projectLocator}/{field}` — GET PUT
- `/projects/{projectLocator}/agentPools` — GET POST PUT
- `/projects/{projectLocator}/agentPools/{agentPoolLocator}` — DELETE
- `/projects/{projectLocator}/branches`, `.../defaultValueSets`, `.../settingsFile` — GET
- `/projects/{projectLocator}/buildTypes` — POST (create a build configuration in this project)
- `/projects/{projectLocator}/templates` — GET POST
- `/projects/{projectLocator}/defaultTemplate` — GET PUT DELETE
- `/projects/{projectLocator}/deploymentDashboards`, `.../deploymentDashboards/{dashboardLocator}` — GET
- `/projects/{projectLocator}/order/buildTypes`, `.../projects` — GET PUT
- `/projects/{projectLocator}/parameters` — GET POST PUT DELETE
- `/projects/{projectLocator}/parameters/{name}` — GET PUT DELETE
- `/projects/{projectLocator}/parameters/{name}/type`, `.../type/rawValue`, `.../value` — GET PUT
- `/projects/{projectLocator}/parentProject` — GET PUT
- `/projects/{projectLocator}/projectFeatures` — GET POST PUT
- `/projects/{projectLocator}/projectFeatures/{featureLocator}` — GET PUT DELETE
- `/projects/{projectLocator}/secure/tokens` — POST
- `/projects/{projectLocator}/secure/values/{token}` — GET
- `/projects/{locator}/versionedSettings/affectedProjects`, `.../status`, `.../config/effective` — GET
- `/projects/{locator}/versionedSettings/checkForChanges`, `.../commitCurrentSettings`, `.../loadSettings` — POST
- `/projects/{locator}/versionedSettings/config` — GET PUT
- `/projects/{locator}/versionedSettings/config/parameters/{name}` — GET PUT DELETE
- `/projects/{locator}/versionedSettings/contextParameters` — GET PUT
- `/projects/{locator}/versionedSettings/tokens` — GET POST DELETE

## server — 22 paths · server info, auth & global settings, backup/cleanup, licensing, metrics, multi-node, plugins

- `/server`, `/server/{field}` — GET
- `/server/authSettings` — GET PUT
- `/server/backup` — GET POST
- `/server/cleanup`, `/server/globalSettings` — GET PUT
- `/server/files/{areaId}` — GET
- `/server/files/{areaId}/{archived,files,metadata,}{path}` — GET (4 paths; areaId e.g. `.BuildServer`)
- `/server/licensingData` — GET
- `/server/licensingData/licenseKeys` — GET POST
- `/server/licensingData/licenseKeys/{licenseKey}` — GET DELETE
- `/server/metrics`, `/server/nodes`, `/server/plugins` — GET
- `/server/nodes/{nodeLocator}` — GET
- `/server/nodes/{nodeLocator}/disabledResponsibilities`, `.../effectiveResponsibilities`, `.../enabledResponsibilities` — GET
- `/server/nodes/{nodeLocator}/enabledResponsibilities/{name}` — PUT

## users — 14 paths · user accounts, properties, role assignments, group membership, access tokens

- `/users` — GET POST
- `/users/{userLocator}` — GET PUT DELETE
- `/users/{userLocator}/{field}` — GET PUT DELETE
- `/users/{userLocator}/debug/rememberMe` — DELETE
- `/users/{userLocator}/groups` — GET PUT
- `/users/{userLocator}/groups/{groupLocator}` — GET DELETE
- `/users/{userLocator}/logout` — POST
- `/users/{userLocator}/permissions`, `.../properties` — GET
- `/users/{userLocator}/properties/{name}` — GET PUT DELETE
- `/users/{userLocator}/roles` — GET POST PUT
- `/users/{userLocator}/roles/{roleId}/{scope}` — GET PUT DELETE
- `/users/{userLocator}/tokens` — GET POST
- `/users/{userLocator}/tokens/{name}` — DELETE

## vcs-root-instances — 13 paths · live VCS root instances: repository state, file browsing, change-check queue, commit hooks

- `/vcs-root-instances` — GET
- `/vcs-root-instances/checkingForChangesQueue`, `.../commitHookNotification` — POST
- `/vcs-root-instances/{vcsRootInstanceLocator}` — GET
- `/vcs-root-instances/{vcsRootInstanceLocator}/{field}` — GET PUT DELETE
- `/vcs-root-instances/{vcsRootInstanceLocator}/files/latest` — GET
- `/vcs-root-instances/{vcsRootInstanceLocator}/files/latest/{archived,files,metadata,}{path}` — GET (4 paths)
- `/vcs-root-instances/{vcsRootInstanceLocator}/properties` — GET
- `/vcs-root-instances/{vcsRootInstanceLocator}/repositoryState` — GET PUT DELETE
- `/vcs-root-instances/{vcsRootInstanceLocator}/repositoryState/creationDate` — GET

## changes — 10 paths · VCS changes (commits) with their builds, issues, duplicates, parent revisions — all read-only

- `/changes`, `/changes/{changeLocator}` — GET
- `/changes/{changeLocator}/{field}` — GET
- `/changes/{changeLocator}/attributes`, `.../duplicates`, `.../firstBuilds`, `.../issues` — GET
- `/changes/{changeLocator}/parentChanges`, `.../parentRevisions`, `.../vcsRootInstance` — GET

## agents — 9 paths · build agents: authorize, enable/disable, pool assignment, build-configuration compatibility

- `/agents` — GET
- `/agents/{agentLocator}` — GET DELETE
- `/agents/{agentLocator}/{field}` — GET PUT
- `/agents/{agentLocator}/authorizedInfo`, `.../enabledInfo` — GET PUT
- `/agents/{agentLocator}/compatibilityPolicy`, `.../pool` — GET PUT
- `/agents/{agentLocator}/compatibleBuildTypes`, `.../incompatibleBuildTypes` — GET

## buildQueue — 9 paths · the build queue: trigger, reorder, pause, approve, remove queued builds

- `/buildQueue` — GET POST DELETE
- `/buildQueue/order` — PUT
- `/buildQueue/order/{queuePosition}` — GET PUT
- `/buildQueue/pausedState` — PUT
- `/buildQueue/{buildLocator}/approvalInfo` — GET
- `/buildQueue/{buildLocator}/approve` — POST
- `/buildQueue/{buildLocator}/tags` — GET POST
- `/buildQueue/{queuedBuildLocator}` — GET POST DELETE
- `/buildQueue/{queuedBuildLocator}/compatibleAgents` — GET

## cloud — 8 paths · cloud profiles, images, and running agent instances

- `/cloud/images`, `/cloud/images/{imageLocator}` — GET
- `/cloud/instances` — GET POST
- `/cloud/instances/{instanceLocator}` — GET DELETE
- `/cloud/instances/{instanceLocator}/actions/stop`, `.../forceStop` — POST
- `/cloud/profiles`, `/cloud/profiles/{profileLocator}` — GET

## agentPools — 7 paths · agent pools and their project/agent assignments

- `/agentPools` — GET POST
- `/agentPools/{agentPoolLocator}` — GET DELETE
- `/agentPools/{agentPoolLocator}/{field}` — GET PUT
- `/agentPools/{agentPoolLocator}/agents` — GET POST
- `/agentPools/{agentPoolLocator}/authorizationTokens` — POST
- `/agentPools/{agentPoolLocator}/projects` — GET POST PUT DELETE
- `/agentPools/{agentPoolLocator}/projects/{projectLocator}` — DELETE

## userGroups — 7 paths · user groups, parent groups, properties, role assignments

- `/userGroups` — GET POST
- `/userGroups/{groupLocator}` — GET DELETE
- `/userGroups/{groupLocator}/parent-groups` — GET PUT
- `/userGroups/{groupLocator}/properties` — GET
- `/userGroups/{groupLocator}/properties/{name}` — GET PUT DELETE
- `/userGroups/{groupLocator}/roles` — GET POST PUT
- `/userGroups/{groupLocator}/roles/{roleId}/{scope}` — GET POST DELETE

## vcs-roots — 7 paths · VCS root definitions and their properties

- `/vcs-roots` — GET POST
- `/vcs-roots/{vcsRootLocator}` — GET DELETE
- `/vcs-roots/{vcsRootLocator}/{field}` — GET PUT
- `/vcs-roots/{vcsRootLocator}/instances`, `.../settingsFile` — GET
- `/vcs-roots/{vcsRootLocator}/properties` — GET PUT DELETE
- `/vcs-roots/{vcsRootLocator}/properties/{name}` — GET PUT DELETE

## deploymentDashboards — 4 paths · deployment dashboards and the build instances shown on them

- `/deploymentDashboards` — GET POST
- `/deploymentDashboards/{deploymentDashboardLocator}` — GET DELETE
- `/deploymentDashboards/{deploymentDashboardLocator}/instances` — GET POST
- `/deploymentDashboards/{deploymentDashboardLocator}/instances/{deploymentInstanceLocator}` — GET POST DELETE

## health — 4 paths · server health reports, grouped by category — all read-only

- `/health`, `/health/{locator}`, `/health/category`, `/health/category/{locator}` — GET

## roles — 4 paths · roles and the permissions they grant

- `/roles` — GET POST
- `/roles/id:{id}` — GET DELETE
- `/roles/id:{roleId}/included/{includedId}` — PUT DELETE
- `/roles/id:{roleId}/permissions/{permissionId}` — PUT DELETE

## avatars — 3 paths · user avatar images

- `/avatars/{userLocator}` — PUT DELETE
- `/avatars/{userLocator}/{size}/avatar.png`, `/avatars/{userLocator}/{size}/avatar.{hash}.png` — GET

## investigations — 3 paths · investigation assignments for failed tests and build problems

- `/investigations` — GET POST
- `/investigations/multiple` — POST
- `/investigations/{investigationLocator}` — GET PUT DELETE

## mutes — 3 paths · muted tests

- `/mutes` — GET POST
- `/mutes/multiple` — POST DELETE
- `/mutes/{muteLocator}` — GET DELETE

## audit — 2 paths · server audit log events — read-only

- `/audit`, `/audit/{auditEventLocator}` — GET

## problemOccurrences — 2 paths · occurrences of build problems in individual builds — read-only

- `/problemOccurrences`, `/problemOccurrences/{problemLocator}` — GET

## problems — 2 paths · build problems known to the server — read-only

- `/problems`, `/problems/{problemLocator}` — GET

## testOccurrences — 2 paths · individual test results (occurrences) across builds — read-only

- `/testOccurrences`, `/testOccurrences/{testLocator}` — GET

## tests — 2 paths · tests known to the server — read-only

- `/tests`, `/tests/{testLocator}` — GET

## agentTypes — 1 path · agent types (environment signatures of connected agents)

- `/agentTypes/{agentTypeLocator}` — GET

## Server metadata — 4 paths · API index and version endpoints (/app/rest root, version, apiVersion, info)

- `/` — GET (the API index at the /app/rest root)
- `/version`, `/apiVersion`, `/info` — GET

## Common operations

- **Trigger a build:** `POST /app/rest/buildQueue`, body `{"buildType":{"id":"X"}}` — optional `branchName`, `properties:{"property":[{"name":"env.FOO","value":"bar"}]}`. Returns the queued build; poll `GET /app/rest/builds/id:<id>` until `state` is `finished`.
- **Cancel a running build:** `POST /app/rest/builds/id:<id>`, body `{"comment":"...","readdIntoQueue":false}`. Remove a queued build instead: `DELETE /app/rest/buildQueue/id:<id>`.
- **Pin:** `PUT /app/rest/builds/id:<id>/pinInfo`, body `{"status":true,"comment":"keep"}`.
- **Tag:** `POST /app/rest/builds/id:<id>/tags`, body `{"tag":[{"name":"release"}]}` (POST appends; PUT replaces).
- **Comment:** `PUT /app/rest/builds/id:<id>/comment` with a plain-text body; `DELETE` the same path removes it.
- **Build log (plain text, outside /app/rest):** `GET /downloadBuildLog.html?buildId=<id>` (server-root relative; same auth applies).
- **Artifacts:** list via `GET /app/rest/builds/id:<id>/artifacts` or `.../artifacts/{path}` (children) / `.../artifacts/metadata{path}`; download bytes via `GET /app/rest/builds/id:<id>/artifacts/files/<path>` (`archived<path>` returns the file zipped).
- **Mute a test:** `POST /app/rest/mutes`, body `{"scope":{"project":{"id":"X"}},"target":{"tests":{"test":[{"id":123}]}},"resolution":{"type":"whenFixed"}}` (resolution `type`: `manually`, `whenFixed`, `atTime`).
- **Assign an investigation:** `POST /app/rest/investigations`, body `{"state":"TAKEN","assignee":{"username":"bob"},"scope":{"buildTypes":{"buildType":[{"id":"X"}]}},"target":{"anyProblem":true}}`. States: `TAKEN`, `FIXED`, `GIVEN_UP`, `NONE`.
- **Authorize / enable an agent:** `PUT /app/rest/agents/id:<n>/authorizedInfo`, body `{"status":true}`; `PUT /app/rest/agents/id:<n>/enabledInfo`, body `{"status":true,"comment":"..."}`.
