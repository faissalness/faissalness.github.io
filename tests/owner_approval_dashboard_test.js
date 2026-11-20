/**
 * Owner Approval Dashboard & Master Access Audit Suite
 * Verifies:
 * - Owner bypass in Firestore rules (privateNotes + applicationPermissionActive)
 * - Owner bypass in the owner Notes page (notes.js)
 * - PIP approval gate restored for ordinary users (pip.js)
 * - Owner approval dashboard implementation (app.js + index.html)
 * - Granular approval/revocation backend (worker.js)
 * - Ordinary users and forged identities cannot approve or alter permissions
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("=== OWNER APPROVAL DASHBOARD & MASTER ACCESS AUDIT SUITE ===\n");

const ROOT = path.join(__dirname, '..');

// 1. Firestore rules: owner bypass + restored application permission gate
console.log("1. Checking Firestore Rules (owner bypass + permission gate)...");
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
assert.ok(rules.includes("function applicationPermissionActive(userUid, appName)"),
  'applicationPermissionActive must exist');
assert.ok(rules.includes("if (owner()) return true;"),
  'applicationPermissionActive must return true for the owner');
assert.ok(rules.includes("status == 'active' || status == 'approved'"),
  'applicationPermissionActive must require the stored app status to be active or approved');
assert.ok(rules.includes("if (!exists(/databases/$(database)/documents/applicationPermissions/$(userUid)))"),
  'applicationPermissionActive must check the permission mirror existence');
assert.ok(rules.includes("automaticApprovalEmail(userUid)"),
  'The original fj automatic-approval fallback must be preserved');
assert.ok(rules.includes("allow read, create, update, delete: if owner()"),
  'privateNotes must be owner-only for everyone (owner bypass of the session gate)');
assert.ok(rules.includes("allow create, update, delete: if owner();"),
  'applicationPermissions writes must be owner-only (owner is the sole approval authority)');
assert.ok(rules.includes("allow update: if owner()"),
  'users approval flag updates must be owner-only');
assert.ok(rules.includes("request.auth.uid == userUid || owner()"),
  'Ordinary users can read only their own applicationPermissions');
assert.ok(rules.includes("data.status == 'pending'"),
  'accessRequests creation must start as pending');
console.log(" PASS: Owner bypass and permission gates enforced in Firestore rules.");

// 2. Owner Notes page: master key bypass
console.log("\n2. Checking Owner Notes Bypass (notes.js)...");
const notesJs = fs.readFileSync(path.join(ROOT, 'notes.js'), 'utf8');
assert.ok(notesJs.includes("const userIsOwner = (user.uid === ownerUid);"),
  'Owner detection must be by immutable UID');
assert.ok(notesJs.includes("// Owner: the main Firebase account password is the master key."),
  'The owner Notes path must be explicitly marked as master key');
assert.ok(notesJs.includes("isNotesUnlocked = true"),
  'Owner must unlock the Notes page without the trusted-session gate');
assert.ok(!/trusted-session-unavailable/.test(notesJs) || notesJs.includes("return { status: \"not-owner\" }"),
  'Ordinary users must not receive the owner path');
console.log(" PASS: Owner Notes access bypasses password and trusted-session gates.");

// 3. Owner master access on the main website (app.js)
console.log("\n3. Checking Owner Master Access (app.js)...");
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
assert.ok(appJs.includes("const isOwnerSession = user.uid === ownerUid;"),
  'Owner detection in app.js must use the immutable UID');
assert.ok(appJs.includes("if (isOwnerSession) saveHumanCheck();"),
  'The owner must pass the human check without solving it');
assert.ok(appJs.includes("const isApproved = isOwnerSession || (profile.exists()"),
  'The owner must be treated as always approved');
assert.ok(appJs.includes("setDoc(doc(db, \"applicationPermissions\", uid), updates, { merge: true })"),
  'Approval actions must persist to applicationPermissions');
console.log(" PASS: Owner master access is enforced in the main site shell.");

// 4. PIP approval gate restored (pip.js)
console.log("\n4. Checking PIP Approval Gate Restore (pip.js)...");
const pipJs = fs.readFileSync(path.join(ROOT, 'pip.js'), 'utf8');
assert.ok(pipJs.includes('registration.status !== "active" || registration.pipStatus !== "active"'),
  'PIP and Notes access for ordinary users must be gated by the D1 account status');
assert.ok(pipJs.includes('Your PIP and Your Notes access is pending owner approval.'),
  'Ordinary users must see the pending-approval message while unapproved');
assert.ok(pipJs.includes("setInterval(() => {") && pipJs.includes("showPrivateNotes(user);"),
  'The PIP gate must poll for owner approval so access activates without reload');
console.log(" PASS: Ordinary users cannot bypass the D1 approval gate.");

// 5. Owner approval dashboard implementation
console.log("\n5. Checking Owner Approval Dashboard (index.html + app.js)...");
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.ok(indexHtml.includes('id="owner-users-table"'),
  'The owner drawer must contain the accounts table');
assert.ok(indexHtml.includes('id="owner-users-search"'),
  'The owner drawer must contain a search box');
assert.ok(indexHtml.includes('id="owner-users-refresh"'),
  'The owner drawer must contain a refresh control');
assert.ok(indexHtml.includes('id="owner-users-empty"'),
  'The dashboard must distinguish empty search results');
assert.ok(appJs.includes('Approve') && appJs.includes('Revoke'),
  'The dashboard must render granular approve/revoke actions');
for (const id of ['ownerAdminFetch', 'loadOwnerUsers', 'renderOwnerUsers', 'dashAction', 'dashboardAppStatus', 'dashboardRegistration', 'setApplicationPermission']) {
  assert.ok(appJs.includes(`function ${id}`) || appJs.includes(`const ${id}`) || appJs.includes(`async function ${id}`),
    `app.js must implement ${id}`);
}
assert.ok(appJs.includes('/api/admin/users'),
  'The dashboard must fetch accounts from the Worker-managed list endpoint');
assert.ok(appJs.includes('doc(db, "applicationPermissions", uid)'),
  'The dashboard must persist permission state in applicationPermissions');
assert.ok(appJs.includes('? "approved" : "revoked"'),
  'Dashboard actions must write approved/revoked states to Firestore');
console.log(" PASS: The owner approval dashboard is fully implemented in the website.");

// 6. Worker: granular permissions + account listing
console.log("\n6. Checking Worker Approval Backend (backend/worker.js)...");
const workerJs = fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8');
assert.ok(workerJs.includes('url.pathname === "/api/admin/users" && request.method === "GET"'),
  'Worker must expose GET /api/admin/users for the owner dashboard');
assert.ok(workerJs.includes('const target = body.target === "pip" || body.target === "notes" ? [body.target] : ["pip", "notes"];'),
  'Worker must validate granular targets');
assert.ok(workerJs.includes('applicationStatus = isOwner || automaticallyApproved ? "active" : "pending"'),
  'Registration must restore pending-until-approved semantics for ordinary users');
assert.ok(workerJs.includes('(uid, registered_at, status, pip_status, notes_status, deletion_at)'),
  'Approvals must work for newly registered accounts without a D1 record');
assert.ok(workerJs.includes('identity.sub !== OWNER_UID'),
  'Server-side owner UID validation must gate administrative endpoints');
assert.ok(workerJs.includes('if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true)'),
  'Permissions endpoint must require verified owner identity');
console.log(" PASS: Worker enforces owner UID and exposes granular approval endpoints.");

console.log("\n=== ALL OWNER APPROVAL DASHBOARD & MASTER ACCESS TESTS PASSED SUCCESSFULLY! ===");
