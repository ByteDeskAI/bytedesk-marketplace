# Host inventory (Windows) — read-only.
param([string]$Mode = 'inventory')
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/lib/platform.ps1"
Write-Host "=== host-diagnostics mode=$Mode os=windows ==="
Write-Host "date=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"
Write-Host "user=$env:USERNAME home=$(Get-BdgwHome)"
Write-Host "arch=$env:PROCESSOR_ARCHITECTURE"

switch ($Mode) {
  { $_ -in @('inventory','audit') } {
    foreach ($rel in @('.bytedesk-gateway','.bytedesk-emote-gateway','.bytedesk-vault')) {
      $p = Join-Path (Get-BdgwHome) $rel
      if (Test-Path $p) { Write-Host "dir present: $p" }
    }
    if ($env:BYTEDESK_GATEWAY_HOME -and (Test-Path $env:BYTEDESK_GATEWAY_HOME)) {
      Write-Host "dir present: $env:BYTEDESK_GATEWAY_HOME"
    }
    try {
      Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 40 LocalAddress,LocalPort,OwningProcess |
        Format-Table -AutoSize | Out-String | Write-Host
    } catch {
      netstat -an 2>$null | Select-Object -First 40
    }
    Get-Process -Name 'bytedesk*' -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host "process=$($_.ProcessName) pid=$($_.Id)" }
  }
  'eagain' {
    Write-Host 'EAGAIN / task exhaustion is Linux cgroup-focused'
    Write-Host "handle count (current process tools): use Process Explorer or Get-Process | Select Handles"
    Get-Process | Sort-Object Handles -Descending | Select-Object -First 10 Name,Id,Handles |
      Format-Table -AutoSize | Out-String | Write-Host
  }
  default {
    Write-Host 'usage: host-diagnostics.ps1 [inventory|eagain]'
    exit 2
  }
}
Write-Host '=== end host-diagnostics ==='
