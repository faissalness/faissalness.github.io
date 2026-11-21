# Firebase CSP / dependency audit — evidence and minimal correction

Scope: frontend CSP meta policies and Firebase SDK resource loading only.
No backend, authorization, Worker, Firestore, D1, routing or visual code was changed.

## Evidence gathered

1. **All Firebase SDK code is loaded as ESM from one origin**:
   `https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js`,
   `firebase-auth.js`, `firebase-firestore.js`. Files importing them: `app.js`,
   `ground-zero.js`, `notes.js`, `pip.js`, `private-page.js`. `qr-tech.js` and
   `random.js` import no Firebase module.
2. **Every page already allows that origin for scripts**:
   `script-src 'self' https://www.gstatic.com`. The modules themselves therefore
   load correctly; there is no script-src defect.
3. **The served modules contain optional source-map annotations**, e.g.
   `//# sourceMappingURL=firebase-app.js.map` (confirmed by fetching the real files
   from `www.gstatic.com`; HTTP 200). These files are fetched only by developer
   tools to map minified code back to sources. They are not part of application
   execution.
4. **Chrome classifies the DevTools source-map fetch as a connection** and applies
   `connect-src`. The existing `connect-src` lists do not include `www.gstatic.com`,
   which produces the reported "Refused to connect … violates connect-src" message.
5. **No runtime Firebase resource needs a new allowance.** Auth/Firestore traffic
   goes to `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`,
   `firestore.googleapis.com` (HTTP + WSS) and `firebasestorage.googleapis.com`,
   all already present in `connect-src`. The Worker origin is already allowed on
   the pages that call it. Fonts and styles are covered by `font-src`/`style-src`.
   There are no inline scripts; all scripts are external `type="module"` files,
   which `script-src 'self'` already permits.

## Conclusion

- The blocked requests are **optional debugging source maps**, not runtime
  dependencies. The application does not fail because of them; only DevTools
  source-level debugging is degraded and the console warning is produced.
- `script-src` is correctly configured. `connect-src` is not "wrong" for its
  intended traffic; it simply lacks the CDN origin that Chrome uses for the
  optional source-map fetch.
- **No functional CSP fix is required.** The precise minimal correction, if a
  clean console is desired, is to add `https://www.gstatic.com` to `connect-src`
  on the six pages that load Firebase modules. This does not change which code
  can execute and does not grant access to any new API.

## Correction applied

Added `https://www.gstatic.com` to `connect-src` in:
`index.html`, `ground-zero.html`, `notes.html`, `pip.html`, `meet.html`, `gods.html`.
`qr.html` and `random.html` were deliberately left unchanged (no Firebase imports).

A regression assertion was added to `tests/website_audit_test.js` requiring both
`script-src` and `connect-src` to include the Firebase module origin exactly on
those six pages.

Verification: `node tests/website_audit_test.js` → 42/42 PASS;
`node tests/run_all_tests.js` → **376 passed, 0 failed, exit 0**; `git diff --check` PASS.
The live production homepage still has the old `connect-src` (no `www.gstatic.com`),
confirming the reported warning originates from the deployed policy. Deployment of
this frontend CSP change is the integration director's responsibility.

## Coordination note for Flint / Iceman / Lightning / DeepSeek

Only the CSP `connect-src` token changed; no HTML structure, script, style or route
was touched. If a frontend agent is concurrently editing these files, this is the
only delta to preserve. No other CSP directive needs modification.
