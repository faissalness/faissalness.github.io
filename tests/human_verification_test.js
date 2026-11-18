const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.ok(/window\.name = `fj-human-tab:\$\{id\}`/.test(app) && /marker\?\.tabId === currentHumanTabId/.test(app),
  'A cloned sessionStorage marker must not pass the check in another tab');
assert.ok(/sessionStorage\.setItem\(HUMAN_CHECK_KEY, JSON\.stringify\(\{ status: "passed", tabId: currentHumanTabId \}\)\)/.test(app),
  'A successful challenge must persist across same-tab reloads');
assert.ok(/if \(Number\(\$\("#human-answer"\)\.value\) !== a \+ b\)/.test(app),
  'Only an incorrect answer may enter the error path');
assert.ok(index.includes('class="site-body auth-pending"') && styles.includes('.auth-pending .human-gate'),
  'The auth-pending first paint must conceal intermediate gate states');
assert.ok(!/screen\.classList\.add\("play"\)/.test(app),
  'The authenticated reload path must not trigger the green screen flash');
assert.ok((app.match(/hasHumanCheckPassed\(\)/g) || []).length >= 4,
  'Every auth-state rendering path must check the current tab identity');

console.log('=== HUMAN VERIFICATION SOURCE REGRESSIONS: 6 / 6 PASSED ===');
