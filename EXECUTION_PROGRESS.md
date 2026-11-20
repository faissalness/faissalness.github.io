# FJ website execution progress

Updated: 2026-11-19 (Europe/Stockholm)

## Repository

- Existing project: `C:\Users\faiss\OneDrive\Desktop\FJ-website`.
- Repository `main` and `origin/main` were synchronized at `ba7c957cf7821e6c00cae4595d1bc88969bf53b2` when this continuation resumed. No pending repository commits existed at that point. Existing untracked config, backups and local state remain untouched.

## Latest local checks

- `node tests/run_all_tests.js`: 194 passed, 0 failed after the D1-backed Worker and Post It Pal changes. This includes 57 Firestore logic simulator cases, 49 Worker backend assertions, 38 website checks, 10 independent QR decodes, tab-scoped human verification, account lifecycle, and deployment allowlist checks.
- Firestore Local Emulator Suite: 27/27 actual rules-unit tests passed, covering UID isolation, role injection, owner session absence/forgery, deletion scheduling, suspension, cancellation, deadline enforcement and cleanup. The test script passed; Firebase CLI exits 1 afterward due its local update-check/config-store error.
- Syntax checks passed for `app.js`, `notes.js`, `pip.js`, `qr-tech.js`, `qr-url.js`, and `backend/worker.js`.
- `git diff --check` passed.

### Authentication emulator verification — 2026-11-19

- Status: COMPLETE AND VERIFIED for emulator workflows.
- Master command: `powershell -NoProfile -ExecutionPolicy Bypass -File tests/run_emulator_tests.ps1`
- Synthetic accounts: 3 independent browser/Auth identities.
- Auth lifecycle: 18/18 emulator workflows passed, including verification/reset action-link capture, password reset, tamper rejection and reused-code rejection.
- Firestore authorization: 30/30 emulator rules checks passed.
- Playwright isolation: 1/1 test passed across separate browser contexts.
- CI workflow: emulator test workflow was added; Playwright test dependency and environment propagation were corrected after a concrete missing-module failure.
- Emulator CI run `44568895435` completed successfully at commit `720d94f3daa97c2a6b6b59071ae537c6ebe02aae`.
- Production Auth audit: project, CLI access and 4-account production inventory verified. Real production inbox delivery remains not tested without a controlled mailbox/test identity.

### Authentication emulator and production audit — 2026-11-19

- Added fixed Auth emulator port 9099 and Firestore emulator port 8080 in `firebase.json`.
- Added `tests/auth_emulator_test.mjs`: three synthetic accounts, independent sign-in, verification action links, password-reset action links, reset completion, old-password rejection, tampered-code rejection and reused-code rejection.
- Master emulator command: `powershell -NoProfile -ExecutionPolicy Bypass -File tests/run_emulator_tests.ps1`
- Actual emulator results: 18/18 Auth lifecycle workflows passed; 30/30 Firestore rules checks passed.
- Synthetic accounts and emulator state are cleaned/exported locally; no production account is created or deleted.
- Added `tests/production_auth_config_test.mjs` and `tests/browser_emulator.spec.js`; added CI workflow `.github/workflows/emulator-tests.yml`.
- Production Auth inventory exported successfully: 4 existing production accounts, no modifications.
- Production email/provider settings are not considered delivery-verified. Firebase built-in email delivery remains available only when enabled/configured in the Firebase Console; inbox delivery requires a real mailbox or controlled test identity.

### Production verification after commit c20f21c

- GitHub push succeeded; GitHub Pages Actions run `44553272564` completed successfully.
- GitHub Pages workflow head commit: `c20f21ccf034566b6149c343a8f9722b7e4e5d5d`.
- Live homepage `/` and `/pip/` return HTTP 200.
- Live `/pip/` contains the deployed Trash and Post It Pal artifact markers.
- `/backend/worker.js` and `/firestore.rules` remain unavailable as public Pages artifacts.
- Cloudflare root and public count endpoints return HTTP 200.
- Forged bearer tokens to `/api/pals` and `/api/notes/verify` return HTTP 401.
- Unauthenticated Firestore REST reads to `yourNotes` and `privateNotes` return HTTP 403.
- Git commit `c20f21c` (`Complete secure approval, Trash, and scheduled cleanup`) is pushed to `origin/main`.

