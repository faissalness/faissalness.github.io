# FJ website

Static GitHub Pages site with a dark FJ landing page, random-colour logo, optional Firebase email/password access requests, owner approval, and a QR page that redirects visitors to Reddit or Wikipedia.

## Files

- `index.html`, `styles.css`, `app.js`: landing page and access flow.
- `firebase-config.js`: Firebase web app values and owner UID; fill these in before enabling Firebase features.
- `firestore.rules`: access rules. Replace the owner UID placeholder with the same UID as in `firebase-config.js` before publishing rules.
- `random.html`, `random.js`: QR display and random redirect.
- `generate_qr.py`: optional local PNG QR generation (`python -m pip install qrcode[pil]`).
- `deploy.py`: GitHub Contents API publisher; prompts for a token without saving it.
- `EMAIL_SETUP.md`: setup steps and the free-tier email limitation.

## Firebase setup (free Spark plan)

Create a Firebase project, register a Web app, enable Email/Password authentication, create Firestore, then fill `firebase-config.js`. Add the GitHub Pages hostname under Authentication > Settings > Authorized domains. Publish `firestore.rules` from the Firestore Rules screen. Create the owner account through Authentication, add its `/users/{uid}` document with `approved: true`, and set that UID in both the config and rules. A visitor request creates a Firebase Auth account with a random temporary password; the visitor uses Reset password after approval to set their own password. The owner approves pending requests from the signed-in page.

Firebase project configuration values in a public static site are identifiers, not secrets. Security depends on the Firestore rules. Never put service account keys or private API credentials in these files.

## Publish

GitHub Pages should use the repository default branch and root folder. To publish with the helper, run `python deploy.py` and provide a fine-grained GitHub token restricted to this repository with Contents: read/write and Pages: read/write permissions. The script publishes files individually through the GitHub API; it does not save the token. GitHub may take a few minutes to rebuild Pages.

## Local preview

Because browser module imports require HTTP, use `python -m http.server 8000` in this folder and open `http://localhost:8000`. Firebase-dependent features stay inactive until configured.
