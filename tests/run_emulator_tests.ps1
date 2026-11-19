$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..")
$exportDir = Join-Path $env:TEMP ("fj-emulator-test-" + [guid]::NewGuid().ToString("N"))
$env:FJ_TEST_DEPS=(Resolve-Path "$PSScriptRoot\..").Path
$exitCode = 0
try {
  npx --yes firebase-tools@15.37.0 emulators:exec --only auth,firestore "node tests/auth_emulator_test.mjs && node tests/firestore_emulator_test.mjs && npx playwright test tests/browser_emulator.spec.js --reporter=line" --project demo-fj-website-384fd --export-on-exit "$exportDir"
  $exitCode = $LASTEXITCODE
}
finally {
  if (Test-Path -LiteralPath $exportDir) { Remove-Item -LiteralPath $exportDir -Recurse -Force }
}
exit $exitCode
