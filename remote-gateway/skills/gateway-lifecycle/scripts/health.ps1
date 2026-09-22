# healthz probe (Windows).
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/platform.ps1"
$HomeDir = Get-BdgwGatewayHome
$url = "$(Get-BdgwListenUrl -HomeDir $HomeDir)/healthz"
(Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5).Content
