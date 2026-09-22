# Gateway status (Windows).
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/lib/platform.ps1"
$HomeDir = Get-BdgwGatewayHome
Write-Host "os=windows home=$HomeDir"
Write-Host "bin=$(Get-BdgwGatewayBin -HomeDir $HomeDir)"
Write-Host "bind=$(Get-BdgwListenUrl -HomeDir $HomeDir)"
$PidFile = Join-Path $HomeDir 'gateway.pid'
if (Test-Path $PidFile) {
  $procId = (Get-Content $PidFile | Select-Object -First 1).Trim()
  $proc = Get-Process -Id ([int]$procId) -ErrorAction SilentlyContinue
  if ($proc) { Write-Host "pid=$procId running" } else { Write-Host "pid=stale-or-dead ($procId)" }
} else {
  $procs = Get-Process -Name 'bytedesk-gateway','bytedesk-emote-gateway' -ErrorAction SilentlyContinue
  if ($procs) { $procs | ForEach-Object { Write-Host "process=$($_.ProcessName) pid=$($_.Id)" } }
  else { Write-Host "pid=none" }
}
