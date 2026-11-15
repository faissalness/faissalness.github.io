# Email notifications

Firebase Authentication can send password reset emails on the Spark plan. The static site cannot safely send owner notification emails: browser code has no private email credentials, and Firestore does not provide an email delivery trigger by itself. Do not put an email provider secret in this public repository.

For fully automated request and approval messages, a trusted server-side email sender is needed. Firebase's event-triggered Cloud Functions require the Blaze billing plan, which can require a payment method and can incur charges; this project deliberately does not enable it. Keep the Spark-only setup and review pending requests in the owner panel, or configure an external email provider only after confirming its current free limits and secure server-side integration.

To enable Firebase password reset delivery, configure the project sender/name and authorized domain in Firebase Console > Authentication > Templates and Settings. The page reports reset request success without revealing whether an address is registered.
