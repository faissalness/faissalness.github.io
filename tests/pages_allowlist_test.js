const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
const allowlistSection = workflow.split(/for file in \\\r?\n/)[1]?.split('; do')[0];
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

console.log('=== PAGES PUBLIC ARTIFACT ALLOWLIST: 7 / 7 PASSED ===');
