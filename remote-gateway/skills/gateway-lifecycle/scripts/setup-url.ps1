# Print first-run /setup URL (Windows). Never print other secrets.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/platform.ps1"
$HomeDir = Get-BdgwGatewayHome
$cfg = Get-BdgwControlEnv -HomeDir $HomeDir
if (-not $cfg['SETUP_TOKEN']) { throw "SETUP_TOKEN missing from $HomeDir/control.env" }
Write-Host "$(Get-BdgwListenUrl -HomeDir $HomeDir)/setup?token=$($cfg['SETUP_TOKEN'])"
