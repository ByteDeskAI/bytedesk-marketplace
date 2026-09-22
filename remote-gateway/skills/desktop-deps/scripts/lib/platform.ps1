# Shared PowerShell helpers for setup plugin skills (Windows).
# Dot-source: . "$PSScriptRoot/lib/platform.ps1"

function Get-BdgwHome {
  if ($env:HOME) { return $env:HOME }
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  return [Environment]::GetFolderPath('UserProfile')
}

function Get-BdgwGatewayHome {
  if ($env:BYTEDESK_GATEWAY_HOME) { return $env:BYTEDESK_GATEWAY_HOME }
  if ($env:GATEWAY_HOME) { return $env:GATEWAY_HOME }
  $h = Join-Path (Get-BdgwHome) '.bytedesk-gateway'
  if (Test-Path $h) { return $h }
  $legacy = Join-Path (Get-BdgwHome) '.bytedesk-emote-gateway'
  if (Test-Path $legacy) { return $legacy }
  return $h
}

function Get-BdgwControlEnv {
  param([string]$HomeDir)
  $map = @{}
  $envFile = Join-Path $HomeDir 'control.env'
  if (-not (Test-Path $envFile)) { return $map }
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $map[$matches[1]] = $matches[2]
    }
  }
  return $map
}

function Get-BdgwListenUrl {
  param([string]$HomeDir)
  $cfg = Get-BdgwControlEnv -HomeDir $HomeDir
  $h = if ($cfg['LISTEN_HOST']) { ($cfg['LISTEN_HOST'] -split ',')[0].Trim() } else { '127.0.0.1' }
  $p = if ($cfg['LISTEN_PORT']) { $cfg['LISTEN_PORT'] } else { '18443' }
  return "http://${h}:${p}"
}

function Find-BdgwBash {
  foreach ($c in @(
      'bash',
      'C:\Program Files\Git\bin\bash.exe',
      'C:\Program Files\Git\usr\bin\bash.exe',
      'C:\Windows\System32\bash.exe'
    )) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Invoke-BdgwBashScript {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [string[]]$Arguments = @()
  )
  $bash = Find-BdgwBash
  if (-not $bash) {
    throw 'bash not found. Install Git for Windows or WSL, then re-run.'
  }
  & $bash $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Get-BdgwGatewayBin {
  param([string]$HomeDir)
  foreach ($rel in @(
      'bin/bytedesk-gateway.exe',
      'bin/bytedesk-gateway',
      'bytedesk-gateway.exe',
      'bytedesk-gateway',
      'bytedesk-emote-gateway.exe',
      'bytedesk-emote-gateway'
    )) {
    $p = Join-Path $HomeDir $rel
    if (Test-Path $p) { return $p }
  }
  return (Join-Path $HomeDir 'bin/bytedesk-gateway.exe')
}
