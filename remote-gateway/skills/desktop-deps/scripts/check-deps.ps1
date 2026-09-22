# Desktop/agents profile dependency check (Windows).
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/lib/platform.ps1"
Write-Host 'os=windows profile check: desktop'
foreach ($c in @('ttyd','tmux')) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { Write-Host "ok $c" } else { Write-Host "MISSING $c" }
}
Write-Host 'hint: scoop/choco or WSL for ttyd/tmux; use RDP instead of VNC stack'
Write-Host 'desktop profile on Windows is best-effort; prefer core profile for gateway API'
