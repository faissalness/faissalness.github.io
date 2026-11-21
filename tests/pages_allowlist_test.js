const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Normalize line endings so the same assertion works in a CRLF Windows checkout
// and in the LF GitHub Actions runner.
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8').replace(/\r\n?/g, '\n');
const allowlistSection = workflow.split('for file in \\\n')[1]?.split('; do')[0];
assert.ok(allowlistSection, 'Pages workflow must use an explicit public file allowlist');
const allowlist = allowlistSection.replace(/\\/g, '').trim().split(/\s+/).filter(Boolean);
const required = [
  'index.html', 'meet.html', 'gods.html', 'notes.html', 'random.html', 'qr.html', 'pip.html', 'ground-zero.html',
  'app.js', 'private-page.js', 'notes.js', 'pip.js', 'ground-zero.js', 'note-crypto.mjs', 'random.js', 'qr-client.js', 'qr-tech.js', 'qr-url.js',
  'destinations.js', 'firebase-config.js', 'styles.css', 'favicon.svg', 'qr.png'
];

assert.ok(workflow.includes('actions/upload-pages-artifact@v3') && workflow.includes('actions/deploy-pages@v4'),
  'Pages workflow must upload and deploy the static artifact');
assert.ok(required.every(file => allowlist.includes(file)), 'Public allowlist must contain the site assets');
assert.ok(allowlist.every(file => !/(worker|firestore\.rules|wrangler|\.map|backup|test)/i.test(file)),
  `Public allowlist must exclude backend, rules, maps, backups, and tests: ${allowlist.join(', ')}`);
assert.ok(allowlist.every(file => fs.existsSync(path.join(root, file))), 'Every allowlisted file must exist');
assert.ok(workflow.includes("-iname '*.map'") && workflow.includes("-iname '*worker*'"),
  'Build must fail if worker or source-map files appear in the public artifact');
assert.ok(workflow.includes('cp -- pip.html dist/pip/index.html') && workflow.includes('cp -- qr.html dist/qr/index.html'),
  'The PIP and QR clean routes must be included in the published artifact');

const publicPages = ['index.html', 'meet.html', 'gods.html', 'notes.html', 'random.html', 'qr.html', 'pip.html', 'ground-zero.html'];
const allPublicPagesCsp = publicPages.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.ok(allPublicPagesCsp.includes("script-src 'self' https://www.gstatic.com"),
  'Published CSP must allow the Firebase SDK script source from gstatic');
assert.ok(allPublicPagesCsp.includes('https://firebaseinstallations.googleapis.com'),
  'Published CSP connect-src must allow the Firebase Installations API');
assert.ok(allPublicPagesCsp.includes('https://fj-website-384fd.firebaseapp.com'),
  'Published CSP must allow the Firebase Auth handler origin');

console.log('=== PAGES PUBLIC ARTIFACT ALLOWLIST: 8 / 8 PASSED ===');
