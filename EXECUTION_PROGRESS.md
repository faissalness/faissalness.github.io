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
