$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..")
$exportDir = Join-Path $env:TEMP "fj-emulator-test"
if (Test-Path $exportDir) { Remove-Item $exportDir -Recurse -Force }
$env:FJ_TEST_DEPS=(Resolve-Path "$PSScriptRoot\..").Path
npx --yes firebase-tools@15.37.0 emulators:exec --only auth,firestore "node tests/auth_emulator_test.mjs && node tests/firestore_emulator_test.mjs && npx --yes playwright@1.65.1 test tests/browser_emulator.spec.js --reporter=line" --project demo-fj-website-384fd --export-on-exit "$exportDir"
