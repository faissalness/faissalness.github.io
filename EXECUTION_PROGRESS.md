# FJ website execution progress

Updated: 2026-11-18 (Europe/Stockholm)

## Repository

- Existing project: `C:\Users\faiss\OneDrive\Desktop\FJ-website`.
- `2cca634` is on `main` and `origin/main`.
- Local implementation commits through `29756a7` are not pushed. Pre-existing user files, backups, and local state remain untouched.

## Latest local checks

- `node tests/run_all_tests.js`: 149 passed, 0 failed. This includes 57 Firestore logic simulator cases, 10 independent QR decodes, QR color/quiet-zone checks, tab-scoped human verification, account lifecycle, and deployment allowlist checks.
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

- GitHub Pages workflow source is configured for GitHub Actions. The user pushed `2cca634`, which deployed successfully in the prior run.
- Firebase CLI is available at `%APPDATA%\npm\firebase.cmd`; it reports expired credentials but compiled and released the current ruleset. Its nonzero post-run state still needs repair before future deployment actions.
- Wrangler 4 was installed using `npx`. `wrangler whoami` reports the Cloudflare OAuth token expired. The Cloudflare dashboard opens to its sign-in page; no current authenticated Cloudflare browser session was found.

### Continuation on 2026-11-18

- Committed reviewed frontend, workflow, Worker, rules, and test changes as local commit `142db21` (parent `2cca634`). The user-owned untracked configuration, task text, backups, and `.wrangler` state were not staged.
- Follow-up execution record is commit `6823b1d`; tab-scoped human verification is `02d0ba6`; QR color behavior and regression coverage are `ec4945b`.
- CSP policy and website audit assertion are committed as `161de8e`; the deletion flow/rules/tests are committed as `29756a7`.
- `git push origin main` was attempted after commit and failed before authentication: Git Credential Manager could not access Windows credentials (`0xC0000022`, Credential Manager `0x5`). Remote `main` remains `2cca634`.
- Firebase rules were released successfully (CLI printed `Deploy complete!`); the process then exited 1 from the local Firebase CLI update-check/config-store failure. Live unauthenticated REST checks return 403 for protected collections.
- Cloudflare OAuth remains expired. `wrangler whoami` previously reported the expired token, so the current local Worker changes have not been deployed.

## Next operations

1. Replace Worker isolate-local password/session/invitation maps with a durable free-tier backend and connect trusted session issuance to Firestore before restoring owner Notes access.
2. Finish the separate Your Notes password, administrators, unattended deletion, public user count, Post It Pal, protected attachments/offline behavior, approval-email workflow, and integrated FJ QR design.
3. Reauthorize Git Credential Manager, push all local commits through `29756a7`, wait for Pages deployment, and verify `/pip/` and the deployed revision.
4. Reauthorize Wrangler, deploy and independently test the Worker; replace its isolate-local state with durable trusted session issuance before restoring owner Notes access.

## Completion

Incomplete. Production source routes are no longer accessible, forged tokens are rejected, and the latest account-lifecycle Firestore rules are released. Local commits through `29756a7` contain the tested PIP, session-rule, human-verification, QR-tech, CSP, referrer-policy and deletion work but are not pushed because Git Credential Manager cannot access Windows credentials. The current GitHub Pages version therefore still lacks PIP. The Worker still needs a durable backend and redeployment, original Notes is fail-closed pending trusted session issuance, multiple required features remain unimplemented, and end-to-end production acceptance has not passed.
