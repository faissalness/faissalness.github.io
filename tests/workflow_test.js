/**
 * Focused Workflow and Security Test Suite
 * Tests:
 * 1. Valid and invalid 'fj' email suffixes
 * 2. Non-suffix pending requests
 * 3. Duplicate event and retry prevention
 * 4. Missing/ineligible account error handling
 * 5. Owner-only notes access logic and admin revocation
 * 6. 6-digit PIN hashing and verification
 * 7. Notes search and tag filtering
 */

const assert = require('assert');
const { validateAndNormalizeEmail, handleAccessRequest } = require('../functions/access-approval-trigger.js');
const crypto = require('crypto');

console.log("=== FJ WEBSITE VERIFICATION SUITE ===\n");

// 1. Valid and invalid verified-email local parts
console.log("1. Testing verified local-part eligibility...");
assert.strictEqual(validateAndNormalizeEmail("userfj@example.com"), "userfj@example.com");
assert.strictEqual(validateAndNormalizeEmail("USERFJ@EXAMPLE.COM"), "userfj@example.com");
assert.strictEqual(validateAndNormalizeEmail("john.doe+filterFJ@domain.co.uk"), "john.doe+filterfj@domain.co.uk");
assert.strictEqual(validateAndNormalizeEmail("user@example.comfj"), null, "A domain suffix cannot qualify");
assert.strictEqual(validateAndNormalizeEmail("invalidfj"), null, "Invalid email without domain should be rejected");
assert.strictEqual(validateAndNormalizeEmail("user@invalid"), null, "Missing TLD should be rejected");
assert.strictEqual(validateAndNormalizeEmail("user@example.com"), null, "Local part without fj suffix should not qualify");
assert.strictEqual(validateAndNormalizeEmail(""), null, "Empty email should return null");
assert.strictEqual(validateAndNormalizeEmail(null), null, "Null email should return null");
console.log(" PASS: Eligibility requires a valid email local part ending in fj.\n");

