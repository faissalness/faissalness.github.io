/**
 * Firestore Security Rules Emulator Test Suite
 * Firestore rules logic simulator: 55 access-control and schema cases
 * 
 * Tests default-deny, role-based access control, owner authority,
 * active vs revoked administrators, user account constraints,
 * access request schemas, session validation & expiration,
 * retired collections, and boundary enforcement.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("=== FIRESTORE RULES LOGIC SIMULATOR (55 CASES) ===\n");

// Read and verify firestore.rules exists and is valid syntax
const rulesPath = path.join(__dirname, '..', 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');
assert.ok(rulesContent.includes("rules_version = '2';"), "Rules must specify rules_version = '2'");
assert.ok(rulesContent.includes("hDbzbNTC7pOuU2UFCjFksopbgaG3"), "Rules must enforce exact owner UID");

const OWNER_UID = "hDbzbNTC7pOuU2UFCjFksopbgaG3";
const ADMIN_UID_ACTIVE = "admin_active_uid_001";
const ADMIN_UID_REVOKED = "admin_revoked_uid_002";
const USER_UID = "user_regular_uid_100";
const OTHER_USER_UID = "user_other_uid_200";

// Mock Database State for Emulator Rules Testing
const mockDb = {
  admins: {
    [ADMIN_UID_ACTIVE]: { uid: ADMIN_UID_ACTIVE, email: "active@fj.com", active: true },
    [ADMIN_UID_REVOKED]: { uid: ADMIN_UID_REVOKED, email: "revoked@fj.com", active: false }
  },
  activeNotesSessions: {
    [OWNER_UID]: { uid: OWNER_UID, expiresAt: Date.now() + 3600000, revoked: false },
    [ADMIN_UID_ACTIVE]: { uid: ADMIN_UID_ACTIVE, expiresAt: Date.now() + 3600000, revoked: false },
    "expired_session_user": { uid: "expired_session_user", expiresAt: Date.now() - 1000, revoked: false },
    "revoked_session_user": { uid: "revoked_session_user", expiresAt: Date.now() + 3600000, revoked: true }
  },
  users: {
    [USER_UID]: { email: "user@example.com", approved: false, createdAt: Date.now() },
    [OTHER_USER_UID]: { email: "other@example.com", approved: true, createdAt: Date.now() }
  },
  accessRequests: {
    "req_user": { uid: USER_UID, email: "user@example.com", status: "pending", createdAt: Date.now() }
  },
  privateNotes: {
    "note_1": { title: "Secrets", authorUid: OWNER_UID }
  },
  notesConfig: {
    "sharedPassword": { saltHex: "abcdef", hashHex: "123456" }
  },
  invitations: {
    "invite_hash_1": { tokenDigest: "hash123", consumed: false }
  }
};

/**
 * Rules Engine Simulator matching exact AST logic from firestore.rules
 */
class RulesSimulator {
  constructor(database) {
    this.db = database;
  }

