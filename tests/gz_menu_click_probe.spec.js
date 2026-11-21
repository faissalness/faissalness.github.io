const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Diagnostic probe for: "homepage Ground Zero menu click failure"
 * Run with: npx playwright test tests/gz_menu_click_probe.spec.js
 *
 * This probe cannot authenticate as the real owner in CI-less environments.
 * It simulates the signed-in private-home nav state (unhide site-nav/gz-nav,
 * remove auth-pending) to measure hit-testing, computed styles, and click
 * navigation behavior for #gz-nav vs working menu items.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const root = path.resolve(__dirname, '..');
let server;
let origin;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const routeMap = {
      '/': 'index.html',
      '/ground-zero/': 'ground-zero.html',
      '/meet/': 'meet.html',
      '/gods/': 'gods.html',
      '/notes/': 'notes.html',
      '/pip/': 'pip.html',
      '/qr/': 'qr.html'
    };
    let file = routeMap[pathname] ? path.resolve(root, routeMap[pathname]) : path.resolve(root, pathname.replace(/^\//, '') || 'index.html');
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

async function simulatePrivateNavVisible(page) {
  await page.evaluate(() => {
    document.body.classList.remove('auth-pending');
    const nav = document.getElementById('site-nav');
    if (nav) nav.hidden = false;
    const gz = document.getElementById('gz-nav');
    if (gz) gz.hidden = false;
    // keep human-gate/auth-shell/private-home in a stable state for layout
    const hg = document.getElementById('human-gate');
    const auth = document.getElementById('auth-shell');
    const home = document.getElementById('private-home');
    if (hg) hg.hidden = true;
    if (auth) auth.hidden = true;
    if (home) home.hidden = false;
  });
}

async function inspectLink(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { exists: false, selector: sel };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const topEl = document.elementFromPoint(cx, cy);
    const describe = (node) => {
      if (!node) return null;
      return {
        tag: node.tagName,
        id: node.id || null,
        className: node.className || null,
        href: node.getAttribute ? node.getAttribute('href') : null,
        text: (node.textContent || '').trim().slice(0, 60)
      };
    };
    let cur = topEl;
    const chain = [];
    for (let i = 0; i < 6 && cur; i++) { chain.push(describe(cur)); cur = cur.parentElement; }
    return {
      exists: true,
      selector: sel,
      href: el.getAttribute('href'),
      hiddenAttr: el.hidden,
      ariaHidden: el.getAttribute('aria-hidden'),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, cx, cy },
      computed: {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        position: cs.position,
        zIndex: cs.zIndex
      },
      elementFromPoint: describe(topEl),
      isTargetOrContains: topEl === el || el.contains(topEl),
      ancestorChainAtPoint: chain
    };
  }, selector);
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 }
]) {
  test(`probe nav hit-testing/click behavior (${viewport.name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await simulatePrivateNavVisible(page);
    await page.waitForTimeout(100);

    const selectors = [
      'a[href="/ground-zero/"]#gz-nav',
      'a[href="/meet/"]',
      'a[href="/gods/"]',
      'a[href="/notes/"]',
      'a[href="/pip/"]',
      'a[href="/qr/"]'
    ];
    const results = {};
    for (const sel of selectors) {
      results[sel] = await inspectLink(page, sel);
      console.log(`[${viewport.name}] ${sel}:`, JSON.stringify(results[sel], null, 2));
    }

    // Compare: if working links receive themselves at center point, gz-nav should too.
    const gz = results['a[href="/ground-zero/"]#gz-nav'];
    const meet = results['a[href="/meet/"]'];
    expect(gz.exists).toBeTruthy();
    expect(meet.exists).toBeTruthy();

    // Diagnostic assertions (non-fatal evidence in logs even if environment differs)
    console.log(`[${viewport.name}] gz isTargetOrContains=${gz.isTargetOrContains}, meet isTargetOrContains=${meet.isTargetOrContains}`);
    console.log(`[${viewport.name}] gz rect=${JSON.stringify(gz.rect)}, meet rect=${JSON.stringify(meet.rect)}`);

    // Attempt actual click on gz-nav and observe navigation
    const navPromise = page.waitForURL(/\/ground-zero\//, { timeout: 5000 }).then(() => 'navigated').catch(() => 'no-navigation');
    await page.click('a[href="/ground-zero/"]#gz-nav', { timeout: 3000 }).catch(e => console.log(`[${viewport.name}] click error: ${e.message}`));
    const navResult = await navPromise;
    console.log(`[${viewport.name}] gz-nav click result: ${navResult}, final url: ${page.url()}`);

    // Also test a working link in a fresh state for comparison
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await simulatePrivateNavVisible(page);
    await page.waitForTimeout(100);
    const navPromise2 = page.waitForURL(/\/meet\//, { timeout: 5000 }).then(() => 'navigated').catch(() => 'no-navigation');
    await page.click('a[href="/meet/"]', { timeout: 3000 }).catch(e => console.log(`[${viewport.name}] meet click error: ${e.message}`));
    const navResult2 = await navPromise2;
    console.log(`[${viewport.name}] meet click result: ${navResult2}, final url: ${page.url()}`);

    await context.close();
    expect(pageErrors).toEqual([]);
  });
}
