# Step Inside

into a quite space

## About FJ

Step Inside is a small personal space for notes, quiet communication, and a calm digital presence. It is intentionally minimal and keeps its users in control of what they share.

## Explore

- **Ground Zero 00** — Owner/admin control center (owner and authorized admins only)
- **Meet** — 01
- **To the gods** — 02
- **Notes** — 03
- **PIP + Notes** — 04
- **QR-tech** — 05

## Authentication

Sign in with your email address and password through the main FJ website. All FJ applications — PIP, Notes, Your Notes, and the Ground Zero control center — use your main website session; there is no separate second login.

The Ground Zero control center is exclusively available to the owner (`hDbzbNTC7pOuU2UFCjFksopbgaG3`) and explicitly authorized administrators.

## Ground Zero 00

Ground Zero is a complete administrative control center:

- Register accounts, review registrations, and view PIP/Notes status
- Approve and revoke website, PIP, and Notes access — individually or combined
- Suspend and reactivate accounts
- Delete accounts where supported
- Search accounts by email, UID, and name

Website and PIP/Notes authorizations are tracked as separate, independently enforceable permissions across the Cloudflare Worker and Firestore rules.

## Development

The FJ website is deployed on GitHub Pages (`https://faissalness.github.io`) and powered by Firebase (Firebase Authentication, Firestore) and the FJ Cloudflare Worker (`https://fj-api.jimyass.workers.dev`).

To work on the code:

```sh
node tests/run_all_tests.js
```

Run the server, deploy Firestore rules with `firebase deploy --only firestore`, and the Worker with `wrangler deploy` from `backend/`.

## License

The website and its assets are part of the FJ project. See `LICENSE` in the repository root.