### Remaining externally dependent limitation

- Full Firebase Auth and Firestore data erasure cannot be made unattended without a trusted Firebase Admin SDK credential/service in the deployment environment. The existing reauthenticated manual account deletion remains; it is not safe to invent or bypass that credential boundary.

### Live restoration pass on 2026-11-19

- Status: INCOMPLETE pending final frontend push and real multi-user production verification.
- Root diagnosis: PIP registration previously created a Firebase identity but did not consistently establish a Firestore profile, access request, or trusted D1 application permission. Returning-user PIP sign-in had no password-only remembered-device state.
- Root diagnosis for pages: the original Meet/Gods markup and CSS exist in Git history and local CSS, but live route stylesheet references and authorization reveals could leave the presentation degraded or hidden.
- Restored the original Meet Me and To the gods structures and recovered dark futuristic CSS from commit `878a589`; routes now use cache-busted absolute stylesheet URLs.
- Added `/pip/` remembered-account password-only Firebase sign-in with account switching. The password field reuses Notes 03 `.neon-gate-input` styling.
- Added independent D1 `pip_status` and `notes_status` migration `0005_application_permissions.sql`.
- Added owner-only `/api/admin/lookup` and `/api/admin/permissions` enforcement.
- PIP registration now creates standard unapproved Firestore profile and pending access-request documents.
- D1 migration 0005 applied and Worker deployed as version `d6679817-a9ac-46cf-9aac-81cc29c8cd4b`.
- Focused workflow, Worker and website audit suites pass.

- Worker version `bf0ef511-b0b8-43d3-a693-0dba41e675c9` deployed with migration `0006_social_posts_trash.sql`.
- Live unauthenticated `/api/posts` GET/POST probes return 401.
- Worker version `fee16cbb-1cc1-4e07-a05a-78fb5598702e` deployed with migration `0007_backfill_application_permissions.sql`.
- Added privacy-safe `/api/profiles` lookup and authenticated `/api/pals/{uid}` removal routes.

### Final deployed frontend on 2026-11-19

- GitHub Pages run `44562840179` succeeded for commit `e19c9f4bd4eddefcd959fab5c0e34c5d7c886e04`.
- Live `/meet/` and `/gods/` return 200 and contain recovered original layout markers.
- Live `/pip/` contains returning-password, profile-search, Feed, and Pal interaction markers.
- Live Playwright desktop/mobile screenshots confirmed dark PIP/Notes presentation and neon Notes gate.
- Live forged profile and Pal-removal requests return verified-sign-in 401 responses.
- Automated suite: 213 passed, 0 failed.

### BLOCKED BY EXTERNAL REQUIREMENT

- Actual registration/email-verification/password-reset delivery and two/three separate user browser sessions require independent Firebase test identities and provider email delivery. No private credentials or test accounts should be fabricated or exposed in chat.
- Live Playwright screenshots confirm dark desktop Meet and Gods gates, mobile PIP layout, and the Notes 03 neon-green gate.
- A local run of the Pages allowlist assembly succeeded: 26 files, five clean route aliases, no Worker/source-map markers.
- QR test independently decoded the JavaScript-generated QR matrix to the exact test URL and covers unsafe URL rejection.
- PIP page was visually checked at 390px mobile width; navigation, sign-in and account creation cards fit the viewport.
- Human-check success is now bound to a per-tab `window.name` identifier as well as `sessionStorage`, so a copied session marker in a newly opened tab does not satisfy the check.
- QR-tech now chooses a high-contrast accent color for each newly generated QR and prevents immediate repeat colors; the four-module quiet zone remains in place.
- All public HTML pages now carry a restrictive CSP meta policy and a referrer policy; the CSP allows only the Firebase/Wikipedia endpoints and Google Fonts actually used by the site.
- Your Notes supports a 30-day deletion request, immediate rules-enforced note suspension, cancellation during the grace period, and reauthenticated permanent deletion after the deadline. The user must sign in and confirm after 30 days; no unattended scheduler is present or claimed.
- Cloudflare Worker now uses D1-backed persistent password hash, brute-force counters, sessions and invitation digests. No production state is stored in isolate-local Maps. D1 migration `0001_security_state.sql` was applied remotely and Worker version `9eff9bf6-9090-49a3-bc9f-fd5ba50b0ffb` deployed to `https://fj-api.jimyass.workers.dev`.
- D1 migrations `0001_security_state.sql`, `0002_pip_social.sql`, and `0003_request_indexes.sql` are applied remotely. A randomly generated HMAC key is stored as a Cloudflare Worker secret (not in source, Git, logs, or chat). Latest Worker version `e71a7ccb-9774-467b-b5f0-d3bf1b7af10c` is deployed at `https://fj-api.jimyass.workers.dev`.
- Production probes against latest Worker: root `200`; public aggregate count `200` and reveals only `count`; forged owner token to `/api/notes/verify`, `/api/pals`, and `/api/pals/invite` each `401`, all `Cache-Control: no-store`.
- Worker-backed PIP now has privacy-preserving email invitations (constant response whether account exists), mutually accepted Pals, authenticated private message reads/writes, unread counts/Noty, message and invitation rate limits, active verified-account aggregate count, and account deletion suspension/cancellation plus confirmed removal of D1 social/count records after the 30-day deadline. These routes are not yet deployed with the frontend; Pages publishing is pending the next Git push.
- Firebase Firestore emulator run completed all 27/27 rules tests. Firebase CLI emitted its known local config/update-check error only after the test runner exited successfully.
- Live routes checked: homepage `/` `200`, `/pip/` `200`, `/qr/` `200`, `/backend/worker.js` `404`. GitHub Pages was already current through `ba7c957`; no pending Pages commit existed at resume.
- Verified Cloudflare free-tier D1 is offered with enforced daily row read/write limits; over-limit D1 requests fail until reset. No paid service was enabled.

