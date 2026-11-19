const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const root = path.resolve(__dirname, '..');
const projectId = 'demo-fj-website-384fd';
const authBase = 'http://127.0.0.1:9099';
const accountsBase = `${authBase}/emulator/v1/projects/${projectId}/accounts`;
let staticServer;
let origin;

test.beforeAll(async () => {
  staticServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const localPath = pathname === '/pip/' || pathname === '/pip'
      ? 'pip.html'
      : pathname.replace(/^\/pip\//, '/').replace(/^\/+/, '');
    const file = path.resolve(root, localPath);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${staticServer.address().port}`;
});

test.afterAll(async () => {
  if (staticServer) await new Promise(resolve => staticServer.close(resolve));
});

function latestActionLink(email, mode) {
  for (const name of ['firebase-debug.log', 'firestore-debug.log']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const links = [...text.matchAll(/http:\/\/127\.0\.0\.1:9099\/emulator\/action\?[^\s"'<>]+/g)];
    for (const match of links.reverse()) {
      if (new URL(match[0]).searchParams.get('mode') !== mode) continue;
      if (text.slice(Math.max(0, match.index - 1000), match.index + 300).includes(email)) return match[0];
    }
  }
  return null;
}

test('three independent browser accounts verify email, persist sessions, and use PIP password-only return login', async ({ browser }) => {
  const suffix = Date.now();
  const accounts = Array.from({ length: 3 }, (_, index) => ({
    email: `browser-${suffix}-${index + 1}fj@example.test`,
    password: `BrowserPass${index + 1}!`,
    name: `Browser User ${index + 1}`
  }));
  const uids = new Set();
  const pageErrors = [];
  const browserErrors = [];

  try {
    for (const account of accounts) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      let storedPhoto = null;
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
      await page.route('https://fj-api.jimyass.workers.dev/api/**', async route => {
        const request = route.request();
        const pathName = new URL(request.url()).pathname;
        const headers = {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Max-Age': '600',
          'Cache-Control': 'no-store'
        };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (/^\/api\/profiles\/[^/]+\/photo$/.test(pathName)) {
          if (request.method() === 'GET') {
            return storedPhoto
              ? route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'image/png' }, body: storedPhoto })
              : route.fulfill({ status: 404, headers });
          }
          if (request.method() === 'POST') {
            storedPhoto = await request.postDataBuffer();
            return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"success":true}' });
          }
          if (request.method() === 'DELETE') {
            storedPhoto = null;
            return route.fulfill({ status: 204, headers });
          }
        }
        const body = pathName.endsWith('/invitations') ? { invitations: [] }
          : pathName.endsWith('/pals') ? { pals: [] }
            : { success: true, status: 'active', pipStatus: 'active', notesStatus: 'active' };
        return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      });

      await page.goto(`${origin}/pip/`);
      await expect(page.locator('#pip-register-form')).toBeVisible();
      await page.locator('#pip-register-name').fill(account.name);
      await page.locator('#pip-register-email').fill(account.email);
      await page.locator('#pip-register-password').fill(account.password);
      await page.locator('#pip-register-form button[type=submit]').click();
      await page.waitForTimeout(1_000);
      if (!(await page.locator('#pip-verify').isVisible())) {
        throw new Error(`Registration did not reach email verification: ${await page.locator('#pip-status').textContent()} ${browserErrors.join(' | ')} ${pageErrors.join(' | ')}`);
      }

      await expect.poll(() => latestActionLink(account.email, 'verifyEmail'), { timeout: 15_000 }).not.toBeNull();
      const actionLink = latestActionLink(account.email, 'verifyEmail');
      const actionUrl = new URL(actionLink);
      const verificationCode = actionUrl.searchParams.get('oobCode');
      expect(verificationCode).toBeTruthy();
      expect(actionUrl.searchParams.get('continueUrl')).toBe(`${origin}/pip/`);
      await page.evaluate(async code => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
        const { applyActionCode, getAuth } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
        await applyActionCode(getAuth(getApps().find(app => app.name === 'FJYourNotes')), code);
      }, verificationCode);
      await page.locator('#pip-check-verified').click();
      await expect(page.locator('#pip-notes')).toBeVisible();

      const persistedUid = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
        return getAuth(getApps().find(app => app.name === 'FJYourNotes')).currentUser.uid;
      });
      expect(uids.has(persistedUid)).toBeFalsy();
      uids.add(persistedUid);

      if (uids.size === 1) {
        await page.locator('[data-pip-view="pals"]').click();
        await expect(page.locator('#pip-profile-photo')).toBeVisible();
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg==', 'base64');
        await page.locator('#pip-profile-photo').setInputFiles({
          name: 'avatar.png',
          mimeType: 'image/png',
          buffer: png
        });
        await expect(page.locator('#pip-profile-photo-status')).toHaveText('Preview ready. Save to publish your photo.');
        await expect(page.locator('#pip-save-profile-photo')).toBeEnabled();
        await page.locator('#pip-save-profile-photo').click();
        await expect(page.locator('#pip-profile-photo-status')).toHaveText('Profile photo saved.');
        await expect(page.locator('#pip-own-avatar img:not([hidden])')).toBeVisible();

        await page.reload();
        await expect(page.locator('#pip-notes')).toBeVisible();
        await page.locator('[data-pip-view="pals"]').click();
        await expect(page.locator('#pip-own-avatar img:not([hidden])')).toBeVisible();
        await page.locator('#pip-remove-profile-photo').click();
        await expect(page.locator('#pip-profile-photo-status')).toHaveText('Profile photo removed.');
        await expect(page.locator('#pip-own-avatar .pip-avatar-fallback')).toBeVisible();
      }

      await page.reload();
      await expect(page.locator('#pip-notes')).toBeVisible();
      await page.locator('#pip-sign-out').click();
      await expect(page.locator('#pip-returning')).toBeVisible();
      await expect(page.locator('#pip-returning-email')).toHaveText(account.email);
      await expect(page.locator('#pip-returning-password')).toBeVisible();
      await expect(page.locator('#pip-login-form')).toBeHidden();
      await expect(page.locator('#pip-register-form')).toBeHidden();

      await page.locator('#pip-returning-password').fill('WrongPassword!');
      await page.locator('#pip-returning-password').press('Enter');
      await expect(page.locator('#pip-returning-password')).toHaveValue('');
      await expect(page.locator('#pip-returning')).toBeVisible();
      await page.locator('#pip-returning-password').fill(account.password);
      await page.locator('#pip-returning-password').press('Enter');
      await expect(page.locator('#pip-notes')).toBeVisible();

      await page.locator('#pip-sign-out').click();
      await page.locator('#pip-switch-account').click();
      await expect(page.locator('#pip-login-form')).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('fj-pip-remembered-email'))).toBeNull();
      await page.locator('#pip-login-email').fill(account.email);
      await page.locator('#pip-reset').click();
      await expect.poll(() => latestActionLink(account.email, 'resetPassword'), { timeout: 15_000 }).not.toBeNull();
      const resetUrl = new URL(latestActionLink(account.email, 'resetPassword'));
      const resetCode = resetUrl.searchParams.get('oobCode');
      expect(resetCode).toBeTruthy();
      expect(resetUrl.searchParams.get('continueUrl')).toBe(`${origin}/pip/`);
      account.password = `ResetBrowserPass${uids.size}!`;
      const resetEmail = await page.evaluate(async ({ code, password }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
        const { confirmPasswordReset, getAuth, verifyPasswordResetCode } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
        const auth = getAuth(getApps().find(app => app.name === 'FJYourNotes'));
        const email = await verifyPasswordResetCode(auth, code);
        await confirmPasswordReset(auth, code, password);
        return email;
      }, { code: resetCode, password: account.password });
      expect(resetEmail).toBe(account.email);
      await page.locator('#pip-login-email').fill(account.email.toUpperCase());
      await page.locator('#pip-login-password').fill(account.password);
      await page.locator('#pip-login-form button[type=submit]').click();
      await expect(page.locator('#pip-notes')).toBeVisible();
      await context.close();
    }

    expect(uids.size).toBe(3);
    expect(pageErrors).toEqual([]);
  } finally {
    await fetch(accountsBase, { method: 'DELETE' }).catch(() => {});
  }
});
