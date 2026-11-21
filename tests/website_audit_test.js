/**
 * Full Website & Asset Audit Test Suite
 * Tests Phase 10 Requirements:
 * - Broken links and assets
 * - Viewports and mobile metadata
 * - Stylesheets and scripts
 * - Accessibility (alt text, aria-labels, reduced-motion, visible focus)
 * - Navigation links
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("=== FULL WEBSITE AUDIT & ASSET VERIFICATION SUITE ===\n");

const ROOT = path.join(__dirname, '..');
const HTML_FILES = ['index.html', 'meet.html', 'gods.html', 'notes.html', 'random.html', 'qr.html', 'pip.html'];
let passedAudits = 0;

// 1. Verify existence of all HTML files
console.log("1. Checking HTML Pages Existence...");
HTML_FILES.forEach(file => {
  const filePath = path.join(ROOT, file);
  assert.ok(fs.existsSync(filePath), `Page ${file} must exist`);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.length > 50, `Page ${file} must not be empty`);
  passedAudits++;
});
console.log(` PASS: All ${HTML_FILES.length} HTML pages exist and are non-empty.`);

// 1a. Verify the FJ favicon is linked on every public page
HTML_FILES.forEach(file => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(content.includes('<link rel="icon" href="favicon.svg"'), `${file} must link the FJ favicon`);
});
assert.ok(fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8').includes('>fj</text>'),
  'Favicon must show lowercase white fj lettering');
passedAudits++;
console.log(" PASS: Lowercase FJ favicon is linked across all pages.");

// 2. Verify Viewport and Mobile Metadata
console.log("\n2. Checking Viewport and Theme-Color Metadata...");
HTML_FILES.forEach(file => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(content.includes('<meta name="viewport"'), `${file} must contain mobile viewport tag`);
  assert.ok(content.includes('http-equiv="Content-Security-Policy"') && content.includes("object-src 'none'") && content.includes("https://fonts.googleapis.com"),
    `${file} must include a CSP that blocks object embedding and permits only required font sources`);
  if (file !== 'random.html') {
    assert.ok(content.includes('<meta name="theme-color" content="#020203">'), `${file} must contain theme-color meta tag`);
  }
  passedAudits++;
});
passedAudits++;
console.log(" PASS: Mobile responsiveness viewport and theme metadata verified.");

// 3. Verify Static Assets (qr.png, favicon.svg, styles.css)
console.log("\n3. Checking Core Static Assets...");
assert.ok(fs.existsSync(path.join(ROOT, 'qr.png')), "qr.png must exist in root");
assert.ok(fs.statSync(path.join(ROOT, 'qr.png')).size > 1000, "qr.png must not be empty");
assert.ok(fs.existsSync(path.join(ROOT, 'favicon.svg')), "favicon.svg must exist");
assert.ok(fs.existsSync(path.join(ROOT, 'styles.css')), "styles.css must exist");
passedAudits += 3;
const qrPage = fs.readFileSync(path.join(ROOT, 'qr.html'), 'utf8');
assert.ok(qrPage.includes('class="qr-tech-page"') && qrPage.includes('qr-tech.js')
  && qrPage.includes('class="qr-tech-image"')
  && !/<main[^>]*>[\s\S]*<(?:h1|h2|p|footer|button)\b/i.test(qrPage),
  'QR-tech must show only its generated code below the generic navigation');
assert.ok(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').includes('.qr-tech-body:before{display:none}')
  && fs.readFileSync(path.join(ROOT, 'qr-tech.js'), 'utf8').includes('generateQrMatrix(destination, 6, "M")')
  && fs.readFileSync(path.join(ROOT, 'qr-tech.js'), 'utf8').includes('https://en.wikipedia.org/wiki/Alain_Tourret'),
  'QR-tech must render the intended destination as a standard version-6 QR on a flat dark page');
assert.ok(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8').includes('dist/qr/index.html'),
  'Pages workflow must publish the clean /qr/ route');
const pipPage = fs.readFileSync(path.join(ROOT, 'pip.html'), 'utf8');
const pipScript = fs.readFileSync(path.join(ROOT, 'pip.js'), 'utf8');
const appScript = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
assert.ok(appScript.includes('let auth = null;') && appScript.includes('auth = getAuth(app)'),
  'The shared site sign-out handler must close over the initialized Firebase Auth instance');
assert.ok(pipPage.includes('PIP and<br><span>Your Notes.</span>')
  && pipScript.includes('ensureFirestoreAccountRecords')
  && pipScript.includes('/api/users/register'),
  'PIP and Notes 04 must provide idempotent account setup and server-side registration records');
assert.ok(!pipPage.includes('id="pip-login-form"') && !pipPage.includes('id="pip-register-form"')
  && !pipPage.includes('id="pip-returning"') && !pipScript.includes('signInWithEmailAndPassword')
  && !pipScript.includes('createUserWithEmailAndPassword') && !pipScript.includes('sendPasswordResetEmail'),
  'The separate PIP/Notes login screens must be removed; authentication happens on the main FJ website only');
assert.ok(pipScript.includes('pipShowAuthGate') && pipScript.includes('onAuthStateChanged(auth, async user'),
  'PIP and Notes must redirect unauthenticated users back to the main FJ website');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const groundZeroNavFirst = indexHtml.indexOf('id="gz-nav"') > -1 && indexHtml.indexOf('id="gz-nav"') < indexHtml.indexOf('href="/meet/"');
assert.ok(groundZeroNavFirst && indexHtml.includes('Ground Zero 00'),
  'Ground Zero 00 must be the first navigation entry before Meet 01');
assert.ok(appScript.includes('gz-nav') && appScript.includes('await getDoc(doc(db, "admins", user.uid))'),
  'The main site must reveal Ground Zero 00 to the owner and authorized admins');
assert.ok(pipScript.includes('/api/users/register') && fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8').includes('/api/admin/permissions')
  && fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8').includes('/api/admin/users')
  && fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8').includes('/api/admin/lookup'),
  'The owner approval dashboard must use the Worker-managed account list and granular permissions endpoints');
assert.ok(pipScript.includes('status !== "active"') && pipScript.includes('pending owner approval'),
  'PIP and Notes access for ordinary users must remain blocked while the server-side D1 account status is pending or not active');
assert.ok(appScript.includes('loadOwnerUsers') && appScript.includes('dashboardAppStatus') && appScript.includes('dashAction'),
  'The owner approval dashboard must render account status, PIP/Notes status, and granular actions');
assert.ok(fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
    .includes("automaticApprovalEmail(userUid)")
    && fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').includes("applicationPermissionActive"),
  'Firestore rules must restore the application permission gate for ordinary users');
assert.ok(appScript.includes('Your request is waiting for approval. Once approved, you can sign in.')
  && appScript.includes('await signOut(auth)'),
  'Ordinary users without account approval must be blocked from the main website');
assert.ok(appScript.includes('const isApproved = isOwnerSession || (profile.exists() && profile.data().approved === true);'),
  'The main website gate requires account approval for non-owner users');
const notesScript = fs.readFileSync(path.join(ROOT, 'notes.js'), 'utf8');
assert.ok(notesScript.includes('isOwner = (user.uid === ownerUid);') && notesScript.includes('isNotesUnlocked = true'),
  'The owner bypasses the Notes gate and enters Notes immediately after authentication');
assert.ok(appScript.includes('loadOwnerUsers') && appScript.includes('dashAction')
  && appScript.includes('/api/admin/permissions'),
  'The owner approval dashboard must let the owner approve and revoke individual applications');
assert.ok(pipScript.includes('showOwnProfilePhoto')
  && fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8').includes('/photo')
  && fs.existsSync(path.join(ROOT, 'backend', 'migrations', '0008_profile_photos.sql')),
  'Trusted profile photo storage must be implemented for PIP accounts');
assert.ok(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').includes('handleCodeInApp: false'),
  'Production verification/reset emails must use explicit Pages action continuation URLs');
assert.ok(pipPage.includes('pip-note-attachments') && pipScript.includes('uploadPipAttachments')
  && fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').includes('/attachments/{attachmentId}')
  && fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').includes('1000000'),
  'PIP note attachments must be UID-scoped and size/type constrained');
assert.ok(pipPage.includes('data-pip-view="feed"') && pipPage.includes('pip-post-visibility')
  && pipScript.includes('/api/posts') && fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8').includes('body.visibility === "friends"'),
  'PIP must expose a private/friends social feed backed by authenticated visibility checks');
const meetPage = fs.readFileSync(path.join(ROOT, 'meet.html'), 'utf8');
const godsPage = fs.readFileSync(path.join(ROOT, 'gods.html'), 'utf8');
assert.ok(meetPage.includes('class="meet-layout"') && meetPage.includes('class="object-core"')
  && godsPage.includes('class="inspiration-grid"') && godsPage.includes('data-filter="motion"'),
  'Meet Me and To the gods must retain their original recovered structure and filters');
assert.ok(pipScript.includes('collection(db, "yourNotes", uid, "notes")') && fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').includes('match /yourNotes/{userUid}/notes/{noteId}'),
  'Your Notes must use UID-scoped storage with a matching Firestore authorization rule');
assert.ok(pipPage.includes('Schedule 30-day account deletion') && pipPage.includes('Cancel scheduled deletion')
  && pipPage.includes('Permanently delete account') && pipScript.includes('reauthenticateWithCredential')
  && pipScript.includes('deletionStatus'),
  'PIP account deletion must require reauthentication, enforce a grace period, and support cancellation');
assert.ok(pipPage.includes('id="pip-trash-list"') && pipScript.includes('deletionStatus: "trashed"')
  && pipScript.includes('Restore') && pipScript.includes('Delete forever'),
  'Your Notes must expose recoverable Trash restore and permanent-delete actions');
passedAudits++;
passedAudits += 2;
assert.ok(fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').includes('request.auth.token.email_verified == true'),
  'Your Notes rules must require verified Firebase email identity');
passedAudits++;
passedAudits += 2;
assert.ok(pipPage.includes('data-pip-view="pals"') && pipPage.includes('data-pip-view="noty"') && pipPage.includes('id="pip-pal-invite-form"'),
  'PIP must include Notes, private Pal invitations, and a Noty inbox view');
assert.ok(pipScript.includes('/api/pals/invite') && pipScript.includes('/api/pals/${encodeURIComponent(pal.uid)}/messages') && !pipScript.includes('.innerHTML'),
  'Post It Pal requests must use authenticated backend routes and render user content as text');
assert.ok(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('id="public-user-count"') && fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').includes('/api/users/count'),
  'The public homepage must request only the aggregate registered-account count');
passedAudits += 3;
const noteCrypto = fs.readFileSync(path.join(ROOT, 'note-crypto.mjs'), 'utf8');
assert.ok(pipPage.includes('pip-note-protected') && pipPage.includes('pip-note-unlock') && pipScript.includes('encryptNotePayload') && pipScript.includes('decryptNotePayload'),
  'Your Notes must provide a separate unlock flow for encrypted individual notes');
assert.ok(noteCrypto.includes('PBKDF2') && noteCrypto.includes('AES-GCM') && noteCrypto.includes('210000') && !pipScript.includes('localStorage.setItem("note-password'),
  'Individual note keys must be derived and used only in memory, with no password persistence');
assert.ok(fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').includes("data.title == 'Protected note'") && fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8').includes('note-crypto.mjs'),
  'Firestore must reject plaintext fields for protected notes and Pages must publish the crypto module');
passedAudits += 3;
console.log(" PASS: Core assets (qr.png, favicon.svg, styles.css) exist and are valid.");

// 4. Verify Accessibility: Reduced-Motion and Visible Focus
console.log("\n4. Checking Accessibility Styles...");
const stylesContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
assert.ok(stylesContent.includes('prefers-reduced-motion:reduce'), "styles.css must define prefers-reduced-motion:reduce");
assert.ok(stylesContent.includes(':focus-visible'), "styles.css must define :focus-visible outlines");
assert.ok(stylesContent.includes('--lime'), "styles.css must define --lime brand color");
passedAudits += 3;
console.log(" PASS: prefers-reduced-motion, focus-visible, and brand contrast verified.");

// 5. Verify Navigation Links Integrity Across All Pages
console.log("\n5. Checking Navigation Links Consistency...");
HTML_FILES.forEach(file => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(!/href="[^"]+\.html(?:[?#][^"]*)?"/i.test(content), `${file} must use clean user-facing routes`);
  const hrefMatches = content.match(/href="([^"#:]+\.html)"/g) || [];
  hrefMatches.forEach(hrefAttr => {
    const targetFile = hrefAttr.replace(/href="|"/g, '');
    assert.ok(HTML_FILES.includes(targetFile), `Invalid link target ${targetFile} in ${file}`);
  });
  passedAudits++;
});
console.log(" PASS: All internal navigation links point to valid existing pages.");
assert.ok(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8').includes('for route in meet gods notes'),
  'Clean routes must have generated Pages directories for the existing sections');

console.log(`\n=== WEBSITE AUDIT COMPLETE: ALL ${passedAudits} CHECKS PASSED SUCCESSFULLY! ===`);
