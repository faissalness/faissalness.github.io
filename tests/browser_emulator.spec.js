const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

test('three synthetic accounts remain isolated in separate browser contexts', async ({ browser, request }) => {
  const accounts = [];
  for (let index = 1; index <= 3; index++) {
    const response = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key', {
      data: { email: `browser-${Date.now()}-${index}@example.test`, password: `BrowserPass${index}!`, returnSecureToken: true }
    });
    expect(response.ok()).toBeTruthy();
    accounts.push(await response.json());
  }
  expect(new Set(accounts.map(account => account.localId)).size).toBe(3);

  for (const account of accounts) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://faissalness.github.io/pip/');
    await expect(page).toHaveURL(/\/pip\/$/);
    await expect(page.locator('#pip-register-form')).toBeVisible();
    await expect(page.locator('#pip-returning-password')).toBeAttached();
    await page.evaluate(email => localStorage.setItem('fj-pip-remembered-email', email), `${account.email || 'synthetic@example.test'}`);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fj-pip-remembered-email'))).not.toBeNull();
    await context.close();
  }
});
