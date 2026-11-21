/**
 * Ground Zero 00 — Owner/Admin Control Center Test Suite
 * - Dedicated Ground Zero 00 page and nav before Meet 01.
 * - Owner/authorized-admin-exclusive access.
 * - Two distinct permission systems (website vs PIP/Notes).
 * - Dashboard actions: website/PIP/Notes approve+revoke, suspend/reactivate/delete.
 * - No redundant PIP/Notes login; unauthenticated redirect.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("=== GROUND ZERO 00 CONTROL CENTER TEST SUITE ===\n");

const ROOT = path.join(__dirname, '..');
const groundZeroPage = fs.readFileSync(path.join(ROOT, 'ground-zero.html'), 'utf8');
const groundZeroJs = fs.readFileSync(path.join(ROOT, 'ground-zero.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const notesHtml = fs.readFileSync(path.join(ROOT, 'notes.html'), 'utf8');
const pipHtml = fs.readFileSync(path.join(ROOT, 'pip.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const workerJs = fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');

let count = 0;
function check(name, condition) { assert.ok(condition, name); count += 1; console.log(` PASS: ${name}`); }

console.log("1. Dedicated page and route");
check('ground-zero.html exists as a dedicated page', fs.existsSync(path.join(ROOT, 'ground-zero.html')));
check('ground-zero.html is the Ground Zero 00 control center', groundZeroPage.includes('Ground Zero <span>00</span>') && groundZeroPage.includes('OWNER & ADMIN CONTROL CENTER'));
check('ground-zero.js holds the page logic', fs.existsSync(path.join(ROOT, 'ground-zero.js')));
check('Ground Zero 00 route is deployed (dist/ground-zero/index.html)', fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8').includes('cp -- ground-zero.html dist/ground-zero/index.html'));
check('Ground Zero 00 clean route artifact is packaged with injected base href', workflow.includes('cp -- ground-zero.html dist/ground-zero/index.html') && workflow.includes('<base href="/">'));
check('Ground Zero 00 homepage nav uses the clean /ground-zero/ route', indexHtml.includes('id="gz-nav"') && indexHtml.includes('href="/ground-zero/"') && !indexHtml.includes('href="/ground-zero.html"'));

console.log("\n2. Navigation: Ground Zero 00 before Meet 01");
for (const file of ['index.html', 'notes.html', 'pip.html']) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  check(`${file} has Ground Zero 00 first in the nav`, html.indexOf('id="gz-nav"') > -1 && html.indexOf('id="gz-nav"') < html.indexOf('href="/meet/"'));
}
check('Homepage Ground Zero 00 navigation routes into the dedicated Ground Zero page', indexHtml.includes('id="gz-nav"') && indexHtml.includes('href="/ground-zero/'));
check('Homepage Ground Zero 00 navigation does not target a raw .html artifact path', !indexHtml.includes('href="/ground-zero.html"'));

console.log("\n3. Owner/admin-exclusive access");
check('Ground Zero redirects unauthenticated visitors to the main website', groundZeroJs.includes('window.location.href = "/"'));
check('Ground Zero allows the owner by the immutable UID', groundZeroJs.includes('gzUser.uid === ownerUid') && groundZeroJs.includes('admins.has(gzUser.uid)'));
check('Ground Zero reads the admins collection for authorized admins', groundZeroJs.includes('collection(db, "admins")'));
check('Ground Zero uses the shared default Firebase app instance for auth state', groundZeroJs.includes('const app = initializeApp(firebaseConfig);'));
check('Ground Zero has no custom Firebase app instance name', !groundZeroJs.includes('initializeApp(firebaseConfig, "FJGroundZero")'));
check('Ground Zero uses the official authStateReady settlement signal without polling delays', groundZeroJs.includes('auth.authStateReady()') && !groundZeroJs.includes('setTimeout'));
check('Ground Zero exposes the deterministic auth state machine', groundZeroJs.includes('"INITIALIZING"') && groundZeroJs.includes('"AUTHORIZED"') && groundZeroJs.includes('"UNAUTHORIZED"') && groundZeroJs.includes('"ERROR"'));
check('Ground Zero never authorizes a deactivated admin', groundZeroJs.includes('adminRecord.active !== false'));
check('Ground Zero hides hero content during INITIALIZING and shows it after authorization', groundZeroJs.includes('gzShowContent') && groundZeroJs.includes('gz-hero'));
check('Ground Zero suppresses content before any authorization decision runs', groundZeroJs.includes('gzDisplayLoading') && groundZeroJs.includes('gzCheckAuthorization') && groundZeroJs.indexOf('gzDisplayLoading') < groundZeroJs.indexOf('gzCheckAuthorization'));
check('Main site reveals Ground Zero 00 for the owner and authorized admins', appJs.includes('#gz-nav') && appJs.includes('getDoc(doc(db, "admins", user.uid))'));

console.log("\n4. Two distinct permission systems");
check('Ground Zero separates website vs PIP/Notes permissions',
  groundZeroPage.includes('Website authorization (main site) is separate from PIP/Notes authorization')
  && groundZeroJs.includes('kind === "website"') && groundZeroJs.includes('kind === "pip" || kind === "notes" || kind === "both"'));
check('Website approval writes Firestore users approved via owner rules',
  groundZeroJs.includes('updateDoc(userRef, { approved: action === "approve" })'));
check('PIP/Notes approval mirrors Firestore applicationPermissions via owner rules',
  groundZeroJs.includes('doc(db, "applicationPermissions", uid)') && workerJs.includes('/api/admin/permissions'));
check('Ground Zero enforces account status via the Worker backend',
  workerJs.includes('url.pathname === "/api/admin/accounts"') && workerJs.includes('identity.sub !== OWNER_UID'));

console.log("\n5. Dashboard actions");
for (const action of ['Approve Website', 'Reject Website', 'Approve PIP', 'Revoke PIP', 'Approve Notes', 'Revoke Notes', 'Approve Both', 'Revoke Both', 'Suspend', 'Reactivate', 'Delete']) {
  check(`Ground Zero offers "${action}"`, groundZeroPage.includes(action) || groundZeroJs.includes(action));
}
check('Owner authorizes admins through the admins collection',
  groundZeroJs.includes('doc(db, "admins", uid)') && groundZeroJs.includes('setDoc(doc(db, "admins"'));

console.log("\n6. Ground Zero backend endpoints");
check('GET /api/admin/accounts lists accounts owner-only', workerJs.includes('url.pathname === "/api/admin/accounts"') && workerJs.includes('Owner access required'));
check('POST /api/admin/accounts/{uid}/suspend|reactivate|delete are owner-only',
  workerJs.includes('gzAccountPathMatch[2]') && workerJs.includes("(?:\\/(suspend|reactivate|delete))?") && workerJs.includes('Owner access required'));
check('Suspend sets the account to scheduled; reactivate restores active + PIP',
  workerJs.includes("UPDATE registered_users SET status = 'scheduled', deletion_at = NULL WHERE uid = ?") && workerJs.includes("UPDATE registered_users SET status = 'active', pip_status = 'active', notes_status = 'active', deletion_at = NULL WHERE uid = ?"));
check('Delete endpoint removes the D1 account and related records', workerJs.includes('DELETE FROM registered_users WHERE uid = ?'));

console.log("\n7. No redundant PIP/Notes login");
const pipJs = fs.readFileSync(path.join(ROOT, 'pip.js'), 'utf8');
for (const removed of ['pip-login-form', 'pip-register-form', 'pip-returning', 'pip-switch-account', 'pip-reset']) {
  check(`PIP has no "${removed}"`, !pipHtml.includes(`id="${removed}"`));
}
check('PIP redirects unauthenticated users to the main website', pipJs.includes('window.location.href = "/"'));
check('PIP + Notes use the shared default Firebase app instance', pipJs.includes('const app = initializeApp(firebaseConfig);') && !pipJs.includes('initializeApp(firebaseConfig, "FJYourNotes")'));
check('PIP page copy says authentication happens on the main website', pipHtml.includes('Users authenticate on the main FJ website'));
check('Notes has no neon gate or second login', !notesHtml.includes('unauthorized-gate') && !notesHtml.includes('notes-gate-password'));
const notesJs = fs.readFileSync(path.join(ROOT, 'notes.js'), 'utf8');
check('Notes redirects unauthenticated users to the main website', notesJs.includes('window.location.href = "/"'));
check('Notes page has no second login (neon gate removed from JS)', !notesJs.includes('verifyNotesCredentials') && !notesJs.includes('notes-gate-password'));

console.log(`\n=== GROUND ZERO TEST COUNT: ${count} ===`);
console.log("=== ALL GROUND ZERO 00 CONTROL CENTER TESTS PASSED ===");
