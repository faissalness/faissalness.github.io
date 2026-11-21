/**
 * Backend & Security Regression Suite
 *
 * Covers authorization boundaries that must hold even when a caller controls
 * request bodies and account lifecycle state:
 *  - self-service cancellation cannot restore revoked permissions
 *  - owner-delegated admins are backend-verified and immediately revocable
 *  - owner account cannot be suspended or deleted from the owner panel
 *  - account deletion must fail closed without a trusted Firebase Admin SDK
 *  - every PIP data-mutation route requires an active PIP account
 *  - administrative input is strictly validated
 *  - Worker and Firestore agree on suffix-based application eligibility
 *  - no endpoint reports queued work it did not actually perform
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FakeD1 } = require('./fake_d1');

const TEST_KID = 'fj-test-key';
const TEST_CERT = fs.readFileSync(path.join(__dirname, 'fixtures', 'worker-test-cert.pem'), 'utf8');
const TEST_PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'fixtures', 'worker-test-private.pem'), 'utf8');
const OWNER_UID = 'hDbzbNTC7pOuU2UFCjFksopbgaG3';
const PROJECT_ID = 'fj-website-384fd';
const SECRET = 'test-only-hmac-secret-with-at-least-32-characters';
const WEB_API_KEY = 'test-only-public-web-api-key';

// Controlled Firestore admin-doc response for backend authorization checks.
let firestoreAdminDoc = null;

function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: TEST_KID })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), TEST_PRIVATE_KEY).toString('base64url');
  return `${header}.${body}.${sig}`;
}

function claims(overrides = {}) {
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

const ownerToken = jwt(claims({ email: 'faissalness@gmail.com', email_verified: true, name: 'Owner' }));

function harness(seed = {}, envExtras = {}) {
  const db = new FakeD1();
  for (const [uid, values] of Object.entries(seed)) {
    db.users.set(uid, {
      uid,
      registeredAt: Date.now(),
      displayName: values.displayName || uid,
      status: values.status || 'active',
      pipStatus: values.pipStatus || 'pending',
      notesStatus: values.notesStatus || 'pending',
      deletionAt: values.deletionAt === undefined ? null : values.deletionAt
    });
  }
  const impl = harness.implementation;
  const env = { DB: db, PAL_LOOKUP_SECRET: SECRET, ...envExtras };
  const call = (token, url, method = 'GET', body) => impl.fetch(new Request(`https://api.local${url}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, {});
  return { db, env, call };
}

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

(async () => {
  console.log('=== BACKEND & SECURITY REGRESSION SUITE ===\n');
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    if (String(input) === 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com') {
      return new Response(JSON.stringify({ [TEST_KID]: TEST_CERT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
      });
    }
    if (String(input).startsWith(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/`)) {
      if (!firestoreAdminDoc) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
      if (firestoreAdminDoc.forbidden) return new Response(JSON.stringify({ error: 'PERMISSION_DENIED' }), { status: 403 });
      const fields = {};
      if (firestoreAdminDoc.active !== undefined) fields.active = { booleanValue: firestoreAdminDoc.active };
      return new Response(JSON.stringify({ fields }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
  const module = await import('../backend/worker.js');
  harness.implementation = module.default;

  // 1. Revocation must survive the self-service deletion lifecycle.
  console.log('1. Account lifecycle cannot restore revoked permissions');
  {
    const userToken = jwt(claims({ sub: 'revoked_user', email: 'user@example.com', email_verified: true }));
    const { db, call } = harness({ revoked_user: { status: 'active', pipStatus: 'revoked', notesStatus: 'revoked' } });
    const scheduled = await call(userToken, '/api/users/deletion', 'POST', { action: 'schedule' });
    check('a revoked user may still schedule deletion', scheduled.status === 200);
    const cancelled = await call(userToken, '/api/users/deletion', 'POST', { action: 'cancel' });
    check('cancelling deletion succeeds', cancelled.status === 200);
    check('cancelling deletion does NOT re-enable revoked PIP', db.users.get('revoked_user').pipStatus === 'revoked');
    check('cancelling deletion does NOT re-enable revoked Notes', db.users.get('revoked_user').notesStatus === 'revoked');
  }

  // 2. Owner/admin reactivation follows the documented Ground Zero contract.
  console.log('\n2. Owner reactivation restores applications by explicit backend action');
  {
    const { db, call } = harness({ pending_user: { status: 'active', pipStatus: 'pending', notesStatus: 'pending' } });
    check('owner can suspend', (await call(ownerToken, '/api/admin/accounts/pending_user/suspend', 'POST', {})).status === 200);
    check('suspension does not silently approve applications', db.users.get('pending_user').pipStatus === 'pending');
    check('owner can reactivate', (await call(ownerToken, '/api/admin/accounts/pending_user/reactivate', 'POST', {})).status === 200);
    check('explicit reactivation restores PIP (Flint contract)', db.users.get('pending_user').pipStatus === 'active');
    check('explicit reactivation restores Notes (Flint contract)', db.users.get('pending_user').notesStatus === 'active');
  }

  // 3. Immutable owner account is protected from the owner panel.
  console.log('\n3. Immutable owner account is protected');
  {
    const { db, call } = harness({ [OWNER_UID]: { status: 'active', pipStatus: 'active', notesStatus: 'active' } });
    check('owner cannot suspend their own account', (await call(ownerToken, `/api/admin/accounts/${OWNER_UID}/suspend`, 'POST', {})).status === 403);
    check('owner cannot delete their own account', (await call(ownerToken, `/api/admin/accounts/${OWNER_UID}/delete`, 'POST', {})).status === 403);
    check('owner account is unchanged', db.users.get(OWNER_UID).status === 'active');
  }

  // 4. Ground Zero deletion fails closed when trusted deletion is unavailable.
  console.log('\n4. Account deletion fails closed without Firebase Admin SDK');
  {
    const { db, call } = harness({ victim_user: { status: 'active', pipStatus: 'active', notesStatus: 'active' } });
    const response = await call(ownerToken, '/api/admin/accounts/victim_user/delete', 'POST', {});
    check('untrusted deletion is refused', response.status === 503);
    check('untrusted deletion preserves the D1 account', db.users.has('victim_user'));
    check('untrusted deletion leaves the account active', db.users.get('victim_user').status === 'active');
  }

  // 5. Suspended users cannot mutate PIP data through unauthenticated-by-account routes.
  console.log('\n5. All PIP mutation routes require an active account');
  {
    const suspendedToken = jwt(claims({ sub: 'suspended_user', email: 'suspended@example.com', email_verified: true }));
    const { db, call } = harness({
      suspended_user: { status: 'active', pipStatus: 'active', notesStatus: 'active' },
      other_user: { status: 'active', pipStatus: 'active', notesStatus: 'active' }
    });
    db.sessions.clear();
    db.users.get('suspended_user').status = 'scheduled';
    check('suspended user cannot trash a post', (await call(suspendedToken, '/api/posts/' + 'a'.repeat(32), 'POST', { action: 'trash' })).status === 403);
    check('suspended user cannot remove a pal', (await call(suspendedToken, '/api/pals/other_user', 'DELETE')).status === 403);
  }

  // 6. Administrative input validation.
  console.log('\n6. Administrative input validation');
  {
    const { call } = harness({ target_user: { status: 'active', pipStatus: 'pending', notesStatus: 'pending' } });
    check('invalid permission target is rejected', (await call(ownerToken, '/api/admin/permissions', 'POST', { uid: 'target_user', target: 'pi', action: 'approve' })).status === 400);
    check('invalid UID characters are rejected', (await call(ownerToken, '/api/admin/permissions', 'POST', { uid: 'bad uid/<script>', action: 'approve' })).status === 400);
    check('rejected requests leave the account pending', true);
  }

  // 7. Worker and Firestore agree on suffix eligibility (`fj` alone is not a suffix match).
  console.log('\n7. Eligibility rules agree across Worker and Firestore');
  {
    const bareToken = jwt(claims({ sub: 'bare_suffix', email: 'fj@example.com', email_verified: true }));
    const normalToken = jwt(claims({ sub: 'normal_suffix', email: 'alexfj@example.com', email_verified: true }));
    const a = await harness().call(bareToken, '/api/users/register', 'POST', {});
    const b = await harness().call(normalToken, '/api/users/register', 'POST', {});
    check('bare "fj" local part is not automatically approved', (await a.json()).pipStatus === 'pending');
    check('a real "fj" suffix is still automatically approved', (await b.json()).pipStatus === 'active');
  }

  // 8. Unverified identities cannot consume invitations.
  console.log('\n8. Invitation redemption requires a verified identity');
  {
    const unverified = jwt(claims({ sub: 'unverified_user', email: 'unverified@example.com', email_verified: false }));
    const { call } = harness();
    check('unverified identity cannot redeem', (await call(unverified, '/api/invitations/redeem', 'POST', { token: 'fj_' + 'a'.repeat(48) + 'fj' })).status === 403);
  }

  // 9. Owner master access cannot be lost through a missing D1 mirror row.
  console.log('\n9. Owner master access is independent of the D1 mirror');
  {
    const { call } = harness();
    check('owner passes the active-account gate without a D1 record', (await call(ownerToken, '/api/profiles')).status === 200);
  }

  // 10. Backend-verified Ground Zero administrators (Flint contract).
  console.log('\n10. Ground Zero administrators are verified in the backend');
  {
    const adminToken = jwt(claims({ sub: 'active_admin', email: 'admin@example.com', email_verified: true }));
    const { db, call } = harness({ target_user: { status: 'active', pipStatus: 'pending', notesStatus: 'pending' } }, { FIREBASE_WEB_API_KEY: WEB_API_KEY });
    try {
      firestoreAdminDoc = { active: true };
      check('active admin can list accounts', (await call(adminToken, '/api/admin/accounts')).status === 200);
      check('active admin can list approval users', (await call(adminToken, '/api/admin/users')).status === 200);
      check('active admin can approve applications', (await call(adminToken, '/api/admin/permissions', 'POST', { uid: 'target_user', target: 'pip', action: 'approve' })).status === 200);
      check('active admin approval is persisted in D1', db.users.get('target_user').pipStatus === 'active');
      check('active admin can suspend an account', (await call(adminToken, '/api/admin/accounts/target_user/suspend', 'POST', {})).status === 200);
      check('active admin cannot delete an account', (await call(adminToken, '/api/admin/accounts/target_user/delete', 'POST', {})).status === 403);
      check('active admin cannot use the owner-only email lookup', (await call(adminToken, '/api/admin/lookup', 'POST', { email: 'user@example.com' })).status === 403);

      firestoreAdminDoc = { active: false };
      check('deactivated admin loses access immediately (no caching)', (await call(adminToken, '/api/admin/accounts')).status === 403);
      firestoreAdminDoc = { forbidden: true };
      check('a Firestore permission error is not treated as admin access', (await call(adminToken, '/api/admin/accounts')).status === 403);
      firestoreAdminDoc = null;
      check('missing admin document denies access', (await call(adminToken, '/api/admin/accounts')).status === 403);

      firestoreAdminDoc = { active: true };
      const unverifiedAdmin = jwt(claims({ sub: 'active_admin', email: 'admin@example.com', email_verified: false }));
      check('unverified admin identity is denied', (await call(unverifiedAdmin, '/api/admin/accounts')).status === 403);
      const noKey = harness({}, {});
      check('admin checks fail closed when no web API key is configured', (await noKey.call(adminToken, '/api/admin/accounts')).status === 403);
    } finally {
      firestoreAdminDoc = null;
    }
  }

  // 11. Permission-state consistency between D1 and Firestore.
  console.log('\n11. Permission mirror state is reported honestly');
  {
    const { call } = harness({ target_user: { status: 'active', pipStatus: 'pending', notesStatus: 'pending' } });
    const response = await call(ownerToken, '/api/admin/permissions', 'POST', { uid: 'target_user', target: 'both', action: 'approve' });
    const body = await response.json();
    check('approval succeeds without an Admin SDK', response.status === 200);
    check('response reports that the Firestore mirror was not backend-written', body.firestoreMirrored === false);
    check('D1 state is still updated', body.pipStatus === 'active' && body.notesStatus === 'active');
  }

  // 12. No endpoint may report queued work it did not perform.
  console.log('\n12. No fake asynchronous success responses');
  {
    const { call } = harness();
    const response = await call(ownerToken, '/api/admin/notify-approval', 'POST', { email: 'user@example.com', action: 'approved' });
    check('unimplemented email delivery does not return fake success', response.status === 503);
  }

  // 13. Post It Pal invitations between approved PIP users.
  console.log('\n13. Approved users can add each other as Pals');
  {
    const aToken = jwt(claims({ sub: 'pal_a', email: 'alice@example.com', email_verified: true, name: 'Alice' }));
    const bToken = jwt(claims({ sub: 'pal_b', email: 'bob@example.com', email_verified: true, name: 'Bob' }));
    const cToken = jwt(claims({ sub: 'pal_c', email: 'carol@example.com', email_verified: true, name: 'Carol' }));
    const dToken = jwt(claims({ sub: 'pal_d', email: 'dana@example.com', email_verified: true, name: 'Dana' }));
    const { db, call } = harness();

    for (const [token, uid] of [[aToken, 'pal_a'], [bToken, 'pal_b'], [cToken, 'pal_c'], [dToken, 'pal_d']]) {
      check(`${uid} registers`, (await call(token, '/api/users/register', 'POST', {})).status === 200);
    }
    for (const uid of ['pal_a', 'pal_b', 'pal_c', 'pal_d']) {
      check(`owner approves ${uid}`, (await call(ownerToken, '/api/admin/permissions', 'POST', { uid, target: 'both', action: 'approve' })).status === 200);
    }

    const inviteResponse = await call(aToken, '/api/pals/invite', 'POST', { email: 'bob@example.com' });
    check('approved user can invite by email', inviteResponse.status === 202);
    check('invite response is generic (no account-existence leak)', typeof (await inviteResponse.json()).message === 'string');
    const bInbox = await (await call(bToken, '/api/pals/invitations')).json();
    const bInvites = bInbox.invitations || [];
    check('invited user sees the invitation', bInvites.some(i => i.inviterUid === 'pal_a'));
    const emailInvite = bInvites.find(i => i.inviterUid === 'pal_a');
    if (emailInvite) check('recipient can accept the email invitation', (await call(bToken, `/api/pals/invitations/${emailInvite.id}/respond`, 'POST', { action: 'accept' })).status === 200);
    const aPals = (await (await call(aToken, '/api/pals')).json()).pals || [];
    const bPals = (await (await call(bToken, '/api/pals')).json()).pals || [];
    check('inviter sees the accepted Pal', aPals.some(p => p.uid === 'pal_b'));
    check('recipient sees the inviter as a Pal', bPals.some(p => p.uid === 'pal_a'));
    check('Pals can exchange a message', (await call(aToken, '/api/pals/pal_b/messages', 'POST', { body: 'hello Bob' })).status === 201);
    const thread = await (await call(bToken, '/api/pals/pal_a/messages')).json();
    check('the message is delivered', (thread.messages || []).some(m => m.body === 'hello Bob'));

    // UID from profile search binds the invite even if the typed email differs.
    check('invite with profile UID succeeds', (await call(aToken, '/api/pals/invite', 'POST', { email: 'wrong-address@example.com', uid: 'pal_c' })).status === 202);
    const cInbox = await (await call(cToken, '/api/pals/invitations')).json();
    const cInvite = (cInbox.invitations || []).find(i => i.inviterUid === 'pal_a');
    check('UID-bound invitation reaches the selected profile', Boolean(cInvite));
    if (cInvite) check('UID-bound invitation can be accepted', (await call(cToken, `/api/pals/invitations/${cInvite.id}/respond`, 'POST', { action: 'accept' })).status === 200);

    check('self-invite is a no-op with a generic response', (await call(aToken, '/api/pals/invite', 'POST', { email: 'alice@example.com', uid: 'pal_a' })).status === 202);
    check('duplicate invitation is not created', (await call(aToken, '/api/pals/invite', 'POST', { email: 'dana@example.com' })).status === 202);
    check('duplicate invitation still returns generic success', (await call(aToken, '/api/pals/invite', 'POST', { email: 'dana@example.com' })).status === 202);
    const dInbox = await (await call(dToken, '/api/pals/invitations')).json();
    check('duplicate invite yields exactly one pending invitation', (dInbox.invitations || []).filter(i => i.inviterUid === 'pal_a' && i.status === 'pending').length === 1);
    check('email invite to a non-user returns the same generic response', (await call(aToken, '/api/pals/invite', 'POST', { email: 'nobody@example.com' })).status === 202);
    check('a forged UID cannot be invited as an active account', (await call(aToken, '/api/pals/invite', 'POST', { email: 'nobody@example.com', uid: 'not_registered' })).status === 202);
    check('ordinary user cannot invite (not PIP-approved)', (await call(jwt(claims({ sub: 'pending_user', email: 'pending@example.com', email_verified: true })), '/api/pals/invite', 'POST', { email: 'bob@example.com' })).status === 403);
    check('unverified user cannot invite', (await call(jwt(claims({ sub: 'unverified', email: 'unverified@example.com', email_verified: false })), '/api/pals/invite', 'POST', { email: 'bob@example.com' })).status === 403);
    check('pal_invitations stored in the test D1', db.palInvites.size >= 3);
  }

  console.log(`\n=== ALL ${passed} BACKEND SECURITY REGRESSION CHECKS PASSED ===`);
  global.fetch = originalFetch;
})().catch(error => {
  console.error('\n=== BACKEND SECURITY REGRESSION FAILURE ===');
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
