# Dependency profiles

| Profile | Linux | macOS | Windows |
|---------|-------|-------|---------|
| core | gateway binary | gateway binary | gateway binary (+ `.exe` when published) |
| agents | + agent CLIs | + agent CLIs | + agent CLIs (PATH / WSL) |
| desktop | Xvfb, x11vnc, firefox, websockify | best-effort | best-effort (use RDP) |

Public artifacts today are primarily `linux-amd64` / `linux-arm64`. For darwin/windows, set `BYTEDESK_GATEWAY_ARTIFACT` to a local build until multi-OS triples are published.
