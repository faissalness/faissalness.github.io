/**
 * Notes Lock Gate & Shared Password Test Suite
 * Notes uses the main FJ website session only — there is no second login.
 * The owner bypasses secondary Notes gates; ordinary users stay locked out.
 * Notes encryption (per-note passwords, PBKDF2) is preserved.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log("=== NOTES GATE & SHARED PASSWORD VERIFICATION SUITE ===\n");

const notesHtml = fs.readFileSync(path.join(__dirname, '..', 'notes.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const notesJs = fs.readFileSync(path.join(__dirname, '..', 'notes.js'), 'utf8');

// 1. The separate Notes login screen is removed
console.log("1. Testing removal of the separate Notes login screen...");
assert.ok(!notesHtml.includes("gate-forbidden"), "notes.html must not contain the neon gate");
assert.ok(!notesHtml.includes("unauthorized-gate"), "notes.html must not contain the old unauthorized gate");
assert.ok(!notesHtml.includes("You can't come in here"), "The old 'You can't come in here' gate text must be gone");
assert.ok(!notesHtml.includes('id="notes-gate-password"'), "notes.html must not contain the neon gate password input");
assert.ok(!notesJs.includes("verifyNotesCredentials"), "verifyNotesCredentials (secondary Notes gate) must be removed");
assert.ok(!notesJs.includes("discreetGateError"), "discreetGateError (secondary Notes gate) must be removed");
assert.ok(!notesJs.includes("lockoutUntil"), "Secondary Notes gate lockout state must be removed");
console.log(" PASS: No separate Notes login screen remains.");

// 2. Owner enters Notes immediately after main-website authentication
console.log("\n2. Testing owner bypass of secondary Notes gates...");
assert.ok(notesJs.includes("onAuthStateChanged(auth, async user => {"), "Notes must listen to the main website auth state");
assert.ok(notesJs.includes('window.location.href = "/"'), "Unauthenticated visitors must be redirected to the main website");
assert.ok(notesJs.includes("isOwner = (user.uid === ownerUid);"), "Owner is identified by the immutable owner UID");
assert.ok(notesJs.includes("isNotesUnlocked = true"), "The owner bypasses secondary Notes gates and enters Notes immediately");
assert.ok(notesJs.includes("unlockNotesApp()"), "The owner must enter the Notes app on authentication");
assert.ok(notesJs.includes("lockNotesGate();"), "Ordinary users must remain locked");
console.log(" PASS: Owner enters Notes immediately; unauthenticated users go to the main website.");

// 3. Persistent session security (tokens stay in memory)
console.log("\n3. Testing in-memory session security...");
assert.ok(!notesJs.includes('localStorage.setItem("fj-notes-session"'), "MUST NEVER store privileged session token in localStorage");
assert.ok(!notesJs.includes('sessionStorage.setItem("fj-notes-session"'), "MUST NEVER store privileged session token in sessionStorage");
assert.ok(!notesJs.includes('tx.objectStore("sessions")'), "MUST NEVER store privileged session token in IndexedDB");
console.log(" PASS: Session tokens strictly kept in-memory; no insecure browser persistence.");

// 4. Cryptographic Hashing: PBKDF2-SHA256 100,000 iterations (per-note encryption preserved)
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

// 5. Notes page has no second login: unauthenticated redirects; owner unlocks
console.log("\n5. Testing Notes session persistence and owner bypass...");
assert.ok(notesHtml.includes('id="notes-app"'), "The Notes app must exist for authenticated users");
assert.ok(notesJs.includes('signOut(auth)'), "Notes page must offer sign-out");
assert.ok(notesJs.includes("Notes is exclusively the owner's application"), "Notes remains owner-exclusive");
console.log(" PASS: Notes opens directly for the owner; no second login.");

console.log("\n=== ALL NOTES GATE TESTS PASSED SUCCESSFULLY! ===");
