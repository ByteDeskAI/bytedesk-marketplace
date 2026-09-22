# Stop gateway started via pid file (Windows).
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/lib/platform.ps1"
$HomeDir = Get-BdgwGatewayHome
$PidFile = Join-Path $HomeDir 'gateway.pid'
if (Test-Path $PidFile) {
  $procId = (Get-Content $PidFile | Select-Object -First 1).Trim()
  if ($procId -match '^\d+$') {
    try {
      Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
      Write-Host "stopped pid=$procId"
    } catch {
      Write-Host "stop: process $procId not running"
    }
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
} else {
  # Best-effort by name
  Get-Process -Name 'bytedesk-gateway','bytedesk-emote-gateway' -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; Write-Host "stopped $($_.ProcessName) pid=$($_.Id)" }
}
Write-Host "stop requested for $HomeDir"
