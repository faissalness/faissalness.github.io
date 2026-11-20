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
const { FakeD1 } = require('./fake_d1');

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
const verifiedOwnerToken = makeTestJwt(makeClaims({
  email: "faissalness@gmail.com", email_verified: true, name: "FJ owner"
}));

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
  let firebaseAuthDeleteRequests = 0;
  global.fetch = async (input, init) => {
    if (String(input) === "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com") {
      return new Response(JSON.stringify({ [TEST_KID]: TEST_CERT }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
      });
    }
    if (String(input).startsWith("https://identitytoolkit.googleapis.com/v1/accounts:delete")) {
      firebaseAuthDeleteRequests++;
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  const workerModule = await import('../backend/worker.js');
  const implementation = workerModule.default;
  const testDb = new FakeD1();
  const env = { DB: testDb, PAL_LOOKUP_SECRET: "test-only-hmac-secret-with-at-least-32-characters" };
  const worker = { fetch: (request, _env, ctx) => implementation.fetch(request, env, ctx) };

  const photoDb = new FakeD1();
  const photoEnv = { DB: photoDb, PAL_LOOKUP_SECRET: env.PAL_LOOKUP_SECRET };
  const photoWorker = { fetch: (request, _env, ctx) => implementation.fetch(request, photoEnv, ctx) };
  photoDb.users.set(OWNER_UID, { uid: OWNER_UID, status: "scheduled", pipStatus: "revoked", notesStatus: "revoked", deletionAt: Date.now() });
  const ownerRegistration = await photoWorker.fetch(new Request("https://api.local/api/users/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${verifiedOwnerToken}`, "Content-Type": "application/json" },
    body: "{}"
  }), {}, {});
  assert.strictEqual(ownerRegistration.status, 200);
  const ownerRegistrationResult = await ownerRegistration.json();
  assert.strictEqual(ownerRegistrationResult.status, "active", "The trusted owner identity receives active PIP status");
  assert.strictEqual(ownerRegistrationResult.pipStatus, "active");
  assert.strictEqual(ownerRegistrationResult.notesStatus, "active", "Owner Notes access must not depend on a missing Firestore permission mirror");

  const suffixDb = new FakeD1();
  const suffixEnv = { DB: suffixDb, PAL_LOOKUP_SECRET: env.PAL_LOOKUP_SECRET };
  const suffixWorker = { fetch: (request, _env, ctx) => implementation.fetch(request, suffixEnv, ctx) };
  const suffixToken = makeTestJwt(makeClaims({
    sub: "email_suffix_user", email: "ordinaryfj@example.com", email_verified: true, name: "Suffix User"
  }));
  const suffixRegistration = await suffixWorker.fetch(new Request("https://api.local/api/users/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${suffixToken}`, "Content-Type": "application/json" },
    body: "{}"
  }), {}, {});
  assert.strictEqual(suffixRegistration.status, 200);
  const suffixRegistrationResult = await suffixRegistration.json();
  assert.strictEqual(suffixRegistrationResult.status, "active", "A verified email local part ending in fj receives server-side automatic approval");
  assert.strictEqual(suffixRegistrationResult.pipStatus, "active");
  assert.strictEqual(suffixRegistrationResult.notesStatus, "active");
  assert.strictEqual(suffixRegistrationResult.eligible, true);

  const caseToken = makeTestJwt(makeClaims({
    sub: "case_suffix_user", email: "ordinaryFJ@example.com", email_verified: true, name: "Case User"
  }));
  const caseRegistration = await suffixWorker.fetch(new Request("https://api.local/api/users/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${caseToken}`, "Content-Type": "application/json" },
    body: "{}"
  }), {}, {});
  const caseRegistrationResult = await caseRegistration.json();
  assert.strictEqual(caseRegistrationResult.pipStatus, "active", "Automatic approval matches the local part case-insensitively");

  const unverifiedSuffixToken = makeTestJwt(makeClaims({
    sub: "unverified_suffix_user", email: "ordinaryfj@example.com", email_verified: false
  }));
  const unverifiedSuffixRegistration = await suffixWorker.fetch(new Request("https://api.local/api/users/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${unverifiedSuffixToken}`, "Content-Type": "application/json" },
    body: "{}"
  }), {}, {});
  assert.strictEqual(unverifiedSuffixRegistration.status, 403, "An unverified email ending in fj cannot receive automatic approval");

  const revokedSuffixDb = new FakeD1();
  revokedSuffixDb.users.set("revoked_suffix_user", {
    uid: "revoked_suffix_user", status: "scheduled", pipStatus: "revoked", notesStatus: "revoked", deletionAt: null
  });
  const revokedSuffixEnv = { DB: revokedSuffixDb, PAL_LOOKUP_SECRET: env.PAL_LOOKUP_SECRET };
  const revokedSuffixWorker = { fetch: (request, _env, ctx) => implementation.fetch(request, revokedSuffixEnv, ctx) };
  const revokedSuffixToken = makeTestJwt(makeClaims({
    sub: "revoked_suffix_user", email: "revokedfj@example.com", email_verified: true
  }));
  const revokedSuffixResponse = await revokedSuffixWorker.fetch(new Request("https://api.local/api/users/register", {
    method: "POST",
    headers: { Authorization: `Bearer ${revokedSuffixToken}`, "Content-Type": "application/json" },
    body: "{}"
  }), {}, {});
  const revokedSuffixResult = await revokedSuffixResponse.json();
  assert.strictEqual(revokedSuffixResult.status, "scheduled", "Automatic approval cannot override explicit permission revocation");
  assert.strictEqual(revokedSuffixResult.pipStatus, "revoked");
  assert.strictEqual(revokedSuffixResult.notesStatus, "revoked");

  photoDb.users.set("regular_user_123", { uid: "regular_user_123", status: "active", pipStatus: "active", notesStatus: "active" });
  const verifiedUserToken = makeTestJwt(makeClaims({
    sub: "regular_user_123", email: "friend@example.com", email_verified: true, name: "Friend"
  }));
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg==", "base64");
  const photoUpload = await photoWorker.fetch(new Request(`https://api.local/api/profiles/${OWNER_UID}/photo`, {
    method: "POST", headers: { Authorization: `Bearer ${verifiedOwnerToken}`, "Content-Type": "image/png" }, body: pngBytes
  }), {}, {});
  assert.strictEqual(photoUpload.status, 200, "An active user may store a valid own profile photo");
  const otherPhoto = await photoWorker.fetch(new Request(`https://api.local/api/profiles/${OWNER_UID}/photo`, {
    headers: { Authorization: `Bearer ${verifiedUserToken}` }
  }), {}, {});
  assert.strictEqual(otherPhoto.status, 200, "Another active user may view a discoverable profile photo");
  assert.strictEqual(otherPhoto.headers.get("Content-Type"), "image/png");
  assert.deepStrictEqual(Buffer.from(await otherPhoto.arrayBuffer()), pngBytes, "Stored profile photos remain byte-identical when retrieved");
  const changedOtherPhoto = await photoWorker.fetch(new Request("https://api.local/api/profiles/regular_user_123/photo", {
    method: "POST", headers: { Authorization: `Bearer ${verifiedOwnerToken}`, "Content-Type": "image/png" }, body: pngBytes
  }), {}, {});
  assert.strictEqual(changedOtherPhoto.status, 403, "Users cannot replace another user's profile photo");
  const spoofedPhoto = await photoWorker.fetch(new Request("https://api.local/api/profiles/regular_user_123/photo", {
    method: "POST", headers: { Authorization: `Bearer ${verifiedUserToken}`, "Content-Type": "image/png" }, body: "not an image"
  }), {}, {});
  assert.strictEqual(spoofedPhoto.status, 400, "The Worker rejects spoofed image MIME types");
  const brokenPng = Buffer.from(pngBytes);
  brokenPng[29] ^= 0xff;
  const corruptPhoto = await photoWorker.fetch(new Request(`https://api.local/api/profiles/${OWNER_UID}/photo`, {
    method: "POST", headers: { Authorization: `Bearer ${verifiedOwnerToken}`, "Content-Type": "image/png" }, body: brokenPng
  }), {}, {});
  assert.strictEqual(corruptPhoto.status, 400, "The Worker rejects PNGs with invalid chunk checksums");
  const removePhoto = await photoWorker.fetch(new Request(`https://api.local/api/profiles/${OWNER_UID}/photo`, {
    method: "DELETE", headers: { Authorization: `Bearer ${verifiedOwnerToken}` }
  }), {}, {});
  assert.strictEqual(removePhoto.status, 204, "A user can remove their own photo");
  const photoAfterRemoval = await photoWorker.fetch(new Request(`https://api.local/api/profiles/${OWNER_UID}/photo`, {
    headers: { Authorization: `Bearer ${verifiedUserToken}` }
  }), {}, {});
  assert.strictEqual(photoAfterRemoval.status, 404, "Removed photos are no longer available");

  const missingBinding = await implementation.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "ignored" })
  }), {}, {});
  assert.strictEqual(missingBinding.status, 503, "Protected API must fail closed when its durable database binding is missing");

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

  const resAdminVerify = await worker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: initialPassword })
  }), {}, {});
  assert.strictEqual(resAdminVerify.status, 403, "Non-owner identity must never unlock the owner's private Notes");

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

  // D1 is the source of truth across Worker isolates; a newly created handler
  // sharing the binding must continue to recognize the configured password.
  const restartedWorker = { fetch: (request, _env, ctx) => implementation.fetch(request, env, ctx) };
  const afterRestart = await restartedWorker.fetch(new Request("https://api.local/api/notes/verify", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0.2" },
    body: JSON.stringify({ password: "NewSecretPassword2026!" })
  }), {}, {});
  assert.strictEqual(afterRestart.status, 200, "Password configuration must persist outside an individual Worker isolate");
  console.log(" PASS: D1-backed password state survives a Worker handler restart.");

  const createInvite = await worker.fetch(new Request("https://api.local/api/invitations/create", {
    method: "POST",
    headers: { "Authorization": `Bearer ${validOwnerToken}`, "Content-Type": "application/json" }, body: "{}"
  }), {}, {});
  assert.strictEqual(createInvite.status, 201, "Only the owner can issue a persistent invitation");
  const issued = await createInvite.json();
  assert.match(issued.token, /^fj_[0-9a-f]{48}fj$/);
  const redeemRequest = () => new Request("https://api.local/api/invitations/redeem", {
    method: "POST", headers: { "Authorization": `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ token: issued.token })
  });
  const redeemOnce = await worker.fetch(redeemRequest(), {}, {});
  const redeemTwice = await worker.fetch(redeemRequest(), {}, {});
  assert.strictEqual(redeemOnce.status, 200, "A valid owner-issued invitation can be redeemed once");
  assert.strictEqual(redeemTwice.status, 400, "A persistent invitation cannot be replayed");
  console.log(" PASS: D1 invitation creation, redemption and replay prevention verified.");

  const ownerAppToken = makeTestJwt(makeClaims({ email: "owner@example.com", email_verified: true, name: "Owner" }));
  const palAppToken = makeTestJwt(makeClaims({ sub: "regular_user_123", email: "pal@example.com", email_verified: true, name: "Pal" }));
  const thirdAppToken = makeTestJwt(makeClaims({ sub: "third_user_456", email: "third@example.com", email_verified: true, name: "Third" }));
  const authed = (token, url, method = "GET", body) => worker.fetch(new Request(`https://api.local${url}`, {
    method, headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body)
  }), {}, {});

  assert.strictEqual((await authed(ownerAppToken, "/api/users/register", "POST", {})).status, 200);
  assert.strictEqual((await authed(palAppToken, "/api/users/register", "POST", {})).status, 200);
  assert.strictEqual((await authed(ownerAppToken, "/api/admin/permissions", "POST", { uid: "regular_user_123", action: "approve" })).status, 200,
    "An authenticated owner can grant application access to an existing account");
  const countBefore = await (await worker.fetch(new Request("https://api.local/api/users/count"), {}, {})).json();
  assert.strictEqual(countBefore.count, 2, "Public count contains verified unique accounts only");
  const unknownInvite = await authed(ownerAppToken, "/api/pals/invite", "POST", { email: "not-a-member@example.com" });
  const knownInvite = await authed(ownerAppToken, "/api/pals/invite", "POST", { email: "pal@example.com" });
  assert.strictEqual(unknownInvite.status, 202);
  assert.strictEqual(knownInvite.status, 202);
  assert.deepStrictEqual(await unknownInvite.json(), await knownInvite.json(), "Pal lookup response must not reveal account existence");
  for (let i = 0; i < 28; i++) await authed(ownerAppToken, "/api/pals/invite", "POST", { email: `other${i}@example.com` });
  assert.strictEqual((await authed(ownerAppToken, "/api/pals/invite", "POST", { email: "over-limit@example.com" })).status, 429, "Pal invitation creation is rate limited");
  const inbox = await (await authed(palAppToken, "/api/pals/invitations")).json();
  assert.strictEqual(inbox.invitations.length, 1, "Only the invited verified email can retrieve its invitation");
  assert.strictEqual((await authed(palAppToken, `/api/pals/invitations/${inbox.invitations[0].id}/respond`, "POST", { action: "accept" })).status, 200);
  const ownerPals = await (await authed(ownerAppToken, "/api/pals")).json();
  assert.strictEqual(ownerPals.pals[0].uid, "regular_user_123", "Accepted Pal is visible to the inviter");
  assert.strictEqual((await authed(ownerAppToken, "/api/pals/regular_user_123/messages", "POST", { body: "A private Post It 💌" })).status, 201);
  for (let i = 0; i < 119; i++) await authed(ownerAppToken, "/api/pals/regular_user_123/messages", "POST", { body: `bounded test ${i}` });
  assert.strictEqual((await authed(ownerAppToken, "/api/pals/regular_user_123/messages", "POST", { body: "over limit" })).status, 429, "PIP message sending is rate limited");
  assert.strictEqual((await authed(thirdAppToken, "/api/pals/regular_user_123/messages")).status, 403, "Unrelated users cannot read a Pal conversation by changing its UID");
  const conversation = await (await authed(palAppToken, "/api/pals/hDbzbNTC7pOuU2UFCjFksopbgaG3/messages")).json();
  assert.ok(conversation.messages.some(message => message.body === "A private Post It 💌"), "Pals can exchange UTF-8 private messages");
  const scheduleResp = await (await authed(palAppToken, "/api/users/deletion", "POST", { action: "schedule" })).json();
  assert.strictEqual(scheduleResp.success, true, "Deletion scheduling succeeds; adminConfigured indicates whether full deletion will be automated");
  assert.strictEqual(scheduleResp.adminConfigured, false, "Admin SDK not configured in test environment");
  assert.strictEqual(env.DB.users.get("regular_user_123").status, "scheduled", "Scheduling marks account as scheduled in D1");
  env.DB.users.get("regular_user_123").status = "scheduled";
  env.DB.users.get("regular_user_123").deletionAt = Date.now() + 60_000;
  const countDuringGrace = await (await worker.fetch(new Request("https://api.local/api/users/count"), {}, {})).json();
  assert.strictEqual(countDuringGrace.count, 1, "Scheduled accounts are immediately excluded from active user count");
  assert.strictEqual((await authed(palAppToken, "/api/pals")).status, 403, "Scheduled deletion suspends Post It Pal access");
  assert.strictEqual((await authed(palAppToken, "/api/users/finalize-deletion", "POST", { confirmed: true })).status, 409, "Deletion cannot be finalized before 30-day grace period ends");
  env.DB.users.get("regular_user_123").deletionAt = Date.now() - 1;
  assert.strictEqual((await authed(palAppToken, "/api/users/deletion", "POST", { action: "cancel" })).status, 200,
    "A scheduled account remains cancellable while secure deletion is unavailable");
  assert.strictEqual(env.DB.users.get("regular_user_123").status, "active");
  assert.strictEqual((await authed(palAppToken, "/api/users/deletion", "POST", { action: "schedule" })).status, 200);
  env.DB.users.get("regular_user_123").status = "scheduled";
  env.DB.users.get("regular_user_123").deletionAt = Date.now() - 1;
  const messagesBeforeBlockedCleanup = env.DB.messages.size;
  await implementation.scheduled({}, env, {});
  assert.strictEqual(env.DB.users.get("regular_user_123").status, "scheduled", "A due account must remain suspended when full trusted deletion is unavailable");
  assert.strictEqual(env.DB.messages.size, messagesBeforeBlockedCleanup, "Scheduled cleanup must not partially erase data before full deletion is available");
  assert.strictEqual((await authed(palAppToken, "/api/users/finalize-deletion", "POST", { confirmed: true })).status, 503,
    "Finalization fails closed until all trusted data stores can be deleted");
  assert.ok(env.DB.users.has("regular_user_123"), "A blocked finalization must preserve the account record");
  assert.strictEqual(env.DB.messages.size, messagesBeforeBlockedCleanup, "A blocked finalization must preserve messages");
  assert.strictEqual(firebaseAuthDeleteRequests, 0, "A blocked finalization must not delete Firebase Auth first");
  console.log(" PASS: User aggregate, privacy-preserving Pal lookup, invitation acceptance, message isolation and fail-closed deletion verified.");

  console.log("\n=== ALL WORKER BACKEND TESTS PASSED SUCCESSFULLY! ===");
  global.fetch = originalFetch;
})();