## Production evidence

- Latest public GitHub Pages Actions run for `2cca634` completed successfully. Live homepage and `/qr/` return 200. `/backend/worker.js`, `/backend/worker.js.map`, and `/firestore.rules` return 404. `/pip/` remains 404 because the local PIP implementation has not been published.
- Live Worker root returns HTTP 200 `{"status":"FJ API Operational"}`. A fresh production forgery probe used correct project claims, a real Google key ID, and an invalid 256-byte signature; Worker returned HTTP 401, `{"error":"Access denied"}`, `Cache-Control: no-store`.
- Firebase rules deployment printed compile, release and `Deploy complete` after closing the missing-session and client-writable-session bypasses. The CLI still exits 1 after deployment because its local update-check/config store fails. Production unauthenticated REST probes for `privateNotes`, `activeNotesSessions`, the `yourNotes` account document and notes all return 403 `PERMISSION_DENIED`.
- Updated account lifecycle rules also compiled and released successfully. The Firebase CLI still exits 1 after the release because its local update-check/config store fails.

## Work implemented locally

- Added QR-tech 05, safe HTTPS destination validation, SVG download, clean `/qr/` route, and clean route aliases for Meet, Gods, and Notes.
- Added auth-pending first-paint suppression and removed the authenticated reload flash; same-tab verification survives reload and new tabs require verification.
- Invitation redemption now requires a cryptographically verified Firebase ID token and uses its UID rather than a caller-provided UID.
- Original owner Notes and its shared-password configuration are restricted to the owner; Worker Notes verification rejects non-owner Firebase identities. The missing-session bypass is now closed; trusted persistent session issuance is still not connected to Firestore.
- Firestore now fails closed: a missing active-session document no longer grants access, and browser clients can no longer create, update, or delete session records. A trusted Admin SDK session issuer is not connected, so original owner Notes is unavailable until that backend is implemented and deployed. The current Worker still has isolate-local state and is not an adequate persistent session issuer.
- Added PIP / Your Notes registration, sign-in, email verification, generic reset response, duplicate-account message, per-UID note CRUD and the manual-confirmation 30-day deletion workflow. Firestore rules scope each account to its own notes. Separate app passwords, note-level passwords, administrators for personal applications, unattended deletion, public user count, and Post It Pal remain outstanding.

## Deployment access

