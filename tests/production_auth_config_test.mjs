import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const configText = fs.readFileSync(path.join(root, 'firebase-config.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));

assert.match(configText, /projectId:[^\n]*"fj-website-384fd"/);
assert.match(configText, /authDomain:\s*"fj-website-384fd\.firebaseapp\.com"/);
assert.ok(firebaseJson.emulators?.auth?.port === 9099);
assert.ok(firebaseJson.emulators?.firestore?.port === 8080);
assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);

const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fj-production-auth-audit-'));
try {
  const exportPath = path.join(exportDir, 'accounts.json');
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npx', '--yes', 'firebase-tools@15.37.0', 'auth:export', exportPath, '--project', 'fj-website-384fd'], { stdio: 'pipe' });
  } else {
    execFileSync('npx', ['--yes', 'firebase-tools@15.37.0', 'auth:export', exportPath, '--project', 'fj-website-384fd'], { stdio: 'pipe' });
  }
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  assert.ok(Array.isArray(exported.users));
  assert.ok(exported.users.length >= 1);

  console.log('PRODUCTION AUTH CONFIG:');
  console.log(`- Firebase project: fj-website-384fd`);
  console.log(`- Production account inventory exported: ${exported.users.length} account(s)`);
  console.log('- Email/password provider: production config requires Firebase Console verification; emulator test proves Auth lifecycle behavior');
  console.log('- Authorized domains: cannot be verified without Firebase Console Management API credentials');
  console.log('- Verification/reset templates: built-in Firebase templates remain configurable in the Firebase Console');
  console.log('- Production inbox delivery: not claimed; controlled mailbox/test identity is required');
  console.log('PRODUCTION AUTH CONFIG AUDIT PASSED');
} finally {
  fs.rmSync(exportDir, { recursive: true, force: true });
}
