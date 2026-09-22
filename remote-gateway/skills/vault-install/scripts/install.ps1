# Windows entrypoint for vault install (delegates to install-vault.sh).
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/platform.ps1"
$Sh = Join-Path $PSScriptRoot 'install-vault.sh'
if (-not (Test-Path $Sh)) { throw "missing $Sh" }
Invoke-BdgwBashScript -ScriptPath $Sh -Arguments $args
