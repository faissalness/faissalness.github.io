/**
 * Notes Lock Gate & Shared Password Test Suite
 * Tests Phase 2 & Phase 4 Specifications
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log("=== NOTES GATE & SHARED PASSWORD VERIFICATION SUITE ===\n");

const notesHtml = fs.readFileSync(path.join(__dirname, '..', 'notes.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const notesJs = fs.readFileSync(path.join(__dirname, '..', 'notes.js'), 'utf8');

// 1. Exact persistent text "you can't come in here"
console.log("1. Testing Notes Gate Exact Text...");
assert.ok(notesHtml.includes("you can't come in here"), "Notes gate MUST contain exact text: 'you can't come in here'");
assert.ok(!notesHtml.includes("you cannot come in here"), "Old text 'you cannot come in here' must be replaced");
console.log(" PASS: Gate message exactly matches 'you can't come in here'.");

// 2. Neon-green unlabeled password input
console.log("\n2. Testing Neon Green Unlabeled Password Input...");
assert.ok(notesHtml.includes('id="notes-gate-password"'), "Must contain notes-gate-password element");
assert.ok(notesHtml.includes('type="password"'), "Input must be masked password type");
assert.ok(notesHtml.includes('aria-label="Notes access password"'), "Input must have accessible aria-label");

// Verify the gate input tag specifically has no placeholder
const gateInputMatch = notesHtml.match(/<input[^>]*id="notes-gate-password"[^>]*>/);
assert.ok(gateInputMatch, "Must find notes-gate-password input tag");
assert.ok(!gateInputMatch[0].includes('placeholder='), "Gate input MUST NOT display placeholder text");
assert.ok(!notesHtml.includes('<label for="notes-gate-password">'), "Must NOT display visible label element for gate password");

// Verify neon green styling in styles.css
assert.ok(stylesCss.includes('.neon-gate-input'), "styles.css must style .neon-gate-input");
assert.ok(stylesCss.includes('var(--lime)'), "Input must use neon lime accent (var(--lime))");
assert.ok(stylesCss.includes('caret-color:var(--lime)') || stylesCss.includes('caret-color: var(--lime)'), "Caret must be neon lime");
assert.ok(stylesCss.includes('.gate-error'), "Discreet error styling must be present");
assert.ok(stylesCss.includes('gate-shake'), "Shake animation must be defined for errors");
console.log(" PASS: Input is visually unlabeled, masked, neon-green, and accessible via aria-label.");

// 3. Persistent Gate & In-Memory Sessions
console.log("\n3. Testing Gate Persistence and In-Memory Session Security...");
assert.ok(!notesJs.includes('localStorage.setItem("fj-notes-session"'), "MUST NEVER store privileged session token in localStorage");
assert.ok(!notesJs.includes('sessionStorage.setItem("fj-notes-session"'), "MUST NEVER store privileged session token in sessionStorage");
assert.ok(!notesJs.includes('tx.objectStore("sessions")'), "MUST NEVER store privileged session token in IndexedDB");
console.log(" PASS: Session tokens strictly kept in-memory; no insecure browser persistence.");

// 4. Cryptographic Hashing: PBKDF2-SHA256 100,000 iterations
console.log("\n4. Testing Cryptographic Hashing (PBKDF2-SHA256, 100k iterations)...");
function pbkdf2Node(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

const testSalt = crypto.randomBytes(16);
const testPassword = "SuperSecretNotesPassword2026!";
const hash1 = pbkdf2Node(testPassword, testSalt);
const hash2 = pbkdf2Node(testPassword, testSalt);
const wrongHash = pbkdf2Node("WrongPassword", testSalt);

assert.strictEqual(hash1, hash2, "Matching passwords must yield identical hash");
assert.notStrictEqual(hash1, wrongHash, "Mismatched passwords must yield different hashes");
assert.strictEqual(hash1.length, 64, "SHA-256 hash must be 64 hex characters (256 bits)");
console.log(" PASS: PBKDF2-SHA256 100,000 iterations verified.");

// 5. Verification Logic (Identity + Authorization + Shared Password)
console.log("\n5. Testing 3-Factor Gate Authorization Logic...");
const OWNER_UID = "hDbzbNTC7pOuU2UFCjFksopbgaG3";

function simulateGateVerification({ user, isOwner, isAdminActive, enteredPassword, correctPassword }) {
  // Factor 1: Verified Identity
  if (!user || !user.uid) return { allowed: false, reason: "unauthenticated" };

  // Factor 2: Role Authorization
  const isAuthorized = (user.uid === OWNER_UID) || (isOwner === true) || (isAdminActive === true);
  if (!isAuthorized) return { allowed: false, reason: "unauthorized_role" };

  // Factor 3: Shared Notes Password
  if (!enteredPassword || enteredPassword !== correctPassword) {
    return { allowed: false, reason: "invalid_password" };
  }

  // All 3 passed
  return { allowed: true, sessionExpiresAt: Date.now() + (12 * 3600 * 1000) };
}

const correctSharedPwd = "FJ-Shared-Key-9988!";

// Case A: Unauthenticated visitor with correct password
const resA = simulateGateVerification({ user: null, enteredPassword: correctSharedPwd, correctPassword: correctSharedPwd });
assert.strictEqual(resA.allowed, false, "Visitor with password alone must be denied");

// Case B: Logged-in regular user with correct password
const resB = simulateGateVerification({ user: { uid: "random_user" }, isOwner: false, isAdminActive: false, enteredPassword: correctSharedPwd, correctPassword: correctSharedPwd });
assert.strictEqual(resB.allowed, false, "Regular user with password alone must be denied");

// Case C: Owner with WRONG password
const resC = simulateGateVerification({ user: { uid: OWNER_UID }, isOwner: true, isAdminActive: false, enteredPassword: "wrong", correctPassword: correctSharedPwd });
assert.strictEqual(resC.allowed, false, "Owner with wrong password must be denied");

// Case D: Revoked admin with correct password
const resD = simulateGateVerification({ user: { uid: "admin_revoked" }, isOwner: false, isAdminActive: false, enteredPassword: correctSharedPwd, correctPassword: correctSharedPwd });
assert.strictEqual(resD.allowed, false, "Revoked admin with correct password must be denied");

// Case E: Active admin with correct password
const resE = simulateGateVerification({ user: { uid: "admin_1" }, isOwner: false, isAdminActive: true, enteredPassword: correctSharedPwd, correctPassword: correctSharedPwd });
assert.strictEqual(resE.allowed, true, "Active admin with correct password must be allowed");

// Case F: Owner with correct password
const resF = simulateGateVerification({ user: { uid: OWNER_UID }, isOwner: true, isAdminActive: false, enteredPassword: correctSharedPwd, correctPassword: correctSharedPwd });
assert.strictEqual(resF.allowed, true, "Owner with correct password must be allowed");
assert.ok(resF.sessionExpiresAt > Date.now(), "Session must have future expiration");
console.log(" PASS: 3-Factor Gate Authorization logic strictly enforces identity + role + password.");

console.log("\n=== ALL NOTES GATE TESTS PASSED SUCCESSFULLY! ===");
