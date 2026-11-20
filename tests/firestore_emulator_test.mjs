import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deps = process.env.FJ_TEST_DEPS;
if (!deps) throw new Error('Set FJ_TEST_DEPS to the directory containing emulator test dependencies.');
const require = createRequire(path.join(deps, 'package.json'));
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } = require('firebase/firestore');

const projectId = 'demo-fj-website-384fd';
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
let passed = 0;
const check = async (name, operation, assertion) => {
  await assertion(operation);
  passed += 1;
  console.log(`[PASS] ${name}`);
};

try {
  await environment.clearFirestore();
  const alice = environment.authenticatedContext('alice', { email_verified: true }).firestore();
  const bob = environment.authenticatedContext('bob', { email_verified: true }).firestore();
  const unverified = environment.authenticatedContext('unverified', { email_verified: false }).firestore();
  const admin = environment.authenticatedContext('admin-a', { email_verified: true }).firestore();
  const owner = environment.authenticatedContext('hDbzbNTC7pOuU2UFCjFksopbgaG3', { email_verified: true }).firestore();
  const suffixOnly = environment.authenticatedContext('person-ending-FJ', {
    email: 'personfj@example.com', email_verified: true
  }).firestore();
  const suffixMixedCase = environment.authenticatedContext('mixed-case-fj', {
    email: 'personFJ@example.com', email_verified: true
  }).firestore();
  const unverifiedSuffix = environment.authenticatedContext('unverified-suffix', {
    email: 'personfj@example.com', email_verified: false
  }).firestore();
  const eligibleButRevoked = environment.authenticatedContext('revoked-ending-fj', {
    email: 'revokedfj@example.com', email_verified: true
  }).firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'applicationPermissions', 'alice'), { pipStatus: 'active', notesStatus: 'active', updatedAt: serverTimestamp() });
    await setDoc(doc(context.firestore(), 'applicationPermissions', 'revoked-ending-fj'), { pipStatus: 'revoked', notesStatus: 'revoked' });
  });
  const notePath = (db, uid, id) => doc(db, 'yourNotes', uid, 'notes', id);
  const note = { title: 'Private', content: 'Alice only', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

  await check('User can check own missing access-request document for safe account repair', getDoc(doc(alice, 'accessRequests', 'alice')), assertSucceeds);
  await check('User cannot inspect another UID access-request path', getDoc(doc(alice, 'accessRequests', 'bob')), assertFails);
  await check('Owner UID has its trusted Notes permission without a mirror record', setDoc(notePath(owner, 'hDbzbNTC7pOuU2UFCjFksopbgaG3', 'owner-no-mirror'), note), assertSucceeds);
  await check('Verified fj-suffix account receives automatic application access', setDoc(notePath(suffixOnly, 'person-ending-FJ', 'suffix-only'), note), assertSucceeds);
  await check('Automatic approval suffix matching is case-insensitive', setDoc(notePath(suffixMixedCase, 'mixed-case-fj', 'mixed-case'), note), assertSucceeds);
  await check('Unverified fj-suffix account does not receive automatic application access', setDoc(notePath(unverifiedSuffix, 'unverified-suffix', 'unverified'), note), assertFails);
  await check('Explicit revocation denies an account even when its email ends in fj', setDoc(notePath(eligibleButRevoked, 'revoked-ending-fj', 'revoked'), note), assertFails);
  await check('Verified account creates its own note', setDoc(notePath(alice, 'alice', 'one'), note), assertSucceeds);
  await check('Verified account reads its own note', getDoc(notePath(alice, 'alice', 'one')), assertSucceeds);
  await check('Other account cannot read the note by guessed ID', getDoc(notePath(bob, 'alice', 'one')), assertFails);
  await check("Other account cannot list the owner's notes", getDocs(collection(bob, 'yourNotes', 'alice', 'notes')), assertFails);
  await check("Other account cannot create under the owner's UID", setDoc(notePath(bob, 'alice', 'forged'), note), assertFails);
  await check('Unverified email cannot read its own notes', getDoc(notePath(unverified, 'unverified', 'one')), assertFails);
  const encryptedNote = {
    title: 'Protected note', content: '',
    protection: { version: 1, saltHex: 'a'.repeat(32), ivHex: 'b'.repeat(24), ciphertextHex: 'c0'.repeat(16) },
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await check('A note with an encrypted payload can be stored without plaintext', setDoc(notePath(alice, 'alice', 'protected'), encryptedNote), assertSucceeds);
  await check('A protected note cannot put its plaintext title or body into Firestore', setDoc(notePath(alice, 'alice', 'leaking'), {
    ...encryptedNote, title: 'Sensitive title', content: 'Sensitive body', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }), assertFails);
  await check('A protected note cannot store a truncated encrypted payload', setDoc(notePath(alice, 'alice', 'short-ciphertext'), {
    ...encryptedNote, protection: { ...encryptedNote.protection, ciphertextHex: 'c0ffee' }, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }), assertFails);
  await check('Anonymous access is denied', getDoc(notePath(anonymous, 'alice', 'one')), assertFails);
  await check('Role injection into note fields is denied', setDoc(notePath(alice, 'alice', 'role'), { ...note, role: 'owner' }), assertFails);
  await check('A user cannot update an existing note with a forged owner path', updateDoc(notePath(bob, 'alice', 'one'), { content: 'stolen' }), assertFails);

  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'admins', 'admin-a'), { uid: 'admin-a', active: true });
    await setDoc(doc(context.firestore(), 'privateNotes', 'owner-secret'), { title: 'Owner private' });
    await setDoc(doc(context.firestore(), 'activeNotesSessions', 'hDbzbNTC7pOuU2UFCjFksopbgaG3'), {
      uid: 'hDbzbNTC7pOuU2UFCjFksopbgaG3', revoked: false, expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
    });
  });
  await check("Active admin cannot read owner's private Notes", getDoc(doc(admin, 'privateNotes', 'owner-secret')), assertFails);
  await check("Ordinary user cannot read owner's private Notes", getDoc(doc(alice, 'privateNotes', 'owner-secret')), assertFails);
  await check("Owner with a trusted active session can read private Notes", getDoc(doc(owner, 'privateNotes', 'owner-secret')), assertSucceeds);
  await environment.withSecurityRulesDisabled(async context => {
    await deleteDoc(doc(context.firestore(), 'activeNotesSessions', 'hDbzbNTC7pOuU2UFCjFksopbgaG3'));
  });
  await check('Owner without an issued session cannot read private Notes', getDoc(doc(environment.authenticatedContext('hDbzbNTC7pOuU2UFCjFksopbgaG3').firestore(), 'privateNotes', 'missing')), assertFails);
  await check('Owner cannot forge a trusted session from browser', setDoc(doc(owner, 'activeNotesSessions', 'hDbzbNTC7pOuU2UFCjFksopbgaG3'), {
    uid: 'hDbzbNTC7pOuU2UFCjFksopbgaG3', revoked: false, expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
  }), assertFails);
  await check('Owner can edit own Your Notes while retaining createdAt', (async () => {
    const ref = notePath(alice, 'alice', 'one');
    const existing = (await getDoc(ref)).data();
    return updateDoc(ref, { title: 'Edited', content: 'Updated', createdAt: existing.createdAt, updatedAt: serverTimestamp() });
  })(), assertSucceeds);
  const accountPath = doc(alice, 'yourNotes', 'alice');
  const scheduledAccount = () => ({
    deletionStatus: 'scheduled',
    deletionRequestedAt: serverTimestamp(),
    deletionAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });
  await check('Verified user schedules deletion with a 30-day grace period', setDoc(accountPath, scheduledAccount()), assertSucceeds);
  await check('Notes are locked during the deletion grace period', getDoc(notePath(alice, 'alice', 'one')), assertFails);
  await check('User can cancel deletion before its deadline', updateDoc(accountPath, {
    deletionStatus: 'active', deletionCancelledAt: serverTimestamp()
  }), assertSucceeds);
  await check('Notes access returns after deletion is cancelled', getDoc(notePath(alice, 'alice', 'one')), assertSucceeds);
  await check('User can schedule deletion again after cancelling', setDoc(accountPath, scheduledAccount()), assertSucceeds);
  await check('User cannot mark deletion ready before the grace deadline', updateDoc(accountPath, {
    deletionStatus: 'ready', deletionReadyAt: serverTimestamp()
  }), assertFails);
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'yourNotes', 'alice'), {
      deletionAt: Timestamp.fromMillis(Date.now() - 1000)
    });
  });
  await check('User can mark deletion ready after the grace deadline', updateDoc(accountPath, {
    deletionStatus: 'ready', deletionReadyAt: serverTimestamp()
  }), assertSucceeds);
  await check('User can read own lifecycle status for the final confirmation step', getDoc(accountPath), assertSucceeds);
  await check('User can access notes for final deletion after the grace deadline', getDoc(notePath(alice, 'alice', 'one')), assertSucceeds);
  await check('User can remove own note after the grace deadline', deleteDoc(notePath(alice, 'alice', 'one')), assertSucceeds);
  await check('User can remove the lifecycle record after deletion becomes due', deleteDoc(accountPath), assertSucceeds);
  await check('Admin cannot create owner authorization records', setDoc(doc(admin, 'admins', 'admin-b'), { active: true }), assertFails);

  console.log(`FIRESTORE EMULATOR: ${passed}/37 passed`);
  assert.equal(passed, 37);
} finally {
  await environment.cleanup();
}
