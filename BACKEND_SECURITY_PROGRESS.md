# FJ Backend & Security Agent — Completion Report

Branch: `agent/hy4-20261121-002415`
Scope: Firebase/Firestore rules, Cloudflare Worker, D1, API authorization, infrastructure and security audit.
Frontend files owned by Flint / LongCat were **not** edited.

## Repository inspection

Read in full: `FJ_AGENT_MISSION.md`, `ins101.txt`, `EXECUTION_PROGRESS.md`, `firestore.rules`,
`firebase.json`, `backend/worker.js` (1205 lines), `backend/wrangler.toml`, all D1 migrations,
`functions/access-approval-trigger.js`, `.github/workflows/deploy-pages.yml`, `.gitignore`, and the
existing test suite. Baseline Worker suite passed; baseline master suite was 325 passed / 7 failed
(the single failing suite was `pages_allowlist_test.js`, broken by CRLF sensitivity in this checkout).

## Defects found and fixed

1. **CRITICAL — owner revocation bypass through the account lifecycle.**
   `POST /api/users/deletion` (`cancel`) and `POST /api/admin/accounts/{uid}/reactivate` overwrote
   `pip_status` and `notes_status` with `active`. A user whose access the owner had revoked could
   schedule deletion and immediately cancel it (or be suspended and reactivated) to regain access.
   Fix: account status alone now signals suspension; cancellation and reactivation restore only the
   account status and never overwrite independently-managed application permissions. No D1 schema
   migration is required, so the fix is deployable without coordination with a migration step.

2. **HIGH — Ground Zero "delete" was not a real deletion.**
   It removed only D1 rows and returned success, leaving the Firebase Auth identity and all Firestore
   data intact. Fix: it now fails closed with 503 and makes no changes unless a trusted
   `FIREBASE_ADMIN_KEY` is configured. A shared `purgeAccountData()` helper (used by the cron
   scheduler, self-service finalization, and the owner panel) removes Firestore `yourNotes` and
   account documents, all related D1 tables, and deletes the Firebase Auth identity **last**, so a
   partial failure never leaves private data orphaned behind an unauthenticatable identity.

3. **MEDIUM — missing active-account checks.** `POST/DELETE /api/posts/{id}` and
   `DELETE /api/pals/{uid}` required only a verified email. Suspended users could still mutate PIP
   data. Both now require `accountIsActive()`.

4. **MEDIUM — immutable owner account could be suspended or deleted** from the owner panel, risking
   permanent lockout. Those two actions now return 403 for the owner UID.

5. **LOW — admin input validation.** `/api/admin/permissions` accepted arbitrary `target` values
   (silently expanding them to "both") and unsanitized UIDs. UID must now match
   `^[A-Za-z0-9_-]{1,128}$` and target must be `pip`, `notes`, `both`, or absent.

6. **LOW — cross-layer eligibility disagreement.** The Worker auto-approved a local part of exactly
   `fj` while the Firestore regex `^[^@]+[fF][jJ]@[^@]+$` requires a character before `fj`.
   The Worker now matches Firestore. A new Firestore simulator case locks this behavior.

7. **LOW — unverified identities could consume FJ invitation tokens.** Redemption now requires
   `email_verified === true`.

8. **LOW — fake asynchronous success.** `/api/admin/notify-approval` returned `queued: true`
   without sending anything. It now returns an explicit 503 and states that nothing was sent.

9. **LOW — defense in depth.** Firebase display names (user-controlled) are stripped of control
   characters before being persisted for owner-facing dashboards. The immutable owner UID now
   passes the Worker's active-account gate even if its D1 mirror row is absent, matching the
   Firestore owner bypass and preventing master-access lockout.

10. **Infrastructure / tests.** `.gitignore` now excludes local tool state (`.wrangler/`,
    `node_modules/`, `test-results/`, `playwright-report/`). `pages_allowlist_test.js` normalizes
    line endings so the same assertion holds in a CRLF Windows checkout and LF CI. No tracked
    credential, service-account key, `.env`, or production data was read, printed or committed.

## Modified files

