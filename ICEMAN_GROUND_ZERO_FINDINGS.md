# Ground Zero Joint Findings (Iceman, for Nemotron Lightning & Integration Director)

## Scope and context
- Task: stop design-only scope and help Nemotron Lightning fix Ground Zero owner accessibility.
- Environment limitation: I cannot perform authenticated live-browser verification against https://faissalness.github.io/ as the actual owner from this environment. I did not fabricate live verification. Findings below are based on repository/code inspection, branch review, and static/contract tests.

## Review of Nemotron Lightning's current work
- **Branch:** `agent/nemotron-lightning-20261121-002415` (remote/local present)
- **Commit:** `f3f94e6` — *"Fix Ground Zero auth flash: wait for authStateReady() before decisions; hide content during INITIALIZING"*
- **Files changed:** `ground-zero.js` only (vs main).
- **What Lightning tried/changed:**
  - Always awaited `auth.authStateReady()` (with polling fallback for limited SDKs) before authorization decisions in `onAuthStateChanged`, including the user-present path.
  - Hid hero/page content during loading (`gzDisplayLoading`) and showed content after authorization (`gzShowContent`) to prevent title flash.
  - Kept existing owner/admin authorization logic and redirect behavior.
- **Assessment:** This improves settlement timing and removes visual flash, but **does not address persisted-session visibility** because the page still used a custom named Firebase app instance (`initializeApp(firebaseConfig, "FJGroundZero")`). That means auth persistence is namespaced separately from the main site, so a restored owner session created on the default app may not be visible to Ground Zero.

## Related work reviewed (other agents)
- **Flint (`agent/flint-20261121-002415`, `72a4dd0`):** identified/fixed the likely root cause by switching Ground Zero to the **shared default Firebase app instance** (`initializeApp(firebaseConfig)`), added deterministic settlement/error handling, denied deactivated admins, updated `tests/ground_zero_test.js` (46 checks), and added `GROUND_ZERO_BACKEND_CONTRACT.md` / progress updates.
- **Current deployed/mainline baseline inspected:** `main`/`7560918` Ground Zero used named app `FJGroundZero` and redirected on settled-null user; this can produce "title flash then redirect to homepage" when persisted session is not found in that app namespace.

## Independent investigation (end-to-end chain)
- **HTML/entry:** `ground-zero.html` loads `ground-zero.js` as module; clean route `/ground-zero/` is published by Pages workflow (`dist/ground-zero/index.html` with `<base href="/">`), and `ground-zero.js`/`styles.css` are in the public allowlist/root artifact. No service worker found.
- **Firebase init/config:** `firebase-config.js` exports shared config and immutable `ownerUid` (`hDbzbNTC7pOuU2UFCjFksopbgaG3`). `app.js`, `notes.js`, `private-page.js` use the **default** Firebase app instance; `pip.js` uses named `FJYourNotes`. Ground Zero on main used named `FJGroundZero` (separate auth persistence namespace) — **primary suspected redirect initiator condition**: settled auth state appears unauthenticated in GZ app -> `redirectHome()` to `/`.
- **Redirect initiators found:** `ground-zero.js` `redirectHome()` -> `window.location.href = "/"` on `UNAUTHORIZED` (no settled user, or non-owner/non-authorized admin). `private-page.js` redirects exist for meet/gods pages but is **not** loaded by `ground-zero.html`.
- **Authorization chain in GZ:** after auth settlement, owner UID match bypasses app/permission state; otherwise loads Firestore `admins` collection and requires active admin record (`active !== false`). Account data/actions go through Worker (`/api/admin/accounts`, `/api/admin/permissions`) with bearer token; owner-only enforcement is in backend (separately reviewed via tests/contracts). Technical auth errors surface as `ERROR` (not redirected as signed out).
- **Caching/routing notes:** cache-busted asset query params present; deploy workflow rewrites `/ground-zero/` route. No competing client-side redirect logic found in GZ page besides explicit unauthorized redirect after settlement.

