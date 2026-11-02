# TM-522 evidence — commit 396676b3

## Unit tests (teamcity-mcp, vitest): 89 passed

Mutation checks: disabling the lead guard call -> 6 refusal tests fail; disabling the per-repo profile lookup -> launcher profile test fails. Both restored, 89/89 green.

## Live, against deploy.prod.bytedesk.ai, bundle in lead mode, TEAMCITY_MCP_PROJECT=ByteDesk_Marketplace

```
[stderr] teamcity-mcp stdio ready (mode=lead, project=ByteDesk_Marketplace, teamcity=https://deploy.prod.bytedesk.ai, auth=basic)
tools: 38 trigger_build: true cancel_build: false teamcity_rest_post: false

trigger_build {"buildTypeId":"RemoteGateway_CiValidate"}
  isError=true
  Refused: RemoteGateway_CiValidate is not a build configuration of project ByteDesk_Marketplace

trigger_build {"buildTypeId":"ByteDesk_DesignSystem_ReleasePublish"}
  isError=true
  Refused: ByteDesk_DesignSystem_ReleasePublish is not a build configuration of project ByteDesk_Marketplace

trigger_build {"buildTypeId":"ByteDesk_Marketplace_Marketplace_DeployProduction"}
  isError=true
  Refused: ByteDesk_Marketplace_Marketplace_DeployProduction is a deploy configuration; deploys stay operator-gated

trigger_build {"buildTypeId":"ByteDesk_Marketplace_Marketplace_DeployDevelopment"}
  isError=true
  Refused: ByteDesk_Marketplace_Marketplace_DeployDevelopment is a deploy configuration; deploys stay operator-gated

trigger_build {"buildTypeId":"ByteDesk_Marketplace_Marketplace_Validate","branch":"tm/TM-522-teamcity-mcp-repository-leads-have-no-supported-","comment":"TM-522 live lead-mode check"}
  isError=false
  {
    "id": 7565,
    "buildTypeId": "ByteDesk_Marketplace_Marketplace_Validate",
    "state": "queued",
    "branchName": "tm/TM-522-teamcity-mcp-repository-leads-have-no-supported-",
    "href": "/httpAuth/app/rest/buildQueue/id:7565",
    "webUrl": "https://deploy.prod.bytedesk.ai/build/7565",
    "buildType": {
      "id": "ByteDesk_Marketplace_Marketplace_Validate",
      "name": "01 - Validate PR, develop, ma

[stderr] teamcity-mcp stdio ready (mode=lead, project=ByteDesk_Marketplace, teamcity=https://deploy.prod.bytedesk.ai, auth=basic)
tools: 38 trigger_build: true cancel_build: false teamcity_rest_post: false

get_build {"build":"id:7565","fields":"id,number,state,status,buildTypeId,branchName,statusText"}
  isError=false
  {
    "id": 7565,
    "buildTypeId": "ByteDesk_Marketplace_Marketplace_Validate",
    "state": "queued",
    "branchName": "tm/TM-522-teamcity-mcp-repository-leads-have-no-supported-"
  }

list_builds {"locator":"buildType:(id:ByteDesk_Marketplace_Marketplace_Validate),branch:default:any,count:2","fields":"count,build(id,state,status,branchName)"}
  isError=false
  {
    "items": [],
    "count": 0,
    "truncated": false
  }
```

## What this does not prove

This machine's credential is operator basic auth (auth=basic), so the live refusals above are the MCP guard, not TeamCity permissions. Token-level scoping needs a TeamCity user whose only role is Project developer on the repo's project; minting that token is an operator credential action (still-ask class) and is filed as a follow-up.
