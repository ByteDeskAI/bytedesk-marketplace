# Windows entrypoint: prefer Git Bash / WSL for portable install.sh
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/platform.ps1"
$Sh = Join-Path $PSScriptRoot 'install.sh'
if (-not (Test-Path $Sh)) { throw "missing $Sh" }
Invoke-BdgwBashScript -ScriptPath $Sh -Arguments $args