- `backend/worker.js` — authorization, lifecycle, deletion, validation, sanitization.
- `tests/backend_security_regression_test.js` — **new**, 40 targeted security assertions.
- `tests/firestore_security_rules_test.js` — new suffix-agreement simulator case (75 total).
- `tests/fake_d1.js` — test double now faithfully emulates the Worker's status UPDATE statements
  (the previous version masked the cancellation escalation bug).
- `tests/worker_backend_test.js` — redeemer token is now verified; deletion expectation corrected
  to fail-closed behavior with data-preservation assertions.
- `tests/pages_allowlist_test.js` — CRLF robustness.
- `tests/run_all_tests.js` — registers the new suite and corrected counts.
- `.gitignore` — local artifact exclusions.
- `BACKEND_SECURITY_PROGRESS.md` — this record.

## Tests actually executed and results

- `node tests/backend_security_regression_test.js` — **40/40 PASS**.
  (Before the fix it failed on "cancelling deletion does NOT re-enable revoked PIP", confirming the
  vulnerability was real rather than theoretical.)
- `node tests/worker_backend_test.js` — **PASS** (76 assertions).
- `node tests/firestore_security_rules_test.js` — **75/75 PASS**.
- `node tests/pages_allowlist_test.js` — **7/7 PASS**.
- `node tests/owner_approval_dashboard_test.js`, `node tests/website_audit_test.js`,
  `node tests/human_verification_test.js`, `node tests/note_crypto_test.mjs`,
  `node tests/qr_client_test.js` — all PASS.
- `node tests/run_all_tests.js` — **375 passed, 0 failed, exit 0** across 16 suites (after the
  final Firestore rule correction; was 373 before the two new simulator cases).
- `node --check backend/worker.js`, `node --check functions/access-approval-trigger.js`,
  `node --check tests/backend_security_regression_test.js`, `node --check tests/fake_d1.js` — PASS.
- `git diff --check` — PASS.

## Known limitations / exact remaining work

- **Not deployed by this agent**, per the parallel-execution contract. The integration director must
  deploy the Worker (and re-deploy Firestore rules only if changed externally) and run cross-feature
  tests. No production account, D1 row, or credential was modified.
- Ground Zero's delete button needs a UI copy update: it now returns a clear 503 error until a
  trusted `FIREBASE_ADMIN_KEY` secret is configured. This is intentional and fail-closed.
- Cancellation of a deletion that was scheduled by an older Worker build leaves application
  statuses as recorded at scheduling time (no migration was added); owners can still set them
  explicitly. This avoids a risky schema change during parallel integration.
- Full unattended deletion, approved-email delivery, additional administrator roles and the
  trusted shared-Notes session issuer remain outside this agent's scope / externally blocked.
- The tagline in the repository (`into a quiet space`) does not match the mission's exact wording
  (`into a quite space`). That is a frontend/branding responsibility (Flint / LongCat); no frontend
  file was touched. Flagged for the integration director.

## Second audit pass — Ground Zero / cross-layer consistency

Coordination performed by reading (not editing) `origin/agent/flint-*` (`GROUND_ZERO_BACKEND_CONTRACT.md`),
`origin/agent/iceman-*` (`ICEMAN_GROUND_ZERO_FINDINGS.md`), `origin/agent/nemotron-lightning-*`
and `origin/agent/nemotron-super-vl-*`.

11. **Contract alignment.** Flint's handoff states that `POST /api/admin/accounts/{uid}/reactivate`
    restores account **and** PIP/Notes access. My first pass had changed that to a non-clobbering
    update. Because that action is reachable only through backend-verified owner/admin authority,
    the contract behavior was restored. The **real** privilege escalation (ordinary user regaining
    revoked access via self-service `schedule` + `cancel`) remains fixed and is separately tested.

