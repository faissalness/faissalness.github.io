# Security Policy

## Supported Versions

FJ is a continuously deployed website, not a versioned software package. There are no
`5.1.x` / `4.0.x` release lines. Only the current production deployment is supported:

| Deployment | Supported | Notes |
| ---------- | --------- | ----- |
| `main` branch / https://faissalness.github.io/ | :white_check_mark: | The only supported production version. |
| Agent / feature branches | :x: | Development only; never treat as production. |
| Old commits or forks | :x: | No security updates. |

Security fixes are delivered by merging into `main` and redeploying the GitHub Pages
artifact and the Cloudflare Worker.

## Reporting a Vulnerability

Please report security issues privately — do **not** open a public issue for an
unfixed vulnerability.

- Use GitHub's **Report a vulnerability** button on the **Security** tab of
  `faissalness/faissalness.github.io` (preferred), or contact the repository owner
  privately through GitHub.
- Include: affected component (website, Cloudflare Worker, Firebase/Firestore, D1),
  steps to reproduce, impact, and any proof-of-concept that does not expose real user
  data or credentials.

What to expect:

- **Acknowledgement:** within 72 hours.
- **Status update:** at least once per week until resolution, or sooner if the issue
  is critical.
- **Fix:** critical authorization or data-exposure issues are prioritised and deployed
  as soon as a fix is verified. Lower-severity issues are scheduled into the next
  integration pass.
- **Disclosure:** we will coordinate disclosure timing with you after a fix is live.
- If a report is declined (for example, it is out of scope or not a security issue),
  we will explain why and, where appropriate, suggest the correct channel.

## Scope

- `https://faissalness.github.io/` and its GitHub Pages deployment workflow.
- The FJ Cloudflare Worker (`fj-api`) and its D1 database bindings.
- Firebase Authentication configuration, Firestore security rules, and application
  permission records for the Firebase project `fj-website-384fd`.

Out of scope: vulnerabilities in Firebase, Cloudflare, GitHub, or third-party CDN
services themselves; social engineering; reports that require real user credentials or
private production data to demonstrate.

## Handling of Credentials and User Data

Do not include API keys, tokens, service-account keys, passwords, or real user content
in a report or in a public issue. Use synthetic accounts and test data. The immutable
owner UID is the sole authority for owner-only operations; authorization must always
be enforced in the backend and in Firestore rules, never in frontend code alone.
