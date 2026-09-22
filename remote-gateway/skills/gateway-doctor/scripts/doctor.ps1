# Gateway doctor (Windows) — no secrets printed.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/lib/platform.ps1"
$HomeDir = Get-BdgwGatewayHome
Write-Host '=== ByteDesk gateway doctor (Windows) ==='
Write-Host "home=$HomeDir exists=$((Test-Path $HomeDir))"
@('control.env','bin/bytedesk-gateway.exe','bin/bytedesk-gateway','run.ps1','run.sh','config.json') | ForEach-Object {
  if (Test-Path (Join-Path $HomeDir $_)) { Write-Host "present: $_" }
}
$cfg = Get-BdgwControlEnv -HomeDir $HomeDir
foreach ($k in @('SESSION_SECRET','SETUP_TOKEN','ADMIN_TOKEN','LISTEN_HOST','LISTEN_PORT')) {
  if ($cfg.ContainsKey($k)) { Write-Host "control.env has $k" } else { Write-Host "control.env missing $k" }
}
if ($cfg.ContainsKey('LISTEN_HOST') -or (Test-Path (Join-Path $HomeDir 'control.env'))) {
  $url = "$(Get-BdgwListenUrl -HomeDir $HomeDir)/healthz"
  Write-Host "health_url=$url"
  try {
    $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    Write-Host 'healthz=REACHABLE'
  } catch {
    Write-Host 'healthz=UNREACHABLE'
  }
}
foreach ($c in @('curl','openssl','ttyd','tmux','rclone')) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { Write-Host "dep ok: $c" } else { Write-Host "dep missing: $c" }
}
Write-Host 'containment_prerequisite=unsupported-platform'
Write-Host 'containment_activation=unverified'
Write-Host '=== end doctor (no secrets printed) ==='