- GitHub Pages is configured for GitHub Actions and currently published through `ba7c957`. GitHub Actions run `44440065298` succeeded.
- Refreshed Cloudflare authentication was available. Wrangler 4.164.0 created D1 database `fj-api-state` (database ID `3f4828b7-8c5f-4725-b801-3d2bea416312`), applied its migration remotely, and deployed `fj-api` successfully.
- Wrangler logging was redirected into the writable task work folder; no credential contents were printed or saved in the repository.
- After commit `4b8683f`, `git push origin main` failed inside this restricted shell: Git Credential Manager could not start its MSYS child (`NtCreateDirectoryObject ... 0xC0000022`), then Git had no terminal username. No remote history changed. The native Git Credential Manager window is waiting at “Connect to GitHub”; computer-use policy prevents me from operating that authentication dialog. Run `cd "C:\Users\faiss\OneDrive\Desktop\FJ-website"; git push origin main` in a normal PowerShell window. Expected: commit `4b8683f` reaches `origin/main` and GitHub Actions starts the allowlisted Pages deployment.

### Continuation on 2026-11-18

- Committed reviewed frontend, workflow, Worker, rules, and test changes as local commit `142db21` (parent `2cca634`). The user-owned untracked configuration, task text, backups, and `.wrangler` state were not staged.
- Follow-up execution record is commit `6823b1d`; tab-scoped human verification is `02d0ba6`; QR color behavior and regression coverage are `ec4945b`.
- CSP policy and website audit assertion are committed as `161de8e`; the deletion flow/rules/tests are committed as `29756a7`.
- That historical push attempt failed before authentication; the user subsequently refreshed GitHub auth and pushed the work. Current remote is synchronized at `ba7c957`.
- Firebase rules were released successfully (CLI printed `Deploy complete!`); the process then exited 1 from the local Firebase CLI update-check/config-store failure. Live unauthenticated REST checks return 403 for protected collections.
- Cloudflare OAuth remains expired. `wrangler whoami` previously reported the expired token, so the current local Worker changes have not been deployed.

### Continuation on 2026-11-19

- Committed the D1-backed Worker, migration files, PIP/Post It Pal UI, public aggregate counter and regression tests as `4b8683f` (parent `ba7c957`). Existing untracked `.firebaserc`, task text, backup files and `.wrangler` directory were not staged.
- `git push origin main` failed before authentication because Git Credential Manager's process could not start in the restricted shell. `origin/main` remains `ba7c957`; commit `4b8683f` is local and Pages has not deployed the new frontend.
- The actual Worker and D1 migrations are already deployed at `https://fj-api.jimyass.workers.dev`; latest Worker version is `e71a7ccb-9774-467b-b5f0-d3bf1b7af10c`.
- Master test suite: 194/194 passed. Firestore emulator: 27/27 passed; Firebase CLI emitted an update/config store error after test completion.

## Next operations

1. Finish the separate Your Notes app password and note-level password protection.
2. Implement complete per-user administrator permissions, consented last-seen/profile pictures, attachment and offline protections, and approval email jobs.
3. Implement and test an unattended full account deletion mechanism that removes Firebase Auth, Firestore notes and related records after the grace period. Current Worker cleanup only handles its D1 Post It Pal records after the user confirms; it is not unattended and does not delete Firebase records.
4. Connect the original owner Notes page to a trusted Firebase session issuer. Current Firestore rules intentionally fail closed; Worker D1 sessions are not Firestore Admin SDK sessions.
5. Push the current implementation, wait for Pages Actions, visually and functionally verify live `/pip/` and homepage changes, then repeat production security probes.

## Completion

Incomplete. The production Worker now includes D1-backed PIP social and count routes, and Worker probes reject forged tokens. `/pip/` and `/backend/worker.js` were verified before the current unpushed frontend additions; the newly implemented Post It Pal and count UI are not live until the pending Git push and Pages workflow complete. Original owner Notes remains fail-closed pending a trusted Firebase session issuer. Separate Your Notes password, note-level passwords, full admin permissions, unattended complete deletion, approval emails, consented last-seen/profile pictures, attachment/offline security, and integrated FJ-shaped QR remain incomplete. End-to-end master acceptance has not passed.

### Continuation on 2026-11-19 (security regression + encrypted notes)

