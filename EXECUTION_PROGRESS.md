# FJ website execution progress

Updated: 2026-11-18 (Europe/Stockholm)

## Current repository state

- Repository: `C:\Users\faiss\OneDrive\Desktop\FJ-website`
- Local checkpoint commit: `89a81b6` on `main`, one commit ahead of `origin/main`.
- Existing untracked user files and backups were preserved.
- Local changes are present in the Worker, Pages workflow, favicon, Notes gate text/styles, tests, and this progress record. No production services were changed.

## Tests and local build

- `node tests/run_all_tests.js`: 105 checks passed, 0 failed.
- The 48 Firestore cases are simulator checks, not Firebase emulator tests.
- Wrangler dry-run produced a local Worker bundle. No deployment was performed.
- `git diff --check` passed.

## Confirmed production state

- `https://faissalness.github.io` returned HTTP 200; its homepage had no favicon link.
- `https://faissalness.github.io/backend/worker.js` returned HTTP 200 and the complete Worker source.
- `https://faissalness.github.io/notes` and `/notes.html` returned the Notes HTML.
- `https://fj-api.jimyass.workers.dev` returned HTTP 200 with `{"status":"FJ API Operational"}`.
- A fabricated Firebase JWT with owner claims and an invalid signature was accepted by the live Worker and received a session token. The probe used only a placeholder password and did not read or alter notes or accounts. This vulnerability remains live until the corrected Worker is deployed.
- Local `firestore.rules` allows Notes reads when the active session document is missing. That fallback remains unchanged until a working persistent server-issued session path exists.

## Local fixes completed

- Worker authentication now verifies Firebase `RS256` signatures using Google's X.509 public certificates, then validates issuer, audience, expiry, issue time, auth time, not-before (if present), and subject. CORS is limited to the site origin, and API responses disable caching.
- Added `.github/workflows/deploy-pages.yml` with an explicit public artifact allowlist excluding backend source, rules, tests, backups, and local state.
- Updated the FJ favicon to lowercase white `fj` on a dark rectangle and linked it on the site's pages.
- Capitalized and whitened the Notes gate message.
- Added tests for forged/tampered Worker tokens and the Pages artifact allowlist; corrected the suite label so simulated rules are not misreported as emulator tests.

## Authentication and deployment

- Firebase CLI sign-in is present but its token is expired. `firebase projects:list` fails with “credentials are no longer valid”; reauthentication is required.
- Wrangler is available through `npx`, but its Cloudflare authorization is expired. `wrangler whoami` requires `wrangler login` or a Cloudflare API token. Do not paste an API token into chat.
- Git Credential Manager is configured, but its helper failed in this environment during a safe push dry-run; GitHub write access is not verified.
- The local checkpoint commit has not been pushed. No service deployment has been made.

## Remaining work

1. Authenticate Firebase CLI by running `firebase login --reauth` and complete the Google account flow.
2. Authenticate Wrangler by running `npx wrangler login` and complete the Cloudflare authorization flow for the account containing `fj-api`.
3. Push the local checkpoint (`git push origin main`) from an authenticated Git shell so the allowlisted Pages workflow can run.
4. Implement durable Notes sessions, connect them to data access, and then enforce strict Firestore session rules. Add actual Firebase emulator tests.
5. Implement the remaining requested Your Notes, account, administrator, scheduled deletion, public user count, Post It Pal, QR-tech, and interface features with server-enforced authorization.
6. Deploy Firebase rules, Worker, and Pages; verify invalid tokens are rejected and the Pages backend-source URL no longer discloses source.

## Completion status

Incomplete. Local security and Pages deployment improvements are tested but not deployed. The production Worker still accepts forged tokens, Pages still exposes Worker source, and durable sessions, the remaining features, deployments, and production verification are outstanding.
