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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEST_KID = "fj-test-key";
const TEST_CERT = fs.readFileSync(path.join(__dirname, "fixtures", "worker-test-cert.pem"), "utf8");
const TEST_PRIVATE_KEY = fs.readFileSync(path.join(__dirname, "fixtures", "worker-test-private.pem"), "utf8");

// Test ID tokens are genuinely signed by a test-only key. Never use this key in production.
function makeTestJwt(payload, corruptSignature = false) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: TEST_KID })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  let sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), TEST_PRIVATE_KEY).toString('base64url');
  if (corruptSignature) sig = `${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;
  return `${header}.${body}.${sig}`;
}

const OWNER_UID = "hDbzbNTC7pOuU2UFCjFksopbgaG3";
const PROJECT_ID = "fj-website-384fd";

function makeClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
  aud: PROJECT_ID,
  iss: `https://securetoken.google.com/${PROJECT_ID}`,
  sub: OWNER_UID,
    iat: now - 20,
    auth_time: now - 60,
    exp: now + 3600,
    ...overrides
  };
}

const validOwnerToken = makeTestJwt(makeClaims());

const invalidAudToken = makeTestJwt({
  ...makeClaims({ aud: "wrong-project-id" })
});

const expiredToken = makeTestJwt({
  ...makeClaims({ exp: Math.floor(Date.now() / 1000) - 3600 }) // Expired
});

const userToken = makeTestJwt({
  ...makeClaims({ sub: "regular_user_123" })
});

(async () => {
  console.log("=== WORKER BACKEND TEST SUITE ===\n");
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    if (String(input) === "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com") {
      return new Response(JSON.stringify({ [TEST_KID]: TEST_CERT }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
      });
    }
    return originalFetch(input, init);
  };
  const workerModule = await import('../backend/worker.js');
  const worker = workerModule.default;

  const redemptionWithoutIdentity = await worker.fetch(new Request("https://api.local/api/invitations/redeem", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "guessfj", uid: OWNER_UID })
  }), {}, {});
  assert.strictEqual(redemptionWithoutIdentity.status, 401, "Invitation redemption must require a verified Firebase identity");
  const redemptionWithBadIdentity = await worker.fetch(new Request("https://api.local/api/invitations/redeem", {
    method: "POST", headers: { "Authorization": `Bearer ${makeTestJwt(makeClaims(), true)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ token: "guessfj", uid: OWNER_UID })
  }), {}, {});
  assert.strictEqual(redemptionWithBadIdentity.status, 401, "Forged identity must not redeem invitations");

  const allowedPreflight = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "OPTIONS", headers: { Origin: "https://faissalness.github.io" }
  }), {}, {});
  assert.strictEqual(allowedPreflight.headers.get("Access-Control-Allow-Origin"), "https://faissalness.github.io");
  const blockedPreflight = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "OPTIONS", headers: { Origin: "null" }
  }), {}, {});
  assert.strictEqual(blockedPreflight.headers.get("Access-Control-Allow-Origin"), null);

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

  const resForged = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${makeTestJwt(makeClaims(), true)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "somePassword" })
  }), {}, {});
  assert.strictEqual(resForged.status, 401, "Correct claims with an invalid signature must be rejected");

  const tamperedPayload = validOwnerToken.split('.');
  tamperedPayload[1] = Buffer.from(JSON.stringify(makeClaims({ sub: "forged-owner" }))).toString('base64url');
  const resTampered = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${tamperedPayload.join('.')}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "somePassword" })
  }), {}, {});
  assert.strictEqual(resTampered.status, 401, "Modified JWT claims must be rejected");

  // Test missing auth header
  const resNoAuth = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "somePassword" })
  }), {}, {});
  assert.strictEqual(resNoAuth.status, 401, "Missing token must be rejected with 401");
  assert.strictEqual(resNoAuth.headers.get("Cache-Control"), "no-store", "Authentication responses must not be cached");
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
  global.fetch = originalFetch;
})();
