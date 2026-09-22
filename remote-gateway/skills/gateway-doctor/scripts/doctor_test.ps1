# No service or network operations: the health transport is mocked.
$ErrorActionPreference = 'Stop'
$fixtureHome = Join-Path ([IO.Path]::GetTempPath()) ('doctor-secret-' + [Guid]::NewGuid())
$previousHome = $env:BYTEDESK_GATEWAY_HOME
try {
  $null = New-Item -ItemType Directory -Path $fixtureHome
  $env:BYTEDESK_GATEWAY_HOME = $fixtureHome
  Set-Content -Path (Join-Path $fixtureHome 'control.env') -Value @(
    'LISTEN_HOST=127.0.0.1', 'LISTEN_PORT=18443', 'SESSION_SECRET=config-secret-fixture'
  )
  $fixtureState = @{ Fail = $false }
  $mockRequest = {
    param($Uri, [switch]$UseBasicParsing, $TimeoutSec, $ErrorAction)
    if ($fixtureState.Fail) { throw 'error-body-secret-fixture' }
    [pscustomobject]@{ Content = 'arbitrary-response-secret-fixture'; StatusCode = 200 }
  }.GetNewClosure()
  Set-Item -Path Function:Invoke-WebRequest -Value $mockRequest
  foreach ($fail in @($false, $true)) {
    $fixtureState.Fail = $fail
    $captured = (& "$PSScriptRoot/doctor.ps1" *>&1 | Out-String)
    if ($captured -match 'secret-fixture') { throw 'doctor disclosed response/config/error content' }
    $expected = if ($fail) { 'healthz=UNREACHABLE' } else { 'healthz=REACHABLE' }
    if (-not $captured.Contains($expected)) { throw "missing fixed status: $expected" }
  }
  $tokens = $null
  $parseErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile(
    "$PSScriptRoot/doctor.ps1", [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count -ne 0) { throw 'doctor.ps1 syntax failure' }
  Write-Output 'PASS PowerShell doctor secret-safe success/error diagnostics and syntax'
} finally {
  $env:BYTEDESK_GATEWAY_HOME = $previousHome
  Remove-Item -Recurse -Force $fixtureHome
}