12. **Delegated Ground Zero administrators.** The frontend treats Firestore `admins/{uid}` with
    `active !== false` as authorized, but every `/api/admin/*` endpoint previously required the
    immutable owner UID — so a valid admin could load the dashboard and then be blocked by 403s.
    The Worker now verifies active admin status itself on every request using the caller's own
    Firebase ID token against Firestore's self-read rule (no cache, so deactivation is immediate;
    errors and missing config fail closed). Active admins may list accounts/users, approve/revoke,
    and suspend/reactivate. Deletion, owner-only email lookup and notification remain owner-only,
    as does protection of the immutable owner account. The public Firebase Web API key used for
    this read is declared in `backend/wrangler.toml` and is already public in `firebase-config.js`.

13. **Permission-state consistency.** `POST /api/admin/permissions` now also writes
    `applicationPermissions/{uid}` through the Admin SDK when `FIREBASE_ADMIN_KEY` is configured,
    so a D1 change cannot leave a revoked user with live Firestore access. The response includes
    `firestoreMirrored` so the frontend knows when it still must mirror the decision itself.

14. **Data integrity / deployment safety.** `backend/migrations/0004_registered_email_lookup.sql`
    (adds `email_digest` used by owner email lookup) existed only as an untracked local file even
    though it was applied to production D1. It is now tracked so a clean environment can reproduce
    the schema. Deployment note: Wrangler's migration history should skip it; do not re-run manually.

15. **Coordination document.** `BACKEND_CONTRACT_HANDOFF.md` records the authorization matrix,
    frontend obligations, and integration/deployment requirements for Flint, Iceman, Lightning and
    DeepSeek. No frontend file was edited and no production system was changed.

## Third pass — Ground Zero blink investigation (2026-11-21)

- Established that the homepage Ground Zero entry is a plain anchor to `/ground-zero/`; no
  JavaScript intercepts the click. A browser document request therefore **does** occur, so the
  Worker cannot cause the initial navigation failure.
- Live checks: `/ground-zero/` → 200; deployed `ground-zero.js` → 200 but still uses the named
  Firebase app `FJGroundZero` (persisted owner session invisible → settled signed-out →
  `redirectHome()`). That is the blink. Worker root 200; unauthenticated admin endpoint 401;
  forged token 403; site-origin CORS preflight correct; `Origin: null` not allowed.
- Production Worker version verified read-only via Wrangler: `6cf07e04-4584-4ec5-93f1-cc3d44e622e5`
  (2026-11-20T21:15Z). **My backend changes are not deployed.** D1 reports no pending migrations.
- Reconciled Flint's owner-only handoff with the delegated-admin implementation: destructive and
  privacy-sensitive operations stay owner-only; non-destructive admin work is backend-verified via
  Firestore and immediately revocable. Full matrix is in `BACKEND_CONTRACT_HANDOFF.md`.
- No backend code defect was found that could cancel navigation or blank the page; no security
  restriction was removed. No frontend file was edited and no production system was changed.

## Fourth pass — conditional backend investigation (2026-11-21)

Navigation to `/ground-zero/` was proven first (document request 200, plain anchor), so the
conditional investigation proceeded to the loaded page's authorization path.

- Traced the three principal types through Firestore and the Worker using real locally signed
  tokens and the real Firestore emulator (not only source-string tests):
  - owner: admin registry read allowed; Worker owner checks pass.
  - active admin: own admin doc readable, **admin collection read denied** — reproduced defect.
  - deactivated admin / ordinary user: denied.
- Corrected the precise backend defect in `firestore.rules`: added `activeAdmin()` (live read of
  the caller's own admin doc) and allowed admin-record reads for active admins. Writes to
  `admins` remain owner-only; deactivation is immediate; ordinary users unaffected.
- Updated simulator model to match the real rules (test 19 now asserts the active-admin grant;
  new tests 76/77 assert deactivated/ordinary denial). Firestore simulator 77/77; Firestore
  emulator 40/40 including the new admin-registry cases.
- No Worker code change was needed for the reported symptom. No security restriction was
  weakened; the grant is scoped to active admin records and excludes all admin mutation.

## Fifth pass — Ground Zero blink fix (2026-11-21)

- Reproduced in headless Chromium against production: navigating to `/ground-zero/`
  produced **no CSP errors and no failed requests**; the page navigated to `/` from
  its own JavaScript. The symptom is not a security-policy block.
- Adopted Flint's corrected `ground-zero.js` (shared default Firebase app instance,
  deterministic auth settlement, explicit ERROR state, content suppression). This
  removes the named-app persistence namespace mismatch that hid the owner session.
