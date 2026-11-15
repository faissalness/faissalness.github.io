# FJ website

A private, dark-mode FJ website hosted on GitHub Pages. After email/password sign-in and owner approval, the home screen reveals an animated FJ monogram with a QR code for a random Wikipedia article. The private pages include a short editorial introduction and a filterable design inspiration shelf.

## Files

- `index.html`, `styles.css`, `app.js`: human check, Firebase access flow, private home, QR composition, and animations.
- `meet.html`, `gods.html`, `private-page.js`: authenticated pages, including the filterable inspiration gallery.
- `random.html`, `random.js`: QR redirect to a selected random Wikipedia page (or Wikipedia's random article fallback).
- `firebase-config.js`: Firebase web app values and owner UID.
- `firestore.rules`: access-request security rules.
- `generate_qr.py`: optional local QR image generation (`python -m pip install qrcode[pil]`).
- `deploy.py`: GitHub Contents API publisher; prompts for a token without saving it.
- `EMAIL_SETUP.md`: password email setup and free-tier email limitations.

## Firebase and approval

The site uses the Firebase Spark plan. Email/Password Authentication and Firestore must be enabled, the Pages hostname must be authorized, and `firestore.rules` must be published. The owner UID is configured in both `firebase-config.js` and the rules. Visitors request access, the owner reviews requests from the home screen's arrow control, and approval sends a secure password setup link. The static site does not email generated passwords or owner notifications because it has no private email server.

The first screen contains a small local arithmetic check. It is a friction step only, not server-enforced bot protection; a real CAPTCHA requires a trusted server or a provider configuration. Nothing is stored or transmitted by this check.

Firebase's browser configuration values are public identifiers. Never put service account keys, email-provider secrets, or other private credentials in these files.

## Publish

GitHub Pages should use the repository default branch and root folder. To publish with the helper, run `python deploy.py` and provide a fine-grained GitHub token restricted to this repository with Contents: read/write and Pages administration permissions. The script publishes files individually through the GitHub API and does not save the token. GitHub may take a few minutes to rebuild Pages.

## Local preview

Serve the repository over HTTP (for example, `python -m http.server 8000`) and open `http://localhost:8000`. Firebase-dependent features use the configured Firebase project.
