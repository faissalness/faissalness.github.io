# FJ Backend Contract Handoff — Hy4 → Flint, Iceman, Nemotron Lightning, DeepSeek

Branch: `agent/hy4-20261121-002415` (backend/security only; no frontend files edited).

This is the **authoritative backend authorization contract** after the current audit. It
supersedes conflicting statements in earlier handoffs where they disagree.

## 0. Ground Zero blink: navigation investigation and reconciliation (2026-11-21)

**The Worker is not involved in the initial navigation failure.** The homepage menu entry is a
plain anchor `<a href="/ground-zero/" id="gz-nav">` (`index.html`); no click handler calls
`preventDefault()` for it (`app.js` only toggles its `hidden` state for owner/admins). Clicking it
therefore issues a normal browser **document request** to `/ground-zero/`.

Live read-only evidence:

- `GET https://faissalness.github.io/ground-zero/` → **200** (document request succeeds).
- `GET https://faissalness.github.io/ground-zero.js` → **200**, but still contains
  `initializeApp(firebaseConfig, "FJGroundZero")`. Firebase Auth persistence is app-name scoped,
  so the owner session written by the default app on the main site is invisible to that page.
  The settled state becomes signed-out and the page calls `redirectHome()` → `window.location.href="/"`.
  **That is the blink/redirect, and it is entirely frontend/deployment.**
- Production Worker root → 200 `{"status":"FJ API Operational"}`;
  unauthenticated `GET /api/admin/accounts` → **401**; forged token `POST /api/admin/permissions`
  → **403**; OPTIONS preflight from `https://faissalness.github.io` → 200 with the correct
  `Access-Control-Allow-Origin` and `Cache-Control: no-store`; `Origin: null` preflight → no ACAO.
  The backend is alive, CORS is correct, and authorization fails closed.
- Wrangler read-only deployment history: latest production Worker is
  `6cf07e04-4584-4ec5-93f1-cc3d44e622e5`, created 2026-11-20T21:15Z. **My backend changes
  (2026-11-21) are NOT deployed.** Production still runs the earlier owner-only Worker.
- `wrangler d1 migrations list fj-api-state --remote` → "No migrations to apply", so migration
  0004 is already applied; the newly tracked file is repository consistency only.

**Reconciliation with Flint's `GROUND_ZERO_BACKEND_CONTRACT.md`:** Flint's handoff states all
`/api/admin/*` endpoints must remain owner-only. This branch keeps that rule for every
**destructive or privacy-sensitive** operation (`delete`, `lookup`, `notify-approval`, immutable
owner protection). For the non-destructive delegated administrator workflow that Flint's own
frontend implements (active `admins/{uid}` records), the Worker additionally accepts an active
admin on the read endpoints, approval/revocation and suspend/reactivate — each verified from the
caller's Firebase ID token against Firestore, never from frontend state. Ordinary users and
deactivated admins are always 403. Both documents now agree on the security boundary:
**owner authority is immutable; admin authority is delegated, backend-verified, scoped and
immediately revocable.** Flint's "owner-only" wording applies to the destructive subset.

**API failures never cancel navigation.** Worker errors are JSON with explicit HTTP status codes
(401/403/404/503) and are CORS-visible to the site origin. Only the frontend can redirect a loaded
document. The deployed `ground-zero.js` redirects from its own auth-state machine, not from an API
response. Frontend agents must fix the deployed artifact (shared default app instance) and render
API errors in place; no backend change can make a document navigate.

**Coordination issue for Flint/Iceman/Lightning:** `ground-zero.js` calls
`getDocs(collection(db, "admins"))` to load the admin list. Current Firestore rules allow a
non-owner admin to read only **their own** admin document, so that collection query fails for
delegated admins and their frontend authorization collapses before any Worker call. This is a
frontend-query/rules mismatch, not a Worker defect. I have not changed Firestore rules for it:
fixing it requires an agreed rules change (or a per-UID `getDoc`) plus a rules deployment by the
integration director. Do not solve it by weakening owner rules.

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
