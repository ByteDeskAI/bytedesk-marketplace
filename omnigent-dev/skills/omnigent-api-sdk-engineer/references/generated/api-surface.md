# Omnigent API Surface

Generated from `openapi.json` plus FastAPI websocket decorators.

## REST Routes
| Method | Path | Summary |
|---|---|---|
| GET | `/api/version` | Version |
| GET | `/health` | Health |
| GET | `/v1/agents` | List Builtin Agents |
| GET | `/v1/hosts` | List Hosts |
| GET | `/v1/hosts/{host_id}` | Get Host |
| GET | `/v1/hosts/{host_id}/filesystem` | List Host Filesystem Root |
| GET | `/v1/hosts/{host_id}/filesystem/{path}` | List Host Filesystem |
| POST | `/v1/hosts/{host_id}/runners` | Launch Runner |
| GET | `/v1/info` | Info |
| GET | `/v1/me` | Me |
| GET | `/v1/policies` | List Policies |
| POST | `/v1/policies` | Create Policy |
| DELETE | `/v1/policies/{policy_id}` | Delete Policy |
| GET | `/v1/policies/{policy_id}` | Get Policy |
| PATCH | `/v1/policies/{policy_id}` | Update Policy |
| GET | `/v1/policy-registry` | List Registry |
| GET | `/v1/runners` | List Runners |
| GET | `/v1/runners/{runner_id}/status` | Runner Status |
| GET | `/v1/sessions` | List Sessions |
| POST | `/v1/sessions` | Create Session |
| DELETE | `/v1/sessions/{session_id}` | Delete Session |
| GET | `/v1/sessions/{session_id}` | Get Session |
| PATCH | `/v1/sessions/{session_id}` | Update Session |
| GET | `/v1/sessions/{session_id}/agent` | Get Session Agent |
| PUT | `/v1/sessions/{session_id}/agent` | Update Session Agent |
| GET | `/v1/sessions/{session_id}/agent/contents` | Get Session Agent Contents |
| GET | `/v1/sessions/{session_id}/child_sessions` | List Child Sessions |
| GET | `/v1/sessions/{session_id}/comments` | List Comments |
| POST | `/v1/sessions/{session_id}/comments` | Add Comment |
| POST | `/v1/sessions/{session_id}/comments/send` | Send To Agent |
| DELETE | `/v1/sessions/{session_id}/comments/{comment_id}` | Delete Comment |
| PATCH | `/v1/sessions/{session_id}/comments/{comment_id}` | Update Comment |
| GET | `/v1/sessions/{session_id}/elicitations/{elicitation_id}` | Get Elicitation |
| POST | `/v1/sessions/{session_id}/elicitations/{elicitation_id}/resolve` | Resolve Elicitation |
| POST | `/v1/sessions/{session_id}/events` | Post Event |
| POST | `/v1/sessions/{session_id}/hooks/codex-elicitation-request` | Codex Elicitation Request Hook |
| POST | `/v1/sessions/{session_id}/hooks/permission-request` | Claude Permission Request Hook |
| GET | `/v1/sessions/{session_id}/items` | List Session Items |
| GET | `/v1/sessions/{session_id}/labels` | Get Session Labels |
| POST | `/v1/sessions/{session_id}/mcp` | Mcp Proxy |
| GET | `/v1/sessions/{session_id}/owner` | Get Session Owner |
| GET | `/v1/sessions/{session_id}/permissions` | List Permissions |
| PUT | `/v1/sessions/{session_id}/permissions` | Grant Permission |
| DELETE | `/v1/sessions/{session_id}/permissions/{target_user_id}` | Revoke Permission |
| GET | `/v1/sessions/{session_id}/policies` | List Policies |
| POST | `/v1/sessions/{session_id}/policies` | Create Policy |
| POST | `/v1/sessions/{session_id}/policies/evaluate` | Evaluate Policy |
| DELETE | `/v1/sessions/{session_id}/policies/{policy_id}` | Delete Policy |
| GET | `/v1/sessions/{session_id}/policies/{policy_id}` | Get Policy |
| PATCH | `/v1/sessions/{session_id}/policies/{policy_id}` | Update Policy |
| GET | `/v1/sessions/{session_id}/resources` | List Session Resources |
| GET | `/v1/sessions/{session_id}/resources/environments` | List Session Environments |
| GET | `/v1/sessions/{session_id}/resources/environments/{environment_id}` | Get Session Environment |
| GET | `/v1/sessions/{session_id}/resources/environments/{environment_id}/changes` | List Environment Filesystem Changes |
| GET | `/v1/sessions/{session_id}/resources/environments/{environment_id}/diff/{relative_path}` | Read Environment File Diff |
| GET | `/v1/sessions/{session_id}/resources/environments/{environment_id}/filesystem` | List Environment Root |
| DELETE | `/v1/sessions/{session_id}/resources/environments/{environment_id}/filesystem/{relative_path}` | Delete Environment Path |
| GET | `/v1/sessions/{session_id}/resources/environments/{environment_id}/filesystem/{relative_path}` | Read Or List Environment Path |
| PATCH | `/v1/sessions/{session_id}/resources/environments/{environment_id}/filesystem/{relative_path}` | Edit Environment File |
| PUT | `/v1/sessions/{session_id}/resources/environments/{environment_id}/filesystem/{relative_path}` | Write Environment File |
| GET | `/v1/sessions/{session_id}/resources/environments/{environment_id}/search` | Search Environment Files |
| POST | `/v1/sessions/{session_id}/resources/environments/{environment_id}/shell` | Run Environment Shell |
| GET | `/v1/sessions/{session_id}/resources/files` | List Session Files |
| POST | `/v1/sessions/{session_id}/resources/files` | Upload Session File |
| DELETE | `/v1/sessions/{session_id}/resources/files/{file_id}` | Delete Session File |
| GET | `/v1/sessions/{session_id}/resources/files/{file_id}` | Get Session File |
| GET | `/v1/sessions/{session_id}/resources/files/{file_id}/content` | Get Session File Content |
| GET | `/v1/sessions/{session_id}/resources/terminals` | List Session Terminals |
| POST | `/v1/sessions/{session_id}/resources/terminals` | Create Session Terminal |
| DELETE | `/v1/sessions/{session_id}/resources/terminals/{terminal_id}` | Delete Session Terminal |
| GET | `/v1/sessions/{session_id}/resources/terminals/{terminal_id}` | Get Session Terminal |
| POST | `/v1/sessions/{session_id}/resources/terminals/{terminal_id}/transfer` | Transfer Session Terminal |
| GET | `/v1/sessions/{session_id}/resources/{resource_id}` | Get Session Resource |
| GET | `/v1/sessions/{session_id}/stream` | Stream Session |
| POST | `/v1/sessions/{session_id}/switch-agent` | Switch Session Agent |
| POST | `/v1/sessions/{source_id}/fork` | Fork Session |

## WebSocket Routes
- `/hosts/{host_id}/tunnel (omnigent/server/routes/host_tunnel.py)`
- `/runners/{runner_id}/tunnel (omnigent/server/routes/runner_tunnel.py)`
- `/sessions/updates (omnigent/server/routes/sessions.py)`
- `/sessions/{session_id}/resources/terminals/{terminal_id}/attach (omnigent/server/routes/terminal_attach.py)`

## Contract Rule
- Route, schema, event, or SDK changes must preserve existing clients unless the change explicitly includes a migration path.
- Regenerate `openapi.json` with `scripts/dump_openapi.py` when the served contract changes.