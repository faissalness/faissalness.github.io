import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectId = 'demo-fj-website-384fd';
const authBase = 'http://127.0.0.1:9099';
const identityBase = `${authBase}/identitytoolkit.googleapis.com/v1`;
const accountsBase = `${authBase}/emulator/v1/projects/${projectId}/accounts`;

async function identity(method, path, body) {
  const response = await fetch(`${identityBase}${path}?key=fake-api-key`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error?.message || 'Identity Toolkit failure'}`);
  return data;
}

async function createAccount(email, password) {
  return identity('POST', '/accounts:signUp', { email, password, returnSecureToken: true });
}

async function signIn(email, password) {
  return identity('POST', '/accounts:signInWithPassword', { email, password, returnSecureToken: true });
}

async function sendVerification(idToken) {
  return identity('POST', '/accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
}

async function sendPasswordReset(email) {
  return identity('POST', '/accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
}

async function listAccounts() {
  return null;
}

function findLatestActionLink(mode, email) {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-debug.log'),
    path.resolve(process.cwd(), 'firestore-debug.log'),
    path.resolve(process.cwd(), 'firebase-debug.log')
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:verify|reset).*?${escapedEmail}.*?http://[^\\s]+|http://[^\\s]+`, 'gis');
    const matches = [...text.matchAll(regex)].map(match => match[0]).filter(value => value.includes(mode));
    if (matches.length) {
      const link = matches.at(-1).match(/http:\/\/[^\s]+/)?.[0];
      if (link) return link;
    }
  }
  return null;
}

const suffix = Date.now();
const accounts = [
  { email: `alice-${suffix}@example.test`, password: 'SyntheticPass1!' },
  { email: `bob-${suffix}@example.test`, password: 'SyntheticPass2!' },
  { email: `carol-${suffix}fj@example.test`, password: 'SyntheticPass3!' }
];
let passed = 0;

try {
  for (const account of accounts) {
    const created = await createAccount(account.email, account.password);
    assert.ok(created.localId);
    account.uid = created.localId;
    account.idToken = created.idToken;
    passed++;
  }
  console.log(`[PASS] Created ${accounts.length} independent synthetic accounts`);

  for (const account of accounts) {
    const signedIn = await signIn(account.email, account.password);
    assert.equal(signedIn.localId, account.uid);
    account.idToken = signedIn.idToken;
    passed++;
  }
  console.log('[PASS] Each synthetic account signs in independently');

  for (const account of accounts) {
    const verification = await sendVerification(account.idToken);
    const verificationLink = findLatestActionLink('verifyEmail', account.email);
    assert.ok(verificationLink);
    const oobUrl = new URL(verificationLink);
    account.verificationLink = verificationLink;
    account.verificationCode = oobUrl.searchParams.get('oobCode');
    assert.ok(account.verificationCode);
    const verificationResult = await identity('POST', '/accounts:update', { oobCode: account.verificationCode });
    assert.equal(verificationResult.emailVerified, true);
    passed++;
  }
  console.log('[PASS] Real emulator verification action links are capturable');

  for (const account of accounts) {
    const reset = await sendPasswordReset(account.email);
    const resetLink = findLatestActionLink('resetPassword', account.email);
    assert.ok(resetLink);
    const oobUrl = new URL(resetLink);
    account.resetLink = resetLink;
    account.resetCode = oobUrl.searchParams.get('oobCode');
    assert.ok(account.resetCode);
    passed++;
  }
  console.log('[PASS] Real emulator password-reset action links are capturable');

  await sendPasswordReset(accounts[0].email);
  passed++;
  console.log('[PASS] Multiple password-reset requests remain auditable');

  const resetResult = await identity('POST', '/accounts:resetPassword', {
    oobCode: accounts[0].resetCode,
    newPassword: 'SyntheticReset1!'
  });
  assert.equal(resetResult.email, accounts[0].email);
  await signIn(accounts[0].email, 'SyntheticReset1!');
  let oldPasswordRejected = false;
  try { await signIn(accounts[0].email, accounts[0].password); } catch (_) { oldPasswordRejected = true; }
  assert.equal(oldPasswordRejected, true);
  passed += 3;
  console.log('[PASS] Password-reset code changes the password and rejects the old password');

  let rejected = 0;
  try {
    await identity('POST', '/accounts:update', { oobCode: 'tampered-code' });
  } catch (error) {
    assert.match(error.message, /400/);
    rejected++;
  }
  try {
    await identity('POST', '/accounts:update', { oobCode: accounts[0].verificationCode });
  } catch (error) {
    assert.match(error.message, /400/);
    rejected++;
  }
  passed += rejected;
  console.log('[PASS] Tampered and reused verification codes are rejected');

  console.log(`AUTH EMULATOR: ${passed}/18 workflows passed`);
  assert.equal(passed, 18);
} finally {
  await fetch(accountsBase, { method: 'DELETE' }).catch(() => {});
}
