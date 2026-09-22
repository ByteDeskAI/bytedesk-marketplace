# PAM is not available on Windows.
Write-Host 'PAM is not available on Windows. Use AUTH_MODE=local with TOTP after /setup (or Vault).'
exit 0