## Actual/most-likely root cause (evidence-based)
1. **Auth persistence namespace mismatch (high confidence, primary):** Ground Zero initialized Firebase with a custom app name (`FJGroundZero`) while sign-in/session restoration on the main site used the default app. Firebase auth persistence is app-name scoped, so Ground Zero could not observe the owner's persisted session and treated the settled state as signed-out -> redirect to homepage (with initial title render/flash). This directly explains the reported live symptom.
2. **Settlement/timing handling (secondary, addressed in prior attempts):** needed to wait for deterministic auth settlement and avoid acting before restore; Lightning/Flint/main iterations addressed this partially/fully, but without (1) owner session still may be invisible.
3. **UX flash (secondary):** content visibility during initialization could flash before redirect/decision; Lightning added hiding (useful) but not sufficient alone.

## Changes implemented on my branch (coordination/fix adoption)
- **Adopted Flint's corrected Ground Zero auth implementation and strengthened tests** on `agent/iceman-20261121-002415`:
  - `ground-zero.js`: use shared default Firebase app instance for auth state (same persisted session as main site), deterministic `auth.authStateReady()` settlement, explicit state handling (`INITIALIZING/AUTHENTICATED/AUTHORIZED/UNAUTHORIZED/ERROR`), deactivated-admin denial, and technical errors surfaced without redirect-as-signed-out. (Added safe try/catch around localhost emulator connects.)
  - `tests/ground_zero_test.js`: updated to Flint's stricter 46-check contract (shared default app, no custom name, no polling delays, deterministic states, deactivated-admin denial, plus existing route/access/permission/action/endpoint assertions).
- **Intent:** align with the most evidence-backed fix and avoid duplicate/conflicting partial fixes. Nemotron Lightning's hiding/settlement intent is compatible; the critical missing piece was shared app/persistence.

## Tests executed (this environment)
- `node tests/ground_zero_test.js` — **PASS** (46/46) after adopting fix.
- `node tests/website_audit_test.js` — **PASS** (41/41) after GZ changes.

Not executed here: full master suite in complete env, Firebase emulator/browser E2E, Worker runtime against live services, or live production owner-access verification.

## Unavoidable verification limitation
- **Cannot confirm live owner acceptance from this environment:** I do not have authenticated browser access/session for the actual owner UID `hDbzbNTC7pOuU2UFCjFksopbgaG3` on https://faissalness.github.io/. Therefore I **cannot** claim the absolute acceptance condition is met on production. The fix is evidence-based and passes static/contract tests, but **real browser evidence is required**.

## Required live verification (integration director / owner-capable tester)
On https://faissalness.github.io/ as the actual owner:
1. Sign in on main site (default app session established), navigate/open **/ground-zero/** directly — must remain on Ground Zero (no redirect to `/`).
2. Refresh on Ground Zero — must remain authorized.
3. Navigate away/back and use dashboard actions — UI functional, API calls authorized.
4. Confirm unauthorized users/admins-without-active-access are denied and genuine technical errors are shown as errors (not misreported as signed-out).

## Recommendations / remaining investigation if issue persists live
- Capture Network/Console/Application storage on live `/ground-zero/`: confirm `ground-zero.js` served is the fixed build (default app, no `FJGroundZero`), check auth currentUser after `authStateReady()`, Firestore `admins/{uid}` read result, and Worker `/api/admin/accounts` response/status.
- Verify deployed Pages artifact includes updated `ground-zero.js` at root and routed `/ground-zero/` page references it correctly under `<base href="/">`.
- Check for stale CDN/browser cache despite cache-busting query params; compare response bodies/hashes.
- If still redirected while `auth.currentUser` is correct owner, trace exact redirect initiator in live bundle (should only be unauthorized path) and inspect admin/worker authorization responses.

## Coordination notes for Nemotron Lightning
- Your `f3f94e6` improved settlement/flash handling; the likely missing root-cause fix is **shared default Firebase app instance** so GZ sees the same persisted owner session as main site. Recommend aligning on Flint's/Iceman-updated implementation + 46-check test expectations, then focusing on live deployment/artifact/cache verification and real-browser evidence for acceptance.
- Avoid reintroducing named app `FJGroundZero` for Ground Zero unless persistence is explicitly shared via supported mechanism.

## Branch status
- My branch with adopted fix/tests: `agent/iceman-20261121-002415` (commit/push state recorded in git; see latest commits on branch).
