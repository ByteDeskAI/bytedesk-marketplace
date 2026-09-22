# Start installed ByteDesk gateway (Windows).
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/platform.ps1"
$HomeDir = Get-BdgwGatewayHome
if (-not (Test-Path $HomeDir)) { throw "gateway home not found: $HomeDir (run gateway-install first)" }

$RunPs1 = Join-Path $HomeDir 'run.ps1'
$RunSh = Join-Path $HomeDir 'run.sh'
$PidFile = Join-Path $HomeDir 'gateway.pid'
$Log = Join-Path $HomeDir 'gateway.log'
$ErrLog = Join-Path $HomeDir 'gateway.err.log'

# Prefer native run.ps1; fall back to bash run.sh
if (Test-Path $RunPs1) {
  $shell = $null
  foreach ($c in @('pwsh', 'powershell', 'powershell.exe')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $shell = $cmd.Source; break }
  }
  if (-not $shell) {
    # Start binary directly via run.ps1 content path
    $bin = Get-BdgwGatewayBin -HomeDir $HomeDir
    if (-not (Test-Path $bin)) { throw "missing binary under $HomeDir" }
    $cfg = Get-BdgwControlEnv -HomeDir $HomeDir
    foreach ($k in $cfg.Keys) { Set-Item -Path ("env:" + $k) -Value $cfg[$k] }
    $env:GATEWAY_HOME = $HomeDir
    $p = Start-Process -FilePath $bin -WorkingDirectory $HomeDir -WindowStyle Hidden `
      -RedirectStandardOutput $Log -RedirectStandardError $ErrLog -PassThru
  } else {
    $p = Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-File', $RunPs1) -WindowStyle Hidden `
      -RedirectStandardOutput $Log -RedirectStandardError $ErrLog -PassThru
  }
} elseif (Test-Path $RunSh) {
  $bash = Find-BdgwBash
  if (-not $bash) { throw "missing $RunPs1 and bash for $RunSh" }
  $p = Start-Process -FilePath $bash -ArgumentList @($RunSh) -WindowStyle Hidden `
    -RedirectStandardOutput $Log -RedirectStandardError $ErrLog -PassThru
} else {
  throw "missing $RunPs1 / $RunSh — run gateway-install first"
}

$p.Id | Set-Content $PidFile
Write-Host "started home=$HomeDir pid=$($p.Id)"
Write-Host "health: $(Get-BdgwListenUrl -HomeDir $HomeDir)/healthz"