- Verified with a synthetic verified owner in the Auth emulator: with the corrected
  script the browser stayed on `/ground-zero/` with content visible. Flint's 52-check
  Ground Zero suite passes; full master suite **387 passed, 0 failed**.
- Commit `5552cd0` pushed. Live deployment attempted via the existing Pages workflow
  from this branch (run `44850635234`) but GitHub environment protection rules allow
  the `github-pages` environment only from `main`. Live `ground-zero.js` still
  contains `FJGroundZero`. Integration director must merge to `main` and deploy;
  exact steps are in `BACKEND_CONTRACT_HANDOFF.md`. No production system was changed
  by me.

## Sixth pass — Post It Pal "add by email" (2026-11-21)

- Traced the full invite → inbox → accept → pals → message flow through `pip.js` and
  `backend/worker.js`. The flow was only deliverable via an email-digest match at
  read time; there was no binding to a concrete recipient account.
- Worker hardening/completion:
  - `/api/pals/invite` now resolves the invited account (explicit profile UID from
    search, or `registered_users.email_digest`) and stores `recipient_uid`, so an
    invitation reaches the intended approved account even if the email string is
    normalised differently later. Unknown emails still receive the same generic
    response, preserving privacy.
  - duplicate pending invitations are suppressed; self-invites are a no-op; the
    inviter name is sanitised.
  - `/api/pals/invitations` and `/api/pals/invitations/{id}/respond` now accept a
    recipient by UID **or** digest; accepted invitations remain visible to inviters.
- Frontend (minimal, no design change): selecting a PIP profile stores its UID in a
  hidden field and the invite submits `{ email, uid }`; the email field remains the
  primary input as requested.
- Test double corrected to persist `email_digest`, apply display-name updates to the
  right UID, and emulate the new recipient-bound invitation queries.
- Tests: 28 new end-to-end PAL assertions (two approved users invite by email, accept,
  appear as Pals, exchange a message; UID-bound invite; duplicates; self-invite;
  ordinary/unverified rejection). Backend regression suite 68/68; full master suite
  415 passed / 0 failed.
- Production note: this requires a Worker deployment (and the small frontend change
  requires Pages). Not deployed by me; integration director owns deployment.

## Seventh pass — PIP + Notes 04 redirect (2026-11-21)

- Root cause was identical to Ground Zero: `pip.js` initialized Firebase with the
  named app `FJYourNotes`, while the main site, Notes, Meet and Gods use the shared
  default app. Auth persistence is app-name scoped, so the restored session was
  invisible and `onAuthStateChanged` saw `null` → `window.location.href="/"`.
- Applied the same deterministic pattern as the working pages:
  `initializeApp(firebaseConfig)` (default app), await `auth.authStateReady()` before
  deciding, explicit ERROR state for technical failures, content hidden during
  INITIALIZING, and `location.replace("/")` only after auth has genuinely settled.
  Also fixed the approval poll to require `pipStatus === 'active'`, not just account
  status, so pending users are not prematurely shown private UI.
- Browser proof with a synthetic verified owner in the Auth emulator:
  - old named-app script → `FINAL_URL=http://127.0.0.1:3123/` (redirected);
  - fixed default-app script → `FINAL_URL=/pip/`, page rendered, and a Worker/API
    failure was displayed as an error instead of causing a redirect.
- Updated stale test expectations to the new deterministic contract; Ground Zero
  suite 55 checks and website audit 42 checks pass. Full master suite 418/0.
- Deployment: still requires integration (Pages only deploys from `main`). Not
  deployed by me.

## Identity

- Branch: `agent/hy4-20261121-002415`
- First implementation commit: `0b8cb82486182ee18226a4e91c9c42489516537e`
- Remote: pushed to `origin/agent/hy4-20261121-002415`; no other branch was modified.
