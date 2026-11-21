# FJ Backend Contract Handoff — Hy4 → Flint, Iceman, Nemotron Lightning, DeepSeek

Branch: `agent/hy4-20261121-002415` (backend/security only; no frontend files edited).

This is the **authoritative backend authorization contract** after the current audit. It
supersedes conflicting statements in earlier handoffs where they disagree.

## 1. Identity and authority model

| Principal | How the backend verifies it | Authority |
|---|---|---|
| Immutable owner `hDbzbNTC7pOuU2UFCjFksopbgaG3` | Verified Firebase ID token (`sub` + `email_verified === true`) | Everything. Owner bypasses application permissions and the D1 mirror row. |
| Active administrator | Verified ID token **plus** a live Firestore `admins/{uid}` doc read with that same token (self-read rule), `active !== false` | Ground Zero read endpoints, approval/revocation, suspend/reactivate. |
| Deactivated/removed admin | Same check; no result cached, so revocation is immediate | Denied (403). |
| Ordinary user | Verified ID token only | No Ground Zero/admin endpoints. App routes still require active PIP/Notes state. |

Admin checks fail closed when `FIREBASE_WEB_API_KEY` is unavailable or Firestore returns an
error. Owner authority never depends on the admin lookup.

## 2. Endpoint authorization matrix

| Endpoint | Owner | Active admin | Ordinary |
|---|---|---|---|
| `GET /api/admin/accounts` | ✓ | ✓ | 403 |
| `GET /api/admin/users` | ✓ | ✓ | 403 |
| `POST /api/admin/permissions` | ✓ | ✓ | 403 |
| `POST /api/admin/accounts/{uid}/suspend` | ✓ | ✓ | 403 |
| `POST /api/admin/accounts/{uid}/reactivate` | ✓ | ✓ | 403 |
| `POST /api/admin/accounts/{uid}/delete` | ✓ | 403 (owner-only) | 403 |
| `POST /api/admin/lookup` | ✓ | 403 (owner-only) | 403 |
| `POST /api/admin/notify-approval` | ✓ (returns 503, no sender wired) | 403 | 403 |
| Owner account suspend/delete on `OWNER_UID` | 403 (lockout protection) | 403 | 403 |

All other `/api/*` routes keep their existing per-app authorization (verified email + active PIP
for social/PIP routes; owner UID for Notes/invitation/session routes).

## 3. Behavioral contracts relied on by the frontend

- `POST /api/admin/accounts/{uid}/reactivate` restores account status **and** PIP/Notes to
  `active`. This is an explicit backend-verified owner/admin action (Flint's documented contract).
  Admins cannot reach this endpoint unless their Firestore admin record is active.
- Self-service `POST /api/users/deletion` `schedule`/`cancel` **never** changes application
  statuses. A revoked user cannot regain access by scheduling and cancelling deletion.
- `POST /api/admin/permissions` returns `firestoreMirrored`. When a trusted `FIREBASE_ADMIN_KEY`
  is configured the Worker also writes `applicationPermissions/{uid}`; otherwise the flag is
  `false` and the frontend must perform (and verify) its own mirror write. Do not treat D1 as
  sufficient by itself: Firestore rules are the authoritative gate for Your Notes.
- `POST /api/admin/accounts/{uid}/delete` returns **503** and changes nothing unless
  `FIREBASE_ADMIN_KEY` is configured. Frontend must display this as "not available", not success.
- Approval/revocation takes effect on the next request; there is no authorization cache.

## 4. What frontend agents must preserve

- Never treat a client-side UID, email suffix, or Firestore read as backend authorization.
  All Ground Zero mutations must carry the Firebase ID token to the Worker.
- Do not hide backend 403/503 responses. Surface them as errors; never render a success state
  after a rejected API call.
- Non-owner admins must not be shown destructive controls (`delete`, owner-only lookup) because
  the backend will reject them.
- Use the shared default Firebase app instance for auth state (Flint/Iceman fix) so the owner's
  persisted session is visible on `/ground-zero/`.

## 5. Infrastructure / deployment requirements for the integration director

1. Deploy `backend/worker.js` to `fj-api`. No paid services are introduced.
2. `backend/wrangler.toml` now declares the public `FIREBASE_WEB_API_KEY` var used for admin
   verification. It is the same public value already committed in `firebase-config.js`.
3. `backend/migrations/0004_registered_email_lookup.sql` is now tracked. It was applied to the
   production D1 database earlier; Wrangler's migration history should skip it. Do **not** run it
   manually against production if the column already exists.
4. Firestore rules in this branch are unchanged from `origin/main` except for no changes at all —
   no rules deployment is required for these Worker changes. Verify before deploying.
5. `FIREBASE_ADMIN_KEY` remains an external secret for unattended full deletion and trusted
   Firestore mirroring. Fail-closed behavior is intentional until it is configured.
6. No Cloudflare/Firebase/GitHub production state was modified by this agent. No branch other
   than `agent/hy4-20261121-002415` was touched.

## 6. Verification performed

- `node tests/backend_security_regression_test.js` — 40/40, including backend-verified active,
  deactivated, forbidden, missing-record and unverified admins and owner-only boundaries.
- `node tests/worker_backend_test.js` — full suite passing.
- `node tests/run_all_tests.js` — full master suite passing (see report for exact count).
- All tokens in tests are locally signed with a test-only key; no production credential or user
  data was used or exposed.
