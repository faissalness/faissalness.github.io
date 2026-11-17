# FJ website

A private, dark-mode FJ website hosted on GitHub Pages. After email/password sign-in and owner approval, the home screen reveals an animated FJ monogram with a QR code for a random Wikipedia article. The private pages include a short editorial introduction, a filterable design inspiration shelf, and a private owner-only notes page.

## Files

- `index.html`, `styles.css`, `app.js`: human check, Firebase access flow, private home, QR composition, and animations.
- `meet.html`, `gods.html`, `notes.html`, `private-page.js`: authenticated pages, including the filterable inspiration gallery and private notes.
- `random.html`, `random.js`: QR redirect to a selected random Wikipedia page (or Wikipedia's random article fallback).
- `firebase-config.js`: Firebase web app values and owner UID.
- `firestore.rules`: access-request and private notes security rules.
- `generate_qr.py`: local QR image generation (`python -m pip install qrcode[pil]`).
- `deploy.py`: GitHub Contents API publisher; prompts for a token without saving it.
- `EMAIL_SETUP.md`: password email setup and free-tier email limitations.

## Firebase and approval

The site uses the Firebase Spark plan. Email/Password Authentication and Firestore must be enabled, the Pages hostname must be authorized, and `firestore.rules` must be published. The owner UID is configured in both `firebase-config.js` and the rules. Visitors request access, the owner reviews requests from the home screen's arrow control, and approval sends a secure password setup link.

The first screen contains a small local arithmetic check. It is a friction step only, not server-enforced bot protection. Nothing is stored or transmitted by this check.

Firebase's browser configuration values are public identifiers. Never put service account keys, email-provider secrets, or other private credentials in these files.

## Publish

GitHub Pages should use the repository default branch and root folder.
