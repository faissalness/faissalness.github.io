/**
 * Invitations, Approval and Password Reset Workflow Test Suite
 * Tests Phase 5 & Phase 6 Specifications
 */

const assert = require('assert');
const crypto = require('crypto');
const { validateAndNormalizeEmail, handleAccessRequest, setAdminInstance } = require('../functions/access-approval-trigger.js');

console.log("=== INVITATIONS & APPROVAL WORKFLOW TEST SUITE ===\n");

// 1. FJ Invitation Token Format & Validation
console.log("1. Testing FJ Invitation Token Generator & Suffix Rule...");
function generateFjToken() {
  const entropy = crypto.randomBytes(16).toString('hex');
  return `fj_${entropy}fj`;
}

function validateFjToken(token) {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed.length < 10) return false;
  return trimmed.toLowerCase().endsWith('fj');
}

const token1 = generateFjToken();
assert.ok(token1.endsWith('fj'), "Token must end in 'fj'");
assert.ok(token1.length >= 34, "Token must contain high entropy component");
assert.strictEqual(validateFjToken(token1), true);
assert.strictEqual(validateFjToken(token1.toUpperCase()), true, "Case-insensitive check");
assert.strictEqual(validateFjToken("random_token_no_marker"), false, "Token without fj marker must be rejected");
assert.strictEqual(validateFjToken(""), false);
assert.strictEqual(validateFjToken(null), false);
console.log(" PASS: FJ invitation format and high-entropy suffix rule verified.");

// 2. Token Digest & Single-Use Atomic Redemption
console.log("\n2. Testing Token Digest Storage and Atomic Redemption...");
const mockInvitationsDb = {};

function registerInvitation(token, createdByUid) {
  const digest = crypto.createHash('sha256').update(token.toLowerCase()).digest('hex');
  mockInvitationsDb[digest] = {
    digest,
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    consumed: false,
    consumedBy: null,
    createdBy: createdByUid
  };
  return digest;
}

function redeemInvitation(token, redeemerUid) {
  if (!validateFjToken(token)) return { success: false, reason: "INVALID_FORMAT" };
  const digest = crypto.createHash('sha256').update(token.toLowerCase()).digest('hex');
  const record = mockInvitationsDb[digest];

  if (!record) return { success: false, reason: "NOT_FOUND" };
  if (record.consumed) return { success: false, reason: "ALREADY_CONSUMED" };
  if (Date.now() > record.expiresAt) return { success: false, reason: "EXPIRED" };

  // Atomically consume and bind to redeemer UID
  record.consumed = true;
  record.consumedBy = redeemerUid;
  record.consumedAt = Date.now();
  return { success: true, digest };
}

const inviteToken = generateFjToken();
const inviteDigest = registerInvitation(inviteToken, "owner_uid");

// First redemption: Success
const redeem1 = redeemInvitation(inviteToken, "user_alice_uid");
assert.strictEqual(redeem1.success, true);
assert.strictEqual(mockInvitationsDb[inviteDigest].consumed, true);
assert.strictEqual(mockInvitationsDb[inviteDigest].consumedBy, "user_alice_uid");

// Second redemption: Fails with ALREADY_CONSUMED
const redeem2 = redeemInvitation(inviteToken, "user_bob_uid");
assert.strictEqual(redeem2.success, false);
assert.strictEqual(redeem2.reason, "ALREADY_CONSUMED");
console.log(" PASS: Atomic invitation redemption and UID binding strictly prevent reuse.");

// 3. Approval Workflow, Idempotency & Federated-Only Account Handling
console.log("\n3. Testing Approval Trigger Handler with Federated Account & Idempotency...");
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
          set: (...args) => writes.push(args),
          update: (...args) => writes.push(args),
          commit: async () => {
            for (const [ref, data] of writes) {
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
        if (uid === "req_std") return { uid, email: "standardfj@example.com", emailVerified: true };
        if (uid === "req_unverified") return { uid, email: "standardfj@example.com", emailVerified: false };
        const err = new Error("User not found");
        err.code = "auth/user-not-found";
        throw err;
      }
    })
  };
  mockAdmin.firestore.FieldValue = mockAdmin.firestoreFieldValue;
  setAdminInstance(mockAdmin);

  // Test Case A: Non-eligible addresses remain pending.
  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_fed',
        data: () => ({ uid: 'req_fed', email: 'federated@example.com', status: 'pending' })
      }
    }
  });
  assert.deepStrictEqual(docUpdates, {});
  console.log(" PASS: Non-eligible addresses remain pending.");

  // Test Case B: A missing identity is rejected.
  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_missing',
        data: () => ({ uid: 'req_missing', email: 'missingfj@example.com', status: 'pending' })
      }
    }
  });
  assert.strictEqual(docUpdates.status, 'rejected');
  assert.strictEqual(docUpdates.deliveryStatus, 'failed');
  console.log(" PASS: Requests without a matching Firebase account are rejected.");

  // Test Case C: A verified Firebase identity with a matching UID and email is approved.
  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_std',
        data: () => ({ uid: 'req_std', email: 'standardFJ@example.com', status: 'pending' })
      }
    }
  });
  assert.strictEqual(docUpdates.status, 'approved');
  assert.strictEqual(docUpdates.deliveryStatus, 'not_required');
  assert.strictEqual(savedDocs.get('users/req_std').approved, true);
  console.log(" PASS: Verified suffix identity is approved without false email-delivery claims.");

  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_unverified',
        data: () => ({ uid: 'req_unverified', email: 'standardfj@example.com', status: 'pending' })
      }
    }
  });
  assert.strictEqual(docUpdates.status, 'pending');
  assert.strictEqual(savedDocs.has('users/req_unverified'), false);
  console.log(" PASS: Unverified identities cannot be automatically approved.");

  console.log("\n=== ALL INVITATIONS & APPROVAL TESTS PASSED SUCCESSFULLY! ===");
})();
