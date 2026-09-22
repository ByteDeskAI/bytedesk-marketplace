# Public URL probe (Windows).
param([string]$Url = $env:PUBLIC_PROBE_URL)
$ErrorActionPreference = 'Stop'
if (-not $Url) {
  Write-Host 'usage: probe-public.ps1 <https://host/healthz>'
  Write-Host 'or set PUBLIC_PROBE_URL'
  Write-Host 'Private-first installs have no public URL until Funnel/tunnel is configured.'
  exit 2
}
(Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10).Content
