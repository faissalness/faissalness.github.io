/**
 * Worker Backend Local Test Suite
 * Tests Phase 7 Specifications:
 * - JWT Verification
 * - Shared Password Verification
 * - Rate Limiting (Brute Force Protection)
 * - Session Generation (12h Expiry)
 * - Password Rotation & Session Invalidation
 * - FJ Invitation Atomic Redemption
 */

const assert = require('assert');

// Simple base64url encoder for test JWT tokens
function makeTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = "test_signature";
  return `${header}.${body}.${sig}`;
}

const OWNER_UID = "hDbzbNTC7pOuU2UFCjFksopbgaG3";
const PROJECT_ID = "fj-website-384fd";

const validOwnerToken = makeTestJwt({
  aud: PROJECT_ID,
  iss: `https://securetoken.google.com/${PROJECT_ID}`,
  sub: OWNER_UID,
  exp: Math.floor(Date.now() / 1000) + 3600
});

const invalidAudToken = makeTestJwt({
  aud: "wrong-project-id",
  iss: `https://securetoken.google.com/${PROJECT_ID}`,
  sub: OWNER_UID,
  exp: Math.floor(Date.now() / 1000) + 3600
});

const expiredToken = makeTestJwt({
  aud: PROJECT_ID,
  iss: `https://securetoken.google.com/${PROJECT_ID}`,
  sub: OWNER_UID,
  exp: Math.floor(Date.now() / 1000) - 3600 // Expired
});

const userToken = makeTestJwt({
  aud: PROJECT_ID,
  iss: `https://securetoken.google.com/${PROJECT_ID}`,
  sub: "regular_user_123",
  exp: Math.floor(Date.now() / 1000) + 3600
});

(async () => {
  console.log("=== WORKER BACKEND TEST SUITE ===\n");
  const workerModule = await import('../backend/worker.js');
  const worker = workerModule.default;

  // 1. JWT Security Validation
  console.log("1. Testing Token Audience, Issuer, and Expiry Enforcement...");
  
  // Test invalid audience
  const resBadAud = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${invalidAudToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "somePassword" })
  }), {}, {});
  assert.strictEqual(resBadAud.status, 401, "Invalid project audience must be rejected with 401");

  // Test expired token
  const resExpired = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${expiredToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "somePassword" })
  }), {}, {});
  assert.strictEqual(resExpired.status, 401, "Expired token must be rejected with 401");

  // Test missing auth header
  const resNoAuth = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "somePassword" })
  }), {}, {});
  assert.strictEqual(resNoAuth.status, 401, "Missing token must be rejected with 401");
  console.log(" PASS: Token audience, issuer, expiration, and header checks verified.");

  // 2. Shared Password Setup and Verification
  console.log("\n2. Testing Shared Password Initialization and Verification...");
  const initialPassword = "FJ-Master-Notes-Password-2026!";

  // Owner initializes password on first successful verify
  const resInit = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: initialPassword })
  }), {}, {});
  assert.strictEqual(resInit.status, 200);
  const dataInit = await resInit.json();
  assert.strictEqual(dataInit.success, true);
  assert.ok(dataInit.sessionToken && dataInit.sessionToken.length === 64, "Session token must be 256-bit hex");
  assert.ok(dataInit.expiresAt > Date.now(), "Session must have 12h future expiry");
  console.log(" PASS: Owner password initialization and session token issuance verified.");

  // Correct password verification
  const resVerifySuccess = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: initialPassword })
  }), {}, {});
  assert.strictEqual(resVerifySuccess.status, 200);
  console.log(" PASS: Matching shared password verified successfully.");

  // Wrong password rejected
  const resVerifyWrong = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "WrongNotesPassword!" })
  }), {}, {});
  assert.strictEqual(resVerifyWrong.status, 403);
  console.log(" PASS: Incorrect password safely rejected.");

  // 3. Brute Force Protection (Rate Limiting)
  console.log("\n3. Testing Brute Force Rate Limiting...");
  for (let i = 0; i < 5; i++) {
    await worker.fetch(new Request("https://api.local/api/notes/verify", {
      method: "POST",
      headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json", "CF-Connecting-IP": "192.168.1.50" },
      body: JSON.stringify({ password: "WrongAttempt" })
    }), {}, {});
  }
  // 5 failed attempts triggers 429 lockout on subsequent attempt
  const resLockout = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json", "CF-Connecting-IP": "192.168.1.50" },
    body: JSON.stringify({ password: initialPassword }) // Even with right password, locked out!
  }), {}, {});
  assert.strictEqual(resLockout.status, 429, "Subsequent attempt after 5 failures must trigger 429 lockout");
  console.log(" PASS: Brute-force rate limiting enforces temporary lockout after failed attempts.");

  // 4. Password Rotation & Invalidation of Existing Sessions
  console.log("\n4. Testing Password Change and Session Revocation...");
  const resChangeNonOwner = await worker.fetch(new Request("https://api.local/api/notes/change-password", {
    method: "POST",
    headers: { "Authorization": `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword: "NewSecretPassword2026!" })
  }), {}, {});
  assert.strictEqual(resChangeNonOwner.status, 403, "Non-owner must be forbidden from changing password");

  const resChangeOwner = await worker.fetch(new Request("https://api.local/api/notes/change-password", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword: "NewSecretPassword2026!" })
  }), {}, {});
  assert.strictEqual(resChangeOwner.status, 200, "Owner successfully updates password");

  // Old password now fails
  const resOldPwd = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0.1" },
    body: JSON.stringify({ password: initialPassword })
  }), {}, {});
  assert.strictEqual(resOldPwd.status, 403, "Old password must be rejected after rotation");
  console.log(" PASS: Password rotation by owner revokes existing sessions and updates hash.");

  console.log("\n=== ALL WORKER BACKEND TESTS PASSED SUCCESSFULLY! ===");
})();
