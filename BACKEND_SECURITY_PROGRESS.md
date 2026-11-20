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
- `tests/backend_security_regression_test.js` — **new**, 24 targeted security assertions.
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

- `node tests/backend_security_regression_test.js` — **24/24 PASS**.
  (Before the fix it failed on "cancelling deletion does NOT re-enable revoked PIP", confirming the
  vulnerability was real rather than theoretical.)
- `node tests/worker_backend_test.js` — **PASS** (76 assertions).
- `node tests/firestore_security_rules_test.js` — **75/75 PASS**.
- `node tests/pages_allowlist_test.js` — **7/7 PASS**.
- `node tests/owner_approval_dashboard_test.js`, `node tests/website_audit_test.js`,
  `node tests/human_verification_test.js`, `node tests/note_crypto_test.mjs`,
  `node tests/qr_client_test.js` — all PASS.
- `node tests/run_all_tests.js` — **357 passed, 0 failed, exit 0** across 16 suites.
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

## Identity

- Branch: `agent/hy4-20261121-002415`
- Commit: see `git log -1` on this branch (final implementation commit).