- Removed the self-service registration shortcut that treated an email ending in `fj` as approval. All valid email addresses now follow the same pending, owner-reviewed path; no email suffix can set `approved: true` or `status: approved`.
- Added an authorization regression suite to assert that the registration flow always creates an unapproved profile and pending access request, and never approves based on suffix. Full local suite: **213 passed, 0 failed** across 13 suites. `git diff --check` passed.
- Per-note Your Notes encryption is implemented locally using PBKDF2-SHA256 (210,000 iterations) and AES-256-GCM; a Firestore envelope stores ciphertext only. The local test suite covers encryption/decryption and malformed ciphertext. Firestore simulator and emulator coverage now includes the encrypted envelope and plaintext rejection; latest emulator result previously recorded: 30/30 passed. Re-run the emulator after final rule changes before release.
- Firestore rules deployment earlier printed `Deploy complete`; unauthenticated production REST probes denied private collections. Confirm exact latest rule deployment state after publishing changes.
- Latest source changes are uncommitted, while commits `4b8683f` and `ba3788c` are local ahead of `origin/main`. Only explicitly reviewed source/test/progress files will be staged; existing untracked user files and backups remain untouched.
- Still incomplete: original master requirements include integration of a server-issued Your Notes app password/session with Firestore; full per-user application administrator permissions; unattended Firebase Auth + Firestore account deletion; durable approval-email delivery; profile image and consented last-seen handling; attachment/offline safeguards; and full production end-to-end PIP/QR verification. Current Worker deletion cleanup is confirmed only for D1 social/count records and currently requires user confirmation; it is not unattended full Firebase deletion. Do not report these as complete.
- Deployment is not complete until the remaining local changes are committed/pushed, Pages run succeeds, `/pip/` serves the new UI, the source leak path returns 404, Worker forgery probes return 401, and production Firebase rules/endpoints are checked.

### Production and repository checks on 2026-11-19

- Latest local commit: `337de8d` (`Encrypt protected notes and close registration approval bypass`), preserving prior commits `4b8683f` and `ba3788c`; branch is 3 commits ahead of `origin/main`. Push was attempted after network permission was granted; Git still failed before authentication because `git-credential-manager` could not start its MSYS `sh` process (`NtCreateDirectoryObject ... 0xC0000022`).
- Public Pages domain is `https://faissalness.github.io/`. Live `/` and `/pip/` return 200. `/backend/worker.js` and `/firestore.rules` return 404. The live `/pip/` HTML is an older build and does not contain the Post It Pal view or encrypted-note UI; current local changes are not published.
- Latest public Actions API run remains successful run `44440065298` for source `ba7c957`; there is no run for local commit `337de8d` because it has not reached origin.
- Live Worker: root and `/api/users/count` return 200; forged bearer probes to `GET /api/pals`, `POST /api/pals/invite`, and `POST /api/notes/verify` return 401.
- Live unauthenticated Firestore REST reads to `yourNotes`, `privateNotes`, `activeNotesSessions`, and a user notes path return 403. The emulator was not rerun in this shell because no Firebase CLI executable exists in this checkout or the available `node_modules/.bin`; earlier emulator run is recorded above as 30/30.
- Local complete suite rerun after suffix authorization fix: **213 passed, 0 failed**. `git diff --check` passed before the latest progress-only edit.
- Next external operation if the normal credential helper remains blocked: run `cd "C:\Users\faiss\OneDrive\Desktop\FJ-website"; git push origin main` in a normal PowerShell window where Git Credential Manager can launch. This must be followed by observing the Actions run and independently checking the live artifact; it is not completion by itself.

### Final implementation pass on 2026-11-19

- Repaired the trusted access-approval trigger and restored explicit local-part `fj` eligibility handling while keeping browser-created profiles unapproved.
- Removed browser self-promotion and tightened Firestore user/profile update authority to the owner.
- Added Your Notes Trash UI: trashed notes remain recoverable, can be restored, or can be permanently deleted.
- Added a daily Cloudflare scheduled cleanup trigger for D1 accounts whose 30-day grace period has ended.
- Deployed D1 migration `0004_registered_email_lookup.sql` remotely.
- Deployed Cloudflare Worker version `fd2a173f-b1ef-426d-934e-c4de127e1049` to `https://fj-api.jimyass.workers.dev`; the schedule `0 3 * * *` is active.
- Deployed compiled Firestore rules successfully to project `fj-website-384fd`.
- Complete local suite: 213 passed, 0 failed.
- JavaScript syntax checks passed for `app.js`, `private-page.js`, `pip.js`, `notes.js`, `backend/worker.js`, and `functions/access-approval-trigger.js`.
- `git diff --check` passed.

