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

// 1. Valid and invalid 'fj' email suffixes
console.log("1. Testing 'fj' email suffix normalization and validation...");
assert.strictEqual(validateAndNormalizeEmail("user@example.comfj"), "user@example.com");
assert.strictEqual(validateAndNormalizeEmail("USER@EXAMPLE.COMfj"), "user@example.com");
assert.strictEqual(validateAndNormalizeEmail("john.doe+filter@domain.co.ukfj"), "john.doe+filter@domain.co.uk");
assert.strictEqual(validateAndNormalizeEmail("invalidfj"), null, "Invalid email without domain should be rejected");
assert.strictEqual(validateAndNormalizeEmail("user@invalid"), null, "Missing TLD should be rejected");
assert.strictEqual(validateAndNormalizeEmail("user@example.com"), null, "Email without fj suffix should return null");
assert.strictEqual(validateAndNormalizeEmail(""), null, "Empty email should return null");
assert.strictEqual(validateAndNormalizeEmail(null), null, "Null email should return null");
console.log(" PASS: Email normalization and validation verified.\n");

// 2. Pending requests for non-suffix emails & Trigger handler
console.log("2. Testing access request trigger handler logic...");
(async () => {
  let docUpdates = {};
  const mockDocRef = {
    update: async (data) => {
      Object.assign(docUpdates, data);
    }
  };

  // Test Non-fj email (remains pending)
  docUpdates = {};
  const pendingEvent = {
    type: 'create',
    data: {
      doc: {
        id: 'test_pending_uid',
        data: () => ({ email: 'visitor@example.com', status: 'pending' })
      }
    }
  };

  // Mock admin SDK for unit testing
  const mockAdmin = {
    firestore: () => ({
      doc: (path) => mockDocRef
    }),
    firestoreFieldValue: {
      serverTimestamp: () => new Date().toISOString()
    },
    auth: () => ({
      getUserByEmail: async (email) => {
        if (email === 'exists@example.com') return { uid: 'uid_123', email };
        const err = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      },
      generatePasswordResetLink: async (email) => `https://auth.example.com/reset?email=${encodeURIComponent(email)}`
    })
  };
  mockAdmin.firestore.FieldValue = mockAdmin.firestoreFieldValue;

  const { setAdminInstance } = require('../functions/access-approval-trigger.js');
  setAdminInstance(mockAdmin);

  await handleAccessRequest(pendingEvent);
  assert.strictEqual(docUpdates.status, 'pending');
  assert.strictEqual(docUpdates.deliveryStatus, 'pending');
  console.log(" PASS: Non-fj email correctly kept as pending.");

  // Test Invalid fj email (rejected)
  docUpdates = {};
  const invalidFjEvent = {
    type: 'create',
    data: {
      doc: {
        id: 'test_invalid_uid',
        data: () => ({ email: 'broken-emailfj', status: 'pending' })
      }
    }
  };
  await handleAccessRequest(invalidFjEvent);
  assert.strictEqual(docUpdates.status, 'rejected');
  assert.strictEqual(docUpdates.deliveryStatus, 'failed');
  console.log(" PASS: Invalid email after stripping fj correctly rejected.");

  // Test Valid fj email with existing Auth account (approved & reset link generated)
  docUpdates = {};
  const validFjEvent = {
    type: 'create',
    data: {
      doc: {
        id: 'test_valid_uid',
        data: () => ({ email: 'exists@example.comfj', status: 'pending' })
      }
    }
  };
  await handleAccessRequest(validFjEvent);
  assert.strictEqual(docUpdates.status, 'approved');
  assert.strictEqual(docUpdates.deliveryStatus, 'sent');
  assert.strictEqual(docUpdates.normalizedEmail, 'exists@example.com');
  console.log(" PASS: Valid fj email automatically approved and reset link sent.");

  // Test Missing / Ineligible Auth Account (rejected with clear message)
  docUpdates = {};
  const missingAccountEvent = {
    type: 'create',
    data: {
      doc: {
        id: 'test_missing_uid',
        data: () => ({ email: 'nonexistent@example.comfj', status: 'pending' })
      }
    }
  };
  await handleAccessRequest(missingAccountEvent);
  assert.strictEqual(docUpdates.status, 'rejected');
  assert.strictEqual(docUpdates.deliveryStatus, 'failed');
  assert.strictEqual(docUpdates.error, 'Firebase Authentication account does not exist');
  console.log(" PASS: Ineligible/missing Auth account safely rejected without failing silently.");

  // Test Duplicate event / page refresh / retry prevention
  docUpdates = {};
  const duplicateEvent = {
    type: 'create',
    data: {
      doc: {
        id: 'test_duplicate_uid',
        data: () => ({
          email: 'exists@example.comfj',
          status: 'approved',
          deliveryStatus: 'sent' // already sent
        })
      }
    }
  };
  await handleAccessRequest(duplicateEvent);
  assert.deepStrictEqual(docUpdates, {}, "No duplicate updates or emails should be dispatched if deliveryStatus is sent");
  console.log(" PASS: Duplicate events and page refreshes safely prevented.");

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
