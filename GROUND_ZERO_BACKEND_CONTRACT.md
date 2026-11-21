# Ground Zero 00 — Backend Contract Handoff (Hy4 / DeepSeek)

- Owner UID (immutable authority): `hDbzbNTC7pOuU2UFCjFksopbgaG3`
- Cloudflare Worker: `https://fj-api.jimyass.workers.dev`
- D1 binding: `fj-api-state`
- Owner/admin frontend: `ground-zero.js`, `backend/worker.js` (owner-only enforcement only — frontend work owned by Flint)

## Status of this contract

No backend (Cloudflare Worker) or Firestore rules change is required for the
current Ground Zero authentication-state defect. The root cause was client-side:
the Ground Zero page initialized a second Firebase Auth app instance
(`FJGroundZero`) instead of the shared default instance, so the persisted owner
session was invisible and the page settled as signed-out before redirecting.

The contract below is the authoritative, already-deployed behavior that the
frontend must continue to enforce and that Hy4/DeepSeek must preserve.

## Required backend contract (Ground Zero 00)

### Owner-only endpoints (Cloudflare Worker)

All Ground Zero admin endpoints require a valid Firebase ID token whose
identity satisfies ALL of:

1. `identity.sub === OWNER_UID` (immutable owner UID above).
2. `identity.email_verified === true`.

Requests failing either condition are rejected without state changes:

- `GET /api/admin/accounts` — lists registered accounts (owner-only).
- `POST /api/admin/accounts/{uid}/suspend` — sets D1 account status to `scheduled`.
- `POST /api/admin/accounts/{uid}/reactivate` — restores D1 account to `active` and PIP/Notes permissions to `active`.
- `POST /api/admin/accounts/{uid}/delete` — scheduled/deletion handling (fail-closed without trusted Admin SDK).
- `POST /api/admin/permissions` — owner-only PIP/Notes (and combined) approve/revoke; updates D1 mirror plus Firestore `applicationPermissions/{uid}`.
- `GET /api/admin/users` — owner-only registered-account listing for the approval dashboard.
- `POST /api/admin/lookup` — owner-only account lookup by email.

### Admin grants

- Owner grants admin status through Firestore `admins/{uid}` documents with an
  `active` boolean.
- Owner-only writes are enforced by Firestore rules; deactivated (`active: false`)
  admins must be denied frontend access immediately.

### Website approval

- Owner approves/revokes website access through Firestore `users/{uid}.approved`
  (owner-only writes via Firestore rules).

## Required backend contract changes (none blocking, tracked for follow-up)

1. Approval/owner-notification email delivery (`/api/admin/notify-approval`) is
   not yet backed by a configured email service; owner notification delivery is
   an external dependency, not a code contract change.
2. Unattended full account deletion requires the `FIREBASE_ADMIN_KEY` secret and
   remains fail-closed until configured.
3. Legacy shared Notes trusted sessions require a trusted Firebase Admin SDK
   session issuer; no code contract change shipped yet.

These items do not block the current Ground Zero owner-access fix and require no
Worker implementation change from the Flint agent.

## Handoff rules for future backend work

- Do not move Ground Zero authorization into frontend-only logic.
- Do not authorize by email alone; the immutable owner UID is authoritative.
- Do not weaken owner checks on `/api/admin/*`.
- Do not add paid services or metered APIs.