### Final production email and permission pass — 2026-11-19

- Added explicit Firebase `sendEmailVerification` and `sendPasswordResetEmail` action settings for the production Pages continuation URLs.
- Added owner-managed Firestore `applicationPermissions/{uid}` records and note/attachment rules that deny revoked users direct access.
- Owner approval/revoke now mirrors PIP and Notes application status to Firestore.
- Added UID-scoped PIP attachment upload/download with 1 MB and MIME-type limits.
- Worker finalize-deletion route now calls Firebase Identity Toolkit `accounts:delete` after recent reauthentication and deletion grace period; browser no longer performs a separate client deleteUser call.
- Targeted 30/30 Firestore simulator and 30/30 real emulator rules checks passed.
- Targeted Worker suite and final 213/213 suite passed.
- Production Firebase project and 4-account inventory remain unchanged.
- Actual production verification/reset inbox delivery was not tested because no controlled mailbox/test identity or password was available; no production account was modified or emailed.

### Final deployment — 2026-11-19

- Implementation commit: `a7e87be833c6bad7058779d56d01672fbc8c5794`
- Pages run: `44574689901`, successful
- Emulator CI run: `44574689750`, successful
- Live Pages: `https://faissalness.github.io`
- Live PIP: `https://faissalness.github.io/pip/`
- Live backend: `https://fj-api.jimyass.workers.dev`
- Worker version: `bd35ac3e-0f39-4223-aa16-9f54cf303c34`
- Remaining external action: provide a controlled production mailbox/test identity and password or authenticated Firebase session if actual inbox receipt must be verified. No such credentials exist in the current repository/session.

## Current execution status — 2026-11-19

This status supersedes earlier completion notes where they conflict, including the historical email-suffix eligibility statement. No production Auth account was created, deleted, modified, or emailed.

### COMPLETE

- Fixed PIP email normalization (`toLowerCase`), returning-user state handling, and the password-only returning screen. The screen is implemented only on `/pip/`, reuses the Notes 03 neon-green input treatment, remembers the identifier after logout, and offers an explicit account switch. The deployed screen was checked live: exactly one password input, account identifier shown, email/register forms hidden, and computed input styling exactly matches Notes 03.
- Owner authorization is tied to the exact trusted owner UID. The owner can use the PIP `Your Notes` path without an `applicationPermissions` mirror; other users require an explicit active permission. Removed the unsafe verified-email `fj` suffix self-approval path from both Firestore rules and Worker registration. New non-owner registrations remain pending until owner approval.
- Deployed Firestore rules to `fj-website-384fd`; the rules compile and release completed successfully. Emulator assertions prove owner access without a mirror and deny suffix-only, revoked, cross-UID, unverified, and forged-session access.
- Deployed the D1 profile-photo migration and Worker. Migration `0008_profile_photos.sql` is applied; Worker version `ddae51c1-313c-4fef-ad05-e313f934a443` includes owner-only photo changes, active-account reads, bounded upload size, backend MIME/signature/dimension validation, default-avatar fallback, and delete support. Worker tests cover upload, retrieval, denial, corruption rejection, and removal. Browser UI tests cover preview, save, reload persistence, and removal against a test API stub.
- Fixed white-on-dark QR module rendering and reduced QR-tech to generic navigation plus the centered QR on a near-black background. The independent Python decoder verified the exact payload at 420, 330, and 220 pixel render sizes with a four-module quiet zone. Production browser checks decoded the deployed QR at 420px desktop and 304px mobile; visible text is confined to generic navigation, with a square image on `rgb(2, 2, 3)`. No physical iPhone/Android camera was available.
- Full local regression suite: **213 passed, 0 failed**. Emulator master command passed: Auth **18/18**, Firestore **33/33**, and one Playwright test using three isolated synthetic accounts. Browser coverage includes verification/reset action codes and continuations, wrong/correct passwords, logout, reload/session restoration, account switching, and profile-photo UI. No production identity was used by these tests.
- Production read-only account inventory: four Firebase Auth accounts total. The three requested identities exist, match the expected owner/known account UIDs, and are email-verified. The owner UID matches the configured trusted owner. In D1, only the owner has a registration record; PIP and Notes are active, but no display name/profile is stored. The other two identities have no D1 profile or PIP/Notes permission record. No true `admin` custom claim was present in the export; the Worker grants administrative authority only to the exact owner UID. No Firestore `admins` collection inventory was performed.
- Production Worker root and count endpoints return 200; unauthenticated profile-photo access returns 401. The photo migration is applied and the Worker deployment is live.