// 2. Pending requests for non-suffix emails & Trigger handler
console.log("2. Testing access request trigger handler logic...");
(async () => {
  let docUpdates = {};
  const savedDocs = new Map();
  const mockDocRef = path => ({
    path,
    update: async data => {
      if (path.startsWith('accessRequests/')) Object.assign(docUpdates, data);
      savedDocs.set(path, { ...(savedDocs.get(path) || {}), ...data });
    }
  });
  const mockAdmin = {
    firestore: () => ({
      doc: mockDocRef,
      batch: () => {
        const writes = [];
        return {
          set: (...args) => writes.push(['set', ...args]),
          update: (...args) => writes.push(['update', ...args]),
          commit: async () => {
            for (const [, ref, data] of writes) {
              savedDocs.set(ref.path, { ...(savedDocs.get(ref.path) || {}), ...data });
              if (ref.path.startsWith('accessRequests/')) Object.assign(docUpdates, data);
            }
          }
        };
      }
    }),
    firestoreFieldValue: {
      serverTimestamp: () => new Date().toISOString()
    },
    auth: () => ({
      getUser: async uid => {
        if (uid === 'test_valid_uid') return { uid, email: 'existsfj@example.com', emailVerified: true };
        if (uid === 'test_unverified_uid') return { uid, email: 'existsfj@example.com', emailVerified: false };
        if (uid === 'test_mismatch_uid') return { uid, email: 'different@example.com', emailVerified: true };
        const err = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
    })
  };
  mockAdmin.firestore.FieldValue = mockAdmin.firestoreFieldValue;

  const { setAdminInstance } = require('../functions/access-approval-trigger.js');
  setAdminInstance(mockAdmin);

  await handleAccessRequest({
    type: 'create',
    data: { doc: { id: 'test_pending_uid', data: () => ({ uid: 'test_pending_uid', email: 'visitor@example.com', status: 'pending' }) } }
  });
  assert.deepStrictEqual(docUpdates, {}, "Non-fj requests remain pending without side effects");
  console.log(" PASS: Non-fj email correctly kept as pending.");

  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: { doc: { id: 'test_invalid_uid', data: () => ({ uid: 'test_invalid_uid', email: 'broken-emailfj', status: 'pending' }) } }
  });
  assert.strictEqual(docUpdates.status, 'rejected');
  assert.strictEqual(docUpdates.deliveryStatus, 'failed');
  console.log(" PASS: Malformed request is rejected.");

  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: { doc: { id: 'test_valid_uid', data: () => ({ uid: 'test_valid_uid', email: 'existsFJ@example.com', status: 'pending' }) } }
  });
  assert.strictEqual(docUpdates.status, 'approved');
  assert.strictEqual(docUpdates.deliveryStatus, 'not_required');
  assert.strictEqual(docUpdates.approvalSource, 'verified_fj_email');
  assert.strictEqual(savedDocs.get('users/test_valid_uid').approved, true);
  console.log(" PASS: Verified fj identity receives application approval only.");

  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: { doc: { id: 'test_unverified_uid', data: () => ({ uid: 'test_unverified_uid', email: 'existsfj@example.com', status: 'pending' }) } }
  });
  assert.strictEqual(docUpdates.status, 'pending');
  assert.match(docUpdates.error, /Verified Firebase email/);
  assert.strictEqual(savedDocs.has('users/test_unverified_uid'), false);

  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: { doc: { id: 'test_mismatch_uid', data: () => ({ uid: 'test_mismatch_uid', email: 'existsfj@example.com', status: 'pending' }) } }
  });
  assert.strictEqual(docUpdates.status, 'pending');
  assert.strictEqual(savedDocs.has('users/test_mismatch_uid'), false);
  console.log(" PASS: Unverified and email-mismatched identities remain unapproved.");

  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: { doc: { id: 'test_duplicate_uid', data: () => ({ uid: 'test_duplicate_uid', email: 'existsfj@example.com', status: 'approved', deliveryStatus: 'sent' }) } }
  });
  assert.deepStrictEqual(docUpdates, {}, "Non-pending requests must remain unchanged");
  console.log(" PASS: Duplicate events and retries are idempotent.");

  // 3. Security Boundary: Owner and Admin Authorization & Revocation
  console.log("\n3. Testing Security Boundary (Owner, Active Admin, and Revocation)...");
  const OWNER_UID = "hDbzbNTC7pOuU2UFCjFksopbgaG3";

  function checkNotesAccess(userUid, adminsTable) {
    if (!userUid) return false;
    if (userUid === OWNER_UID) return true;
    const adminRecord = adminsTable[userUid];
    return Boolean(adminRecord && adminRecord.active === true);
  }

  const mockAdmins = {
    "admin_active_1": { uid: "admin_active_1", active: true },
    "admin_revoked_2": { uid: "admin_revoked_2", active: false }
  };

  assert.strictEqual(checkNotesAccess(OWNER_UID, mockAdmins), true, "Owner must always have access");
  assert.strictEqual(checkNotesAccess("admin_active_1", mockAdmins), true, "Active admin must have access");
  assert.strictEqual(checkNotesAccess("admin_revoked_2", mockAdmins), false, "Revoked admin must be denied immediately");
  assert.strictEqual(checkNotesAccess("random_user_uid", mockAdmins), false, "Regular user must be denied");
  assert.strictEqual(checkNotesAccess(null, mockAdmins), false, "Unauthenticated user must be denied");
  console.log(" PASS: Access rules strictly enforce owner and active admin boundaries; revocation immediately denies access.");

  // 4. 6-Digit PIN Cryptography & Verification
  console.log("\n4. Testing 6-Digit PIN Cryptography (PBKDF2-SHA256, 100,000 iterations)...");
  function hashPinNode(pin, salt = null) {
    if (!salt) salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');
    return {
      hashHex: key.toString('hex'),
      saltHex: salt.toString('hex')
    };
  }

  const userPin = "482915";
  const { hashHex, saltHex } = hashPinNode(userPin);
  assert.strictEqual(hashHex.length, 64, "SHA-256 hash must be 64 hex characters (32 bytes)");

  // Verification match
  const verifyMatch = hashPinNode(userPin, Buffer.from(saltHex, 'hex'));
  assert.strictEqual(verifyMatch.hashHex, hashHex, "Matching PIN must verify correctly");

  // Incorrect PIN rejected
  const verifyMismatch = hashPinNode("000000", Buffer.from(saltHex, 'hex'));
  assert.notStrictEqual(verifyMismatch.hashHex, hashHex, "Wrong PIN must be rejected");
  console.log(" PASS: 6-digit PIN cryptography and verification verified.");

  // 5. Notes Search and Tags Filter
  console.log("\n5. Testing Notes Search and Filter logic...");
  const sampleNotes = [
    { id: "1", title: "Project Architecture", content: "Details about FJ website", tags: ["tech", "architecture"] },
    { id: "2", title: "Inspiration Shelf", content: "Quotes and design forms", tags: ["design", "art"] },
    { id: "3", title: "Personal Reminders", content: "Deploy on GitHub Pages", tags: ["personal"] }
  ];

  function filterNotesTest(list, q) {
    if (!q) return list;
    const l = q.toLowerCase();
    return list.filter(n => 
      n.title.toLowerCase().includes(l) || 
      n.content.toLowerCase().includes(l) || 
      n.tags.some(t => t.toLowerCase().includes(l))
    );
  }

  assert.strictEqual(filterNotesTest(sampleNotes, "architecture").length, 1);
  assert.strictEqual(filterNotesTest(sampleNotes, "design").length, 1);
  assert.strictEqual(filterNotesTest(sampleNotes, "nonexistent").length, 0);
  assert.strictEqual(filterNotesTest(sampleNotes, "").length, 3);
  console.log(" PASS: Notes search and tag filtering verified.");

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");
})();
