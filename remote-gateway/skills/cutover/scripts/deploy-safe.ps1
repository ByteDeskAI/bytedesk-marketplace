# Windows entrypoint for deploy-safe.sh (requires Git Bash + go toolchain).
# Full cutover with monorepo build; service restart uses pid/run.ps1 on Windows.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/platform.ps1"
$Sh = Join-Path $PSScriptRoot 'deploy-safe.sh'
if (-not (Test-Path $Sh)) { throw "missing $Sh" }
Write-Host 'Note: cutover is Linux-primary for systemd; Windows uses pid/run.ps1 restart path inside deploy-safe.sh'
Invoke-BdgwBashScript -ScriptPath $Sh -Arguments $args
