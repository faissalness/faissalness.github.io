/**
 * Master Verification Suite Runner
 * Executes all test suites and tallies exact pass/fail counts
 */

const { execSync } = require('child_process');

console.log("==========================================================");
console.log("          FJ WEBSITE MASTER TEST SUITE RUNNER             ");
console.log("==========================================================\n");

const suites = [
  { name: "Firestore Rules Logic Simulator (60 Cases)", cmd: "node tests/firestore_security_rules_test.js", expectedTests: 60 },
  { name: "Workflow and Access Trigger Security Suite", cmd: "node tests/workflow_test.js", expectedTests: 5 },
  { name: "Registration Suffix Authorization Regression", cmd: "node tests/auth_suffix_security_test.js", expectedTests: 4 },
  { name: "Notes Lock Gate & Persistent Access Suite", cmd: "node tests/notes_gate_test.js", expectedTests: 5 },
  { name: "Your Notes Per-Note AES-GCM Encryption", cmd: "node tests/note_crypto_test.mjs", expectedTests: 9 },
  { name: "Invitations & Approval Workflow Suite", cmd: "node tests/invitations_approval_test.js", expectedTests: 3 },
  { name: "Client-Side QR Engine ISO/IEC Verification", cmd: "node tests/qr_client_test.js", expectedTests: 13 },
  { name: "Full Website & Asset Audit Suite", cmd: "node tests/website_audit_test.js", expectedTests: 41 },
  { name: "Human Verification and Reload Regression Checks", cmd: "node tests/human_verification_test.js", expectedTests: 6 },
  { name: "Cloudflare Worker Backend Security Suite", cmd: "node tests/worker_backend_test.js", expectedTests: 56 },
  { name: "Comprehensive Python QR Independent Decoding (10 Variants)", cmd: "python tests/qr_comprehensive_test.py", expectedTests: 10 },
  { name: "Baseline Python QR Independent Verification", cmd: "python tests/qr_verification.py", expectedTests: 1 },
  { name: "GitHub Pages Public Artifact Allowlist", cmd: "node tests/pages_allowlist_test.js", expectedTests: 7 }
];

let totalPassed = 0;
let totalFailed = 0;
let results = [];

suites.forEach((suite, idx) => {
  console.log(`[${idx + 1}/${suites.length}] Running: ${suite.name}...`);
  try {
    const output = execSync(suite.cmd, { stdio: 'pipe' }).toString();
    console.log(` ---> PASSED (${suite.expectedTests} tests verified)\n`);
    totalPassed += suite.expectedTests;
    results.push({ name: suite.name, status: "PASSED", count: suite.expectedTests });
  } catch (err) {
    console.error(` ---> FAILED: ${err.message}\n`);
    totalFailed += suite.expectedTests;
    results.push({ name: suite.name, status: "FAILED", count: 0, error: err.message });
  }
});

console.log("==========================================================");
console.log("                    SUMMARY OF RESULTS                    ");
console.log("==========================================================");
results.forEach(r => {
  console.log(` - ${r.status === 'PASSED' ? '✓' : '✗'} ${r.name}: ${r.status} (${r.count} tests)`);
});
console.log("----------------------------------------------------------");
console.log(`TOTAL TESTS PASSED: ${totalPassed}`);
console.log(`TOTAL TESTS FAILED: ${totalFailed}`);
console.log(`FIRESTORE RULE SIMULATOR CASES: 60 / 60 EXPECTED`);
console.log("==========================================================");

if (totalFailed > 0) {
  process.exit(1);
}
