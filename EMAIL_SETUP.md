# Authentication email status

## Firebase Authentication actions

The PIP registration, resend-verification and password-reset flows call Firebase Authentication's `sendEmailVerification` and `sendPasswordResetEmail` SDK functions. Production links continue to `https://faissalness.github.io/pip/`; the emulator uses a local continuation URL. Firebase's built-in Authentication email service is the intended delivery route. These two account-action emails do not require a custom SMTP credential or a browser-held email secret.

The site must be enabled for Email/Password in Firebase Console > Authentication > Sign-in method. The production domain must be authorized, and sender/template settings are managed under Authentication > Templates. Those Console values, including the allowed-domain list and template contents, have not been independently inspected in this execution; do not infer them from emulator success or the presence of existing accounts.

### Evidence and current state

- **Implemented:** verification, resend-verification and password-reset SDK calls, with the production PIP continuation URL.
- **Emulator-tested:** actual Firebase Auth action codes for verification and password reset, including invalid, tampered and reused-code rejection.
- **Production account inventory:** existing accounts were inspected read-only; no production account was changed and no email was sent.
- **Production inbox delivery:** **not tested**. There is no controlled mailbox session available in this environment, so successful delivery and link completion cannot be claimed.
- **Custom SMTP:** no SMTP integration or credential is configured or needed for Firebase's built-in Auth action service.

## Owner notification emails

Approval-request and approval-notification email delivery is a separate capability; Firebase Auth's built-in verification/reset service does not send those application notifications. The app records pending requests for owner review but has no trusted notification sender. Do not put provider credentials in this public repository. Adding automated notifications requires an approved server-side sender and any billing/provider setup it requires.
