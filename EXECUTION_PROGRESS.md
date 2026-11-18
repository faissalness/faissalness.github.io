# FJ website execution progress

Updated: 2026-11-18 (Europe/Stockholm)

## Current repository state

- Repository: `C:\Users\faiss\OneDrive\Desktop\FJ-website`
- Local commits through `614badb` are on `main` and synchronized with `origin/main`.
- Existing untracked user files and backups were preserved.
- The current implementation adds the QR-tech 05 page and clean aliases, auth-pending first-paint handling, and verified-identity enforcement on invitation redemption. Pre-existing untracked files and backups remain untouched.

## Tests and local build

- `node tests/run_all_tests.js`: 121 checks passed, 0 failed after the current changes (including independently decoded JavaScript QR output and destination safety cases).
- `node --check` passed for `app.js`, `notes.js`, `qr-tech.js`, `random.js`, and `backend/worker.js`.
- `git diff --check` passed (only Git's line-ending normalization warnings were printed).
- The 48 Firestore cases are simulator checks, not Firebase emulator tests.
- Wrangler dry-run produced a local Worker bundle.
- `git diff --check` passed before the commits.

## Confirmed production state

- GitHub Pages was switched to GitHub Actions and the allowlist workflow was manually triggered (run `44388959526`, completed successfully at SHA `614badb3`).
- `https://faissalness.github.io` returned HTTP 200 and contained the favicon link.
- Cache-busted `https://faissalness.github.io/backend/worker.js` and `/firestore.rules` returned GitHub 404 pages; neither response contained backend source. `/backend/wrangler.toml` returned a generic 503 response without source. Recheck after future publishes.
- `https://faissalness.github.io/notes` and `/notes.html` returned the Notes HTML.
- `https://fj-api.jimyass.workers.dev` returned HTTP 200 with `{"status":"FJ API Operational"}` after the Worker update.
- The Worker signature fix was deployed using Wrangler. A production POST with owner claims, a real Google key ID, and a 256-byte invalid signature returns HTTP 401 with `Cache-Control: no-store`. The site origin is allowed by CORS; `Origin: null` is not.
- The allowlisted Pages deployment removed the confirmed Worker source leak at `/backend/worker.js`.
- Local `firestore.rules` allows Notes reads when the active session document is missing. That fallback remains unchanged until a functioning persistent server-issued session path exists.

## Local fixes completed

- Worker authentication now verifies Firebase `RS256` signatures using Google's X.509 public certificates and validates issuer, audience, expiry, issue time, auth time, not-before (when present), and subject.
- Worker API CORS is restricted to the website origin and private responses disable caching.
- Added `.github/workflows/deploy-pages.yml` with a static public artifact allowlist excluding backend source, rules, tests, backups, and local state.
- Updated the FJ favicon to lowercase white `fj`, linked it across pages, and corrected capitalization and color of the Notes gate text.
- Added forged/tampered-token tests and a Pages allowlist test; labeled Firestore cases accurately as simulator checks.
- Added a standalone QR-tech 05 interface with validated HTTPS Wikipedia/Wikimedia/Reddit destinations, scan-friendly high contrast and quiet zone, refresh, and SVG download; Pages now emits `/qr/`, `/meet/`, `/gods/`, and `/notes/` directory routes.
- Changed primary site navigation to clean routes and removed the homepage QR widget in favor of the dedicated QR page.
- Suppressed gated homepage content during Firebase's initial auth resolution and removed the reload flash animation trigger.
- Invitation redemption now requires a cryptographically verified Firebase ID token and derives the consumer UID from verified token claims, never the request body. Added forged/missing identity coverage.

## Authentication and deployment

- Firebase CLI can list active project `fj-website-384fd`.
- Wrangler confirms an active OAuth session for the Cloudflare account containing `fj-api`.
- The available shell in this continuation has Git and Node but no `gh`, `wrangler`, or `firebase` CLI on PATH; check local/browser auth before production deploy actions.
- Current code changes have not yet been committed, pushed, or deployed.
- The Pages workflow and prior Worker deployment completed. Firebase rules have not been deployed.

## Remaining work

1. Commit and push the current QR/navigation/auth first-paint and Worker invitation changes, then wait for and inspect the Pages deployment and live clean routes.
2. Implement durable Notes sessions, connect them to protected data access, then enforce strict Firestore session rules. Add actual Firebase emulator tests.
3. Implement the remaining requested Your Notes, account, administrator, scheduled deletion, public user count, Post It Pal, and account isolation with server-enforced authorization.
4. Deploy Firebase rules and Worker changes and verify production authorization, data isolation, QR output, and source exposure.

## Completion status

Incomplete. Previously deployed Worker signature verification rejected a forged token with HTTP 401 and no-store, and the allowlisted Pages deployment removed the `/backend/worker.js` source exposure. The current 113-check suite passes locally. Current code changes are not yet deployed; the Firestore missing-session fallback, durable Notes sessions, Your Notes, administrator workflow, deletion scheduler, user count, Post It Pal, Firebase rules deployment, and complete production verification remain outstanding.