### INCOMPLETE

- No production sign-in, logout/re-login, account switch, owner PIP session, or successful real-user profile-photo workflow was exercised; no controlled browser session/password was available. Owner D1 status and deployed rules are verified, but production UI authorization is not end-to-end verified.
- Real-device QR camera scanning is unverified; browser rendering and independent desktop/mobile decoders pass.
- Firebase Authentication's production Email/Password setting, authorized-domain list, sender/templates, and redirect handling are not verified from the Firebase CLI account inventory. The app's production config uses the expected Firebase project/auth domain and PIP action URL, but that does not prove Console configuration.
- Legacy shared `/notes/` sessions remain fail-closed. Firestore `activeNotesSessions` records may be issued only by trusted server code; the available Worker has no Firebase Admin credential and cannot safely issue one. The PIP UID-scoped `Your Notes` data path is separate and owner-authorized.
- Full unattended Firebase Auth + Firestore deletion, automated approval/owner-notification emails, complete application-admin roles, and the remaining attachment/offline/retention acceptance requirements from the original specifications are not complete. Existing deletion still requires user confirmation; Worker scheduled cleanup covers D1 social records only.

### BLOCKED

- **Actual production verification/reset inbox delivery:** not tested; no email was sent. The website implements Firebase's built-in `sendEmailVerification` and `sendPasswordResetEmail` calls, and their real action codes work in the emulator. No custom SMTP credential is required for those Firebase Auth actions. Production Console settings and inbox delivery remain unverified. A controlled mailbox session and access to Firebase Authentication settings are needed to verify receipt, templates, authorized domains, and actual production link completion.
- **Legacy shared Notes trusted sessions and unattended full deletion:** no Firebase Admin/service-account credential or trusted Firestore session issuer is configured in Worker secrets. Only the unrelated PIP lookup secret is present. Do not bypass Firestore's server-only session rule; provision an approved trusted backend credential/service before enabling these operations.
- **Approval and owner-notification email:** this is not Firebase Auth verification/reset email. No trusted notification sender is implemented or configured; it requires an approved server-side provider/service.

### Production release and live verification

- Commit `cadc4fb25878637a6e625c4fbb6bbc89b85bf1e5` was pushed to `main`.
- GitHub Pages deployment run `44588811646` and Firebase emulator CI run `44588811758` both completed successfully for that commit.
- Live Pages `/`, `/pip/`, and `/qr/` return HTTP 200. The live PIP-only remembered-device screen was checked against Notes 03 styles; `/`, `/meet/`, `/gods/`, `/notes/`, and `/qr/` do not contain the PIP returning screen.
- Live QR payload independently decodes to the generated Wikipedia destination at both tested viewport sizes. Its only visible text is the existing top navigation.
- Production API `https://fj-api.jimyass.workers.dev` and `/api/count` return HTTP 200. Anonymous profile-photo access returns 401. Firestore unauthenticated REST reads to `privateNotes` and `activeNotesSessions` remain 403.
- Cloudflare D1 migration `0008_profile_photos.sql` is applied; latest Worker version is `ddae51c1-313c-4fef-ad05-e313f934a443`. Production D1 still has only the owner's active PIP/Notes registration and zero stored profile photos; the other two authorized identities have no D1 profile/permission rows.

### Current continuation — 2026-11-20 (commit b89cf11)

This is the newest status and supersedes earlier statements above where they conflict:

