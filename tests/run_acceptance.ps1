param(
  [switch]$SkipEmulators,
  [switch]$SkipProduction
)

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

function Invoke-Check {
  param([string]$Name, [scriptblock]$Command)
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  & $Command
  $exitCode = $LASTEXITCODE
  if ($null -ne $exitCode -and $exitCode -ne 0) {
    throw "$Name failed with exit code $exitCode"
  }
}

foreach ($tool in @("node", "npx", "python")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool is missing: $tool"
  }
}

Invoke-Check "Source syntax" {
  node --check app.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node --check notes.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node --check pip.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node --check backend/worker.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node --check functions/access-approval-trigger.js
}

Invoke-Check "Local regression suites" { node tests/run_all_tests.js }

if (-not $SkipEmulators) {
  Invoke-Check "Auth, Firestore, and multi-account browser emulators" {
    & (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File tests/run_emulator_tests.ps1
  }
}

if (-not $SkipProduction) {
  Invoke-Check "Read-only production Firebase Auth audit" { node tests/production_auth_config_test.mjs }
  Invoke-Check "Cloudflare Worker dry run" { npx wrangler deploy --dry-run --config backend/wrangler.toml }
  Invoke-Check "Remote D1 migration inventory" { npx wrangler d1 migrations list fj-api-state --remote --config backend/wrangler.toml }

  Write-Host "`n=== Read-only production smoke checks ===" -ForegroundColor Cyan
  $urls = @(
    "https://faissalness.github.io/",
    "https://faissalness.github.io/pip/",
    "https://faissalness.github.io/qr/",
    "https://fj-api.jimyass.workers.dev/",
    "https://fj-api.jimyass.workers.dev/api/users/count"
  )
  foreach ($url in $urls) {
    $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 25 -UseBasicParsing
    if ($response.StatusCode -ne 200) { throw "Production smoke check failed: $url returned $($response.StatusCode)" }
    Write-Host "HTTP 200 $url"
  }
}

Write-Host "`nFJ acceptance checks completed." -ForegroundColor Green