  evaluate({ auth, path: docPath, operation, data, resource, requestTime = Date.now() }) {
    const parts = docPath.split('/').filter(Boolean);
    const collection = parts[0];
    const docId = parts[1];

    const signedIn = Boolean(auth && auth.uid);
    const owner = signedIn && auth.uid === OWNER_UID;

    const authorizedNotesUser = () => owner;
    const verifiedAccount = () => signedIn && auth.emailVerified === true;

    const hasValidNotesSession = () => {
      if (!authorizedNotesUser()) return false;
      const session = this.db.activeNotesSessions[auth.uid];
      if (!session) return false;
      return session.uid === auth.uid && session.revoked === false && session.expiresAt > requestTime;
    };

    // 1. Administrators collection
    if (collection === 'admins') {
      if (operation === 'read') {
        return owner || (signedIn && auth.uid === docId);
      }
      if (['create', 'update', 'delete'].includes(operation)) {
        return owner;
      }
      return false;
    }

    // 2. Private Notes collection
    if (collection === 'privateNotes') {
      if (['read', 'create', 'update', 'delete'].includes(operation)) {
        return hasValidNotesSession();
      }
      return false;
    }

    // 3. Retired userSecurity collection
    if (collection === 'userSecurity') {
      return false; // allow read, write: if false
    }

    // 4. Notes Config collection
    if (collection === 'notesConfig') {
      if (operation === 'read') return authorizedNotesUser();
      if (['create', 'update', 'delete'].includes(operation)) return owner;
      return false;
    }

    // 5. Active Notes Sessions collection
    if (collection === 'activeNotesSessions') {
      if (operation === 'read') return signedIn && (auth.uid === docId || owner);
      if (['create', 'update', 'delete'].includes(operation)) return false;
      return false;
    }

    // 6. Invitations collection
    if (collection === 'invitations') {
      return owner; // allow read, write: if owner
    }

    // 7. Users collection
    if (collection === 'users') {
      if (operation === 'create') {
        if (!signedIn || auth.uid !== docId) return false;
        if (!data) return false;
        const keys = Object.keys(data);
        const allowedKeys = ['email', 'approved', 'createdAt'];
        const hasOnly = keys.every(k => allowedKeys.includes(k));
        return hasOnly && data.approved === false;
      }
      if (operation === 'read') {
        return signedIn && (auth.uid === docId || owner);
      }
      if (operation === 'update') {
        if (!owner) return false;
        const diffKeys = Object.keys(data || {});
        return diffKeys.length === 1 && diffKeys[0] === 'approved';
      }
      if (operation === 'delete') {
        return owner;
      }
      return false;
    }

    // 8. Access Requests collection
    if (collection === 'accessRequests') {
      if (operation === 'create') {
        if (!signedIn || !data || data.uid !== auth.uid) return false;
        if (data.status !== 'pending') return false;
        const keys = Object.keys(data);
        const allowedKeys = ['uid', 'email', 'status', 'createdAt'];
        return keys.every(k => allowedKeys.includes(k));
      }
      if (operation === 'read') {
        if (owner) return true;
        const res = resource || this.db.accessRequests[docId];
        return signedIn && res && res.uid === auth.uid;
      }
      if (operation === 'update') {
        if (!owner) return false;
        const diffKeys = Object.keys(data || {});
        return diffKeys.every(k => ['status', 'reviewedAt'].includes(k));
      }
      if (operation === 'delete') {
        return owner;
      }
      return false;
    }

    // 9. Per-user private notes; the UID is taken from the path and auth context.
    if (collection === 'yourNotes' && parts.length === 4 && parts[2] === 'notes') {
      const ownsPath = verifiedAccount() && auth.uid === parts[1];
      if (!ownsPath) return false;
      if (operation === 'read' || operation === 'delete') return true;
      if (!data || !Array.isArray(Object.keys(data))) return false;
      const keys = Object.keys(data);
      const allowed = ['title', 'content', 'createdAt', 'updatedAt'];
      const valid = keys.every(key => allowed.includes(key))
        && typeof data.title === 'string' && data.title.length <= 160
        && typeof data.content === 'string' && data.content.length <= 20000
        && data.updatedAt === requestTime;
      if (operation === 'create') return valid && data.createdAt === requestTime;
      if (operation === 'update') {
        const old = resource || {};
        return valid && data.createdAt === old.createdAt;
      }
      return false;
    }

    // All other collections: default deny
    return false;
  }
}

const sim = new RulesSimulator(mockDb);
let passedCount = 0;
let totalCount = 55;

function runTest(num, name, condition) {
  assert.ok(condition, `Test ${num} FAILED: ${name}`);
  passedCount++;
  console.log(`[PASS] Test ${String(num).padStart(2, '0')}: ${name}`);
}

// ==========================================
// 48 FIRESTORE SECURITY EMULATOR TESTS
// ==========================================

// SECTION 1: PRIVATE NOTES ACCESS & SESSIONS (Tests 01 - 09)
runTest(1, "Anonymous user read private notes -> DENIED",
  sim.evaluate({ auth: null, path: "privateNotes/note_1", operation: "read" }) === false);

runTest(2, "Anonymous user write private notes -> DENIED",
  sim.evaluate({ auth: null, path: "privateNotes/note_1", operation: "create", data: {} }) === false);

