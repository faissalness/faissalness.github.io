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
  const mockDocRef = {
    update: async (data) => {
      Object.assign(docUpdates, data);
    }
  };

  const mockAdmin = {
    firestore: () => ({
      doc: () => mockDocRef
    }),
    firestoreFieldValue: {
      serverTimestamp: () => new Date().toISOString()
    },
    auth: () => ({
      getUserByEmail: async (email) => {
        if (email === "federated@example.com") {
          return {
            uid: "fed_uid",
            email,
            providerData: [{ providerId: "google.com" }] // Federated only, no password provider!
          };
        }
        if (email === "standard@example.com") {
          return {
            uid: "standard_uid",
            email,
            providerData: [{ providerId: "password" }]
          };
        }
        if (email === "ambiguous@example.com") {
          return {
            uid: "ambig_uid",
            email,
            providerData: [{ providerId: "password" }]
          };
        }
        const err = new Error("User not found");
        err.code = "auth/user-not-found";
        throw err;
      },
      generatePasswordResetLink: async (email) => {
        if (email === "ambiguous@example.com") {
          const timeoutErr = new Error("Network timeout contacting identity toolkit");
          timeoutErr.code = "auth/network-timeout";
          throw timeoutErr;
        }
        return `https://auth.example.com/reset?email=${encodeURIComponent(email)}`;
      }
    })
  };
  mockAdmin.firestore.FieldValue = mockAdmin.firestoreFieldValue;
  setAdminInstance(mockAdmin);

  // Test Case A: Federated-only account
  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_fed',
        data: () => ({ email: 'federated@example.comfj', status: 'pending' })
      }
    }
  });
  assert.strictEqual(docUpdates.status, 'ACTION_REQUIRED', "Federated-only account must receive ACTION_REQUIRED");
  assert.strictEqual(docUpdates.deliveryStatus, 'skipped');
  console.log(" PASS: Federated-only accounts receive ACTION_REQUIRED instead of false success.");

  // Test Case B: Ambiguous delivery
  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_ambig',
        data: () => ({ email: 'ambiguous@example.comfj', status: 'pending' })
      }
    }
  });
  assert.strictEqual(docUpdates.deliveryStatus, 'DELIVERY_UNKNOWN', "Temporary network failure must record DELIVERY_UNKNOWN");
  console.log(" PASS: Ambiguous temporary failures safely recorded as DELIVERY_UNKNOWN without blind resend.");

  // Test Case C: Standard account with idempotency key
  docUpdates = {};
  await handleAccessRequest({
    type: 'create',
    data: {
      doc: {
        id: 'req_std',
        data: () => ({ email: 'standard@example.comfj', status: 'pending', approvalVersion: 1 })
      }
    }
  });
  assert.strictEqual(docUpdates.status, 'approved');
  assert.strictEqual(docUpdates.deliveryStatus, 'sent');
  assert.strictEqual(docUpdates.firebaseAccepted, true);
  assert.strictEqual(docUpdates.idempotencyKey, 'req_std_v1_pwd_reset');
  console.log(" PASS: Standard approval creates durable email job with unique idempotency key.");

  console.log("\n=== ALL INVITATIONS & APPROVAL TESTS PASSED SUCCESSFULLY! ===");
})();
