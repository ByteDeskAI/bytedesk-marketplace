# Changelog

## Unreleased

### Added
- **remote-gateway plugin (BDM-76).** Operator skills copied from the gateway repo, plus `/remote-gateway-login`. Bare login reads `~/.bytedesk/remote-gateway/agent-login.yaml` (`url`, `method` `vault|local`, `user`, `pass`). The other path is `--url`, `--method`, `--username`, and `--password` together. The session cookie is stored for later gateway calls. Credentials stay in the home-directory file.
- **Codex install surface.** `.codex-plugin/plugin.json` and a `remote-gateway` entry in `.agents/plugins/marketplace.json`, so Codex can install the same login skill. The plugin stays unversioned.