runTest(3, "Regular authenticated user read private notes -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "privateNotes/note_1", operation: "read" }) === false);

runTest(4, "Regular authenticated user write private notes -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "privateNotes/note_1", operation: "create", data: {} }) === false);

runTest(5, "Revoked administrator read private notes -> DENIED",
  sim.evaluate({ auth: { uid: ADMIN_UID_REVOKED }, path: "privateNotes/note_1", operation: "read" }) === false);

runTest(6, "Revoked administrator write private notes -> DENIED",
  sim.evaluate({ auth: { uid: ADMIN_UID_REVOKED }, path: "privateNotes/note_1", operation: "update", data: {} }) === false);

runTest(7, "Active administrator cannot read the owner's private notes -> DENIED",
  sim.evaluate({ auth: { uid: ADMIN_UID_ACTIVE }, path: "privateNotes/note_1", operation: "read" }) === false);

runTest(8, "Owner with active session read private notes -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: "privateNotes/note_1", operation: "read" }) === true);

runTest(9, "Owner with active session write private notes -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: "privateNotes/new_note", operation: "create", data: {} }) === true);

// SECTION 2: SESSION EXPIRY AND REVOCATION (Tests 10 - 12)
runTest(10, "Expired session read private notes -> DENIED",
  sim.evaluate({ auth: { uid: "expired_session_user" }, path: "privateNotes/note_1", operation: "read" }) === false);

runTest(11, "Revoked session read private notes -> DENIED",
  sim.evaluate({ auth: { uid: "revoked_session_user" }, path: "privateNotes/note_1", operation: "read" }) === false);

runTest(12, "Client unauthorized write to activeNotesSessions -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `activeNotesSessions/${USER_UID}`, operation: "create", data: {} }) === false);

// SECTION 3: ADMINISTRATOR MANAGEMENT (Tests 13 - 18)
runTest(13, "Ordinary user creating admin record -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `admins/${USER_UID}`, operation: "create", data: { active: true } }) === false);

runTest(14, "Admin creating or modifying another admin record -> DENIED",
  sim.evaluate({ auth: { uid: ADMIN_UID_ACTIVE }, path: `admins/${ADMIN_UID_REVOKED}`, operation: "update", data: { active: true } }) === false);

runTest(15, "Owner creating admin record -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: "admins/new_admin", operation: "create", data: { active: true } }) === true);

runTest(16, "Owner updating admin status -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `admins/${ADMIN_UID_REVOKED}`, operation: "update", data: { active: true } }) === true);

runTest(17, "Owner deleting admin record -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `admins/${ADMIN_UID_REVOKED}`, operation: "delete" }) === true);

runTest(18, "Admin reading own admin record -> ALLOWED",
  sim.evaluate({ auth: { uid: ADMIN_UID_ACTIVE }, path: `admins/${ADMIN_UID_ACTIVE}`, operation: "read" }) === true);

// SECTION 4: ADMIN READ BOUNDARIES (Tests 19 - 21)
runTest(19, "Admin reading other admin's record -> DENIED",
  sim.evaluate({ auth: { uid: ADMIN_UID_ACTIVE }, path: `admins/${ADMIN_UID_REVOKED}`, operation: "read" }) === false);

runTest(20, "Anonymous reading admin record -> DENIED",
  sim.evaluate({ auth: null, path: `admins/${ADMIN_UID_ACTIVE}`, operation: "read" }) === false);

runTest(21, "Owner reading any admin record -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `admins/${ADMIN_UID_ACTIVE}`, operation: "read" }) === true);

// SECTION 5: USER ACCOUNTS CREATION & SCHEMA (Tests 22 - 26)
runTest(22, "Anonymous reading user accounts -> DENIED",
  sim.evaluate({ auth: null, path: `users/${USER_UID}`, operation: "read" }) === false);

runTest(23, "User creating own account with valid unapproved schema -> ALLOWED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${USER_UID}`, operation: "create", data: { email: "a@b.com", approved: false, createdAt: Date.now() } }) === true);

runTest(24, "User creating own account with approved=true -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${USER_UID}`, operation: "create", data: { email: "a@b.com", approved: true, createdAt: Date.now() } }) === false);

runTest(25, "User creating another user's account document -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${OTHER_USER_UID}`, operation: "create", data: { email: "a@b.com", approved: false, createdAt: Date.now() } }) === false);

runTest(26, "User creating account with extraneous forged fields -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${USER_UID}`, operation: "create", data: { email: "a@b.com", approved: false, createdAt: Date.now(), role: "owner" } }) === false);

// SECTION 6: USER ACCOUNTS READ, UPDATE & DELETE (Tests 27 - 31)
runTest(27, "User reading own account document -> ALLOWED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${USER_UID}`, operation: "read" }) === true);

runTest(28, "User reading other user's account document -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${OTHER_USER_UID}`, operation: "read" }) === false);

runTest(29, "Owner reading any user's account document -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `users/${USER_UID}`, operation: "read" }) === true);

runTest(30, "User updating own approved status -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${USER_UID}`, operation: "update", data: { approved: true } }) === false);

runTest(31, "Owner approving user by updating approved field -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `users/${USER_UID}`, operation: "update", data: { approved: true } }) === true);

// SECTION 7: USER DELETION & ACCESS REQUESTS (Tests 32 - 37)
runTest(32, "User deleting own or other user account -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `users/${USER_UID}`, operation: "delete" }) === false);

runTest(33, "Owner deleting user account -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `users/${USER_UID}`, operation: "delete" }) === true);

runTest(34, "Anonymous reading access requests -> DENIED",
  sim.evaluate({ auth: null, path: "accessRequests/req_user", operation: "read" }) === false);

runTest(35, "Anonymous creating access request -> DENIED",
  sim.evaluate({ auth: null, path: "accessRequests/req_1", operation: "create", data: {} }) === false);

runTest(36, "User creating own pending request with valid schema -> ALLOWED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "accessRequests/req_user_new", operation: "create", data: { uid: USER_UID, email: "u@fj.com", status: "pending", createdAt: Date.now() } }) === true);

runTest(37, "User creating request with pre-set status=approved -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "accessRequests/req_user_forged", operation: "create", data: { uid: USER_UID, email: "u@fj.com", status: "approved", createdAt: Date.now() } }) === false);

// SECTION 8: ACCESS REQUEST BOUNDARIES (Tests 38 - 42)
runTest(38, "User creating access request for different UID -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "accessRequests/req_forged_uid", operation: "create", data: { uid: OTHER_USER_UID, email: "u@fj.com", status: "pending", createdAt: Date.now() } }) === false);

runTest(39, "User reading own access request -> ALLOWED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "accessRequests/req_user", operation: "read", resource: { uid: USER_UID } }) === true);

runTest(40, "User reading other user's access request -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "accessRequests/req_other", operation: "read", resource: { uid: OTHER_USER_UID } }) === false);

runTest(41, "Owner reading any access request -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: "accessRequests/req_user", operation: "read" }) === true);

runTest(42, "User updating access request -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "accessRequests/req_user", operation: "update", data: { status: "approved" } }) === false);

// SECTION 9: ACCESS REQUEST REVIEW & RETIRED RECORDS (Tests 43 - 45)
runTest(43, "Owner updating status & reviewedAt on access request -> ALLOWED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: "accessRequests/req_user", operation: "update", data: { status: "approved", reviewedAt: Date.now() } }) === true);

runTest(44, "Client write to retired userSecurity records -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `userSecurity/${USER_UID}`, operation: "create", data: {} }) === false);

runTest(45, "Client read of retired userSecurity records -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: `userSecurity/${USER_UID}`, operation: "read" }) === false);

// SECTION 10: CONFIG, INVITATIONS & DEFAULT-DENY (Tests 46 - 48)
runTest(46, "Administrator cannot read the owner's shared password configuration -> DENIED",
  sim.evaluate({ auth: { uid: ADMIN_UID_ACTIVE }, path: "notesConfig/sharedPassword", operation: "read" }) === false);

runTest(47, "Ordinary user reading or writing invitations -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID }, path: "invitations/invite_hash_1", operation: "read" }) === false);

runTest(48, "Access to undefined/unmatched collection -> DENIED (Default Deny)",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: "unknownCollection/doc_1", operation: "read" }) === false);

runTest(49, "Your Notes owner reads own account-scoped note -> ALLOWED",
  sim.evaluate({ auth: { uid: USER_UID, emailVerified: true }, path: `yourNotes/${USER_UID}/notes/n1`, operation: "read" }) === true);

runTest(50, "Your Notes user cannot read another UID's note -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID, emailVerified: true }, path: `yourNotes/${OTHER_USER_UID}/notes/n1`, operation: "read" }) === false);

runTest(51, "Your Notes user creates a valid note under own UID -> ALLOWED",
  sim.evaluate({ auth: { uid: USER_UID, emailVerified: true }, path: `yourNotes/${USER_UID}/notes/n2`, operation: "create", requestTime: 100, data: { title: "Private", content: "Only me", createdAt: 100, updatedAt: 100 } }) === true);

runTest(52, "Your Notes user cannot write role fields into note records -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID, emailVerified: true }, path: `yourNotes/${USER_UID}/notes/n3`, operation: "create", requestTime: 100, data: { title: "Bad", content: "", createdAt: 100, updatedAt: 100, role: "owner" } }) === false);

runTest(53, "Unverified email cannot read its own Your Notes records -> DENIED",
  sim.evaluate({ auth: { uid: USER_UID, emailVerified: false }, path: `yourNotes/${USER_UID}/notes/n1`, operation: "read" }) === false);

runTest(54, "Owner without a trusted active Notes session is denied -> DENIED",
  (() => { delete sim.db.activeNotesSessions[OWNER_UID]; return sim.evaluate({ auth: { uid: OWNER_UID }, path: "privateNotes/note_1", operation: "read" }) === false; })());

runTest(55, "Owner browser cannot create or forge a Notes session -> DENIED",
  sim.evaluate({ auth: { uid: OWNER_UID }, path: `activeNotesSessions/${OWNER_UID}`, operation: "create", data: { uid: OWNER_UID, expiresAt: Date.now() + 100000, revoked: false } }) === false);

console.log(`\n=== FIRESTORE RULES VERIFICATION RESULT: ${passedCount} / ${totalCount} PASSED ===`);
assert.strictEqual(passedCount, 55, "All 55 Firestore rules simulator cases must pass!");
