---
name: bytedesk-devproject-domain-operator
description: >-
  ByteDesk DevProject custom-domain operator. Use for DevProject domain/DNS
  work involving PowerDNS, Railway custom domains, CNAME/TXT verification,
  Cloudflare or provider adapters, stale local DNS interception, DoH validation,
  and "is this domain live?" questions. Separates global DNS truth from local
  resolver cache and proves Railway plus DNS state before debugging app code.
user-invokable: true
argument-hint: "status <domain> | railway <domain> | dns <domain>"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Make DevProject custom-domain work deterministic. Verify provider state,
Railway state, and public DNS through DNS-over-HTTPS before treating a domain as
broken. Ryan's workstation can return stale answers through a local/VPN DNS
interceptor, so `dig @8.8.8.8` from the laptop is not enough.

## First Checks

```bash
devproject-domain-proof --domain <domain>
```

Collect:

- DevProject id/name and environment
- Railway service/resource id and custom-domain state
- expected CNAME/TXT records
- PowerDNS/provider zone record state
- DoH answers from Google and Cloudflare
- app HTTPS status, optionally with `curl --resolve`

## DNS Truth Rules

- Prefer DoH:
  ```bash
  curl -fsS 'https://dns.google/resolve?name=<domain>&type=A'
  curl -fsS -H 'accept: application/dns-json' \
    'https://cloudflare-dns.com/dns-query?name=<domain>&type=A'
  ```
- Use `curl --resolve <host>:443:<ip>` to prove app routing when DNS is stale.
- Treat local `dig` disagreement as resolver-cache evidence, not provider
  failure, unless DoH also disagrees.
- Never print Railway or DNS API tokens.

## Report Format

```markdown
DevProject domain status: PASS/FAIL
Domain: <host>
Railway: <domain id/state/target>
DNS provider: <records>
Public DNS: <Google DoH + Cloudflare DoH>
HTTPS/app: <status and route>
Local resolver caveat: <present/absent>
```
