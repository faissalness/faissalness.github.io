const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const root = path.resolve(__dirname, '..');
const shots = path.resolve(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

// Routes to test for CSP violations.
const routes = [
  { path: '/', label: 'homepage' },
  { path: '/ground-zero/', label: 'ground-zero' }
];

let staticServer;
let origin;

test.beforeAll(async () => {
  staticServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const routeMap = {
      '/': 'index.html',
      '/ground-zero/': 'ground-zero.html'
    };
    let file;
    if (routeMap[pathname]) file = path.resolve(root, routeMap[pathname]);
    else file = path.resolve(root, pathname.replace(/\/+$/, '').slice(1) || 'index.html');
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${staticServer.address().port}`;
});

test.afterAll(async () => {
  if (staticServer) await new Promise(resolve => staticServer.close(resolve));
});

for (const route of routes) {
  test(`CSP violations: ${route.label} (desktop)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    const cspViolations = [];
    const blockedRequests = [];
    const firebaseMapRequests = [];
    const firebaseScriptLoads = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => consoleErrors.push(`PAGE ERROR: ${error.message}`));
    page.on('console', (message) => {
      const text = message.text();
      if (/csp|content security|violat/i.test(text)) cspViolations.push(`CONSOLE: ${text}`);
      if (message.type() === 'error') consoleErrors.push(`CONSOLE ERROR: ${text}`);
    });
    page.on('requestfailed', (request) => {
      blockedRequests.push({ url: request.url(), resourceType: request.resourceType(), error: request.failure()?.errorText || '' });
    });
    page.on('response', (response) => {
      const url = response.url();
      if (/\.js\.map($|\?)/i.test(url)) {
        firebaseMapRequests.push({ url, status: response.status(), resourceType: 'source-map' });
      }
      if (/firebasejs\/10\.14\.1\/firebase-(app|auth|firestore)\.js($|\?)/i.test(url)) {
        firebaseScriptLoads.push({ url, status: response.status() });
      }
    });

    const response = await page.goto(`${origin}${route.path}`, { waitUntil: 'load' });
    expect(response.status()).toBe(200);

    // Wait briefly for any deferred CSP reports / source-map fetches.
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    console.log(`\n===== CSP INVESTIGATION: ${route.label} (${finalUrl}) =====`);
    console.log(`CSP violations (console): ${cspViolations.length}`);
    for (const v of cspViolations) console.log(`  ${v}`);
    console.log(`Blocked/failed requests: ${blockedRequests.length}`);
    for (const b of blockedRequests) console.log(`  ${b.resourceType} ${b.url} -> ${b.error}`);
    console.log(`Source-map (.js.map) requests: ${firebaseMapRequests.length}`);
    for (const m of firebaseMapRequests) console.log(`  ${m.url} -> ${m.status}`);
    console.log(`Firebase SDK script loads: ${firebaseScriptLoads.length}`);
    for (const s of firebaseScriptLoads) console.log(`  ${s.url} -> ${s.status}`);
    console.log(`Other console errors: ${consoleErrors.length}`);
    for (const e of consoleErrors) console.log(`  ${e}`);

    await page.screenshot({ path: path.join(shots, `csp-${route.label}-desktop.png`), fullPage: true });
    await context.close();

    // Record findings. CSP is not blocking anything; report only.
    // Firebase SDK scripts load on the homepage (gstatic.com is in script-src).
    // On ground-zero they may not initialize if the page redirects unauthenticated
    // visitors before Firebase boots, or due to test-server relative-path artifacts;
    // that is not a CSP issue.
    const firebaseApp = firebaseScriptLoads.find(s => s.url.includes('firebase-app'));
    const firebaseAuth = firebaseScriptLoads.find(s => s.url.includes('firebase-auth'));
    const firebaseFirestore = firebaseScriptLoads.find(s => s.url.includes('firebase-firestore'));
    console.log(`[${route.label}] firebase-app load: ${firebaseApp ? `${firebaseApp.status}` : 'NOT LOADED'}`);
    console.log(`[${route.label}] firebase-auth load: ${firebaseAuth ? `${firebaseAuth.status}` : 'NOT LOADED'}`);
    console.log(`[${route.label}] firebase-firestore load: ${firebaseFirestore ? `${firebaseFirestore.status}` : 'NOT LOADED'}`);

    // Hard assertion: CSP must not block Firebase SDK scripts on the homepage.
    if (route.label === 'homepage') {
      expect(firebaseApp).toBeDefined();
      expect(firebaseAuth).toBeDefined();
      expect(firebaseFirestore).toBeDefined();
    }
  });
}