- Fixed PIP duplicate-registration messaging and recovery guidance, actionable Firebase sign-in errors, and deterministic repair of missing UID-keyed profile/access-request records after sign-in. Fixed the homepage shared sign-out handler's Firebase Auth scope.
- Implemented the explicitly requested verified-email local-part `fj` suffix eligibility for application approval in the Worker and Firestore rules. This is not an administrator grant. Explicit `revoked` application permissions take precedence; unverified and mismatched identities are not approved.
- Hardened the legacy approval trigger to require the verified Firebase email to match the UID and email exactly. It no longer rewrites addresses or claims an email was delivered when only a link was generated. This trigger is not connected to a deployed Functions runtime.
- The scheduled deletion path now fails closed when trusted Firebase administration is unavailable; due accounts remain suspended and their data is not partially deleted or falsely reported as deleted.
- Added `tests/run_acceptance.ps1` for source checks, local regression suites, optional emulators, read-only production Auth inventory, Worker dry-run, D1 migration inventory, and live HTTP checks.
- `tests/run_acceptance.ps1 -SkipEmulators`: **220 passed, 0 failed** in local suites, including 56 Worker backend assertions, 60 Firestore logic cases, 13 QR engine checks, and 10 independent QR decodes. The read-only Auth audit reported four accounts and did not modify or email any account. Cloudflare Worker dry-run succeeded; no remote D1 migrations were pending; Pages and Worker smoke routes returned HTTP 200.
- Emulator coverage passed locally: Auth **18/18**, Firestore **37/37**, Playwright **1/1** using synthetic accounts. GitHub emulator workflow `44657539114` passed for commit `b89cf114dc5f07fe94ea267ea16d0e97668d6b40`.
- GitHub Pages deployment workflow `44657539287` passed for that commit. The live `/app.js` returned HTTP 200 and contained the corrected shared Auth declaration; live `/`, `/pip/`, `/qr/`, Worker root, and Worker public-count routes returned HTTP 200.
- Cloudflare Worker version `6122459a-e2b7-46df-b8ef-36770b3f9832` and Firestore rules were deployed in the preceding deployment step. No production user credential or record was changed.
- Commit `b89cf114dc5f07fe94ea267ea16d0e97668d6b40` is pushed to `origin/main`. Existing unrelated untracked instructions, backups, configuration, migration, dependencies, and artifacts remain untouched.

### Still incomplete or externally blocked

- Production Firebase Console provider/domain/template settings and actual verification/reset email delivery, inbox receipt, and real action-link completion remain unverified. No production email was sent. The read-only Firebase CLI inventory cannot verify Console settings or access a mailbox.
- `/notes/` still has no trusted server-side Firebase session issuer for `activeNotesSessions`; rules remain fail-closed. No Admin credential/service is configured for complete unattended deletion across Firebase Auth, Firestore, D1, and stored files. The deployed scheduled path therefore does not claim full deletion.
- Real-account production authentication, profile-photo workflows, and multi-account social behavior were not exercised; local/emulator evidence is not production evidence. Physical iPhone/Android camera scanning was not performed; browser and independent decoder evidence is recorded above.
- Approval/owner-notification email, complete Notes Trash/attachment retention behavior, and several original-specification items still need a scoped requirements reconciliation before completion. Do not treat the passing suite or deployment as proof these features are complete.

### Required external verification

- In Firebase Console, open `https://console.firebase.google.com/project/fj-website-384fd/authentication/providers` and confirm Email/Password is enabled. Under Authentication settings, confirm `faissalness.github.io` and the configured Firebase auth domain are authorized. Under Authentication > Templates, confirm verification and password-reset templates and their action URLs are appropriate for the production site. Do not change credentials or reset existing passwords.
- To verify real email delivery, sign in to the authorized test mailbox outside this chat, request verification/reset only for an account whose owner has approved the test, open the received Firebase action link, and confirm the resulting status in the production account. No mailbox session was available here, so no delivery or link completion is claimed.
- Physical QR verification: open `https://faissalness.github.io/qr/` on a desktop display. On iPhone, open Camera and point it at the QR; on Android, open Camera/Google Lens and point it at the QR. The expected preview target is `https://en.wikipedia.org/wiki/Alain_Tourret`. Report whether each device displays that exact destination; this has not been physically tested.

### Pages workflow retry hardening — 2026-11-20

- The Pages workflow triggered by the progress-only commit `4c5fb96` failed during deployment: its retry found duplicate `github-pages` artifacts in the same workflow run. The previously deployed application commit `b89cf11` had a successful Pages deployment and its live assets were verified.
- Updated `.github/workflows/deploy-pages.yml` to give the upload artifact a unique name per workflow run and attempt, and pass that exact name to the deploy action. This prevents a retry from selecting ambiguous artifacts. The updated workflow still requires a successful deployment run before this adjustment is marked verified.
