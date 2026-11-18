# FJ website execution progress

Updated: 2026-11-18 (Europe/Stockholm)

## Repository

- Existing project: `C:\Users\faiss\OneDrive\Desktop\FJ-website`.
- `2cca634` is on `main` and `origin/main`.
- Current PIP, owner-only Notes, verified-email policy, and related test changes are uncommitted. Pre-existing user files, backups, and local state remain untouched.

## Latest local checks

- `node tests/run_all_tests.js`: 147 passed, 0 failed. This includes 55 Firestore logic simulator cases, 10 independent QR decodes, QR color/quiet-zone checks, tab-scoped human verification regressions, and the deployment allowlist suite.
- Firestore Local Emulator Suite: 17/17 actual rules-unit tests passed, including UID isolation, role injection, owner session expiry/absence, and browser-forged session rejection. The test script passed; Firebase CLI exits 1 afterward due its local update-check/config-store error.
- Syntax checks passed for `app.js`, `notes.js`, `pip.js`, `qr-tech.js`, `qr-url.js`, and `backend/worker.js`.
- `git diff --check` passed.
- A local run of the Pages allowlist assembly succeeded: 26 files, five clean route aliases, no Worker/source-map markers.
- QR test independently decoded the JavaScript-generated QR matrix to the exact test URL and covers unsafe URL rejection.
- PIP page was visually checked at 390px mobile width; navigation, sign-in and account creation cards fit the viewport.
- Human-check success is now bound to a per-tab `window.name` identifier as well as `sessionStorage`, so a copied session marker in a newly opened tab does not satisfy the check.
- QR-tech now chooses a high-contrast accent color for each newly generated QR and prevents immediate repeat colors; the four-module quiet zone remains in place.

## Production evidence

- Latest public GitHub Pages Actions run for `2cca634` completed successfully. Live homepage and `/qr/` return 200. `/backend/worker.js`, `/backend/worker.js.map`, and `/firestore.rules` return 404. `/pip/` remains 404 because the local PIP implementation has not been published.
- Live Worker root returns HTTP 200 `{"status":"FJ API Operational"}`. A fresh production forgery probe used correct project claims, a real Google key ID, and an invalid 256-byte signature; Worker returned HTTP 401, `{"error":"Access denied"}`, `Cache-Control: no-store`.
- Firebase rules deployment printed compile, release and `Deploy complete` after closing the missing-session and client-writable-session bypasses. The CLI still exits 1 after deployment because its local update-check/config store fails. Production unauthenticated REST probes for `privateNotes`, `activeNotesSessions`, and `yourNotes` all return 403 `PERMISSION_DENIED`.

## Work implemented locally

- Added QR-tech 05, safe HTTPS destination validation, SVG download, clean `/qr/` route, and clean route aliases for Meet, Gods, and Notes.
- Added auth-pending first-paint suppression and removed the authenticated reload flash; same-tab verification survives reload and new tabs require verification.
- Invitation redemption now requires a cryptographically verified Firebase ID token and uses its UID rather than a caller-provided UID.
- Original owner Notes and its shared-password configuration are restricted to the owner; Worker Notes verification rejects non-owner Firebase identities. The missing-session bypass is now closed; trusted persistent session issuance is still not connected to Firestore.
- Firestore now fails closed: a missing active-session document no longer grants access, and browser clients can no longer create, update, or delete session records. A trusted Admin SDK session issuer is not connected, so original owner Notes is unavailable until that backend is implemented and deployed. The current Worker still has isolate-local state and is not an adequate persistent session issuer.
- Added PIP / Your Notes registration, sign-in, email verification, generic reset response, duplicate-account message, and per-UID note CRUD. Firestore rules scope each account to its own notes. Separate app passwords, note-level passwords, administrators for personal applications, scheduled account deletion, user count, and Post It Pal are still outstanding.

## Deployment access

- GitHub Pages workflow source is configured for GitHub Actions. The user pushed `2cca634`, which deployed successfully in the prior run.
- Firebase CLI is available at `%APPDATA%\npm\firebase.cmd`; it reports expired credentials but compiled and released the current ruleset. Its nonzero post-run state still needs repair before future deployment actions.
- Wrangler 4 was installed using `npx`. `wrangler whoami` reports the Cloudflare OAuth token expired. The Cloudflare dashboard opens to its sign-in page; no current authenticated Cloudflare browser session was found.

### Continuation on 2026-11-18

- Committed reviewed frontend, workflow, Worker, rules, and test changes as local commit `142db21` (parent `2cca634`). The user-owned untracked configuration, task text, backups, and `.wrangler` state were not staged.
- Follow-up execution record is commit `6823b1d`; tab-scoped human verification is `02d0ba6`; QR color behavior and regression coverage are `ec4945b`.
- `git push origin main` was attempted after commit and failed before authentication: Git Credential Manager could not access Windows credentials (`0xC0000022`, Credential Manager `0x5`). Remote `main` remains `2cca634`.
- Firebase rules were released successfully (CLI printed `Deploy complete!`); the process then exited 1 from the local Firebase CLI update-check/config-store failure. Live unauthenticated REST checks return 403 for protected collections.
- Cloudflare OAuth remains expired. `wrangler whoami` previously reported the expired token, so the current local Worker changes have not been deployed.

## Next operations

1. Replace Worker isolate-local password/session/invitation maps with a durable free-tier backend and connect trusted session issuance to Firestore before restoring owner Notes access.
2. Implement the uncompleted separate Your Notes password, account administration, account deletion scheduler, public user count, Post It Pal, attachments security, approval email job, and remaining master requirements.
3. Reauthorize Git Credential Manager, then run `git push origin main` to publish local commits through `ec4945b` and wait for the Pages workflow; verify `/pip/` and the deployed revision.
4. Sign in again to Cloudflare, then deploy and verify the Worker. The current live Worker is still the previously deployed version.

## Completion

Incomplete. Production source routes are no longer accessible, forged tokens are rejected, and the tightened Firestore rules are released. Local commits through `ec4945b` contain tested PIP, session-rule, human-verification and QR-tech work but are not pushed because Git Credential Manager cannot access Windows credentials. The current GitHub Pages version therefore still lacks PIP. The Worker still needs a durable backend and redeployment, original Notes is fail-closed pending trusted session issuance, multiple required features remain unimplemented, and end-to-end production acceptance has not passed.
