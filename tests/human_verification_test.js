const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.ok(/sessionStorage\.getItem\("fj-human-check"\) !== "passed"/.test(app),
  'Authenticated users in a new tab must complete the human check first');
assert.ok(/sessionStorage\.setItem\("fj-human-check", "passed"\)/.test(app),
  'A successful challenge must persist across same-tab reloads');
assert.ok(/if \(Number\(\$\("#human-answer"\)\.value\) !== a \+ b\)/.test(app),
  'Only an incorrect answer may enter the error path');
assert.ok(index.includes('class="site-body auth-pending"') && styles.includes('.auth-pending .human-gate'),
  'The auth-pending first paint must conceal intermediate gate states');
assert.ok(!/screen\.classList\.add\("play"\)/.test(app),
  'The authenticated reload path must not trigger the green screen flash');

console.log('=== HUMAN VERIFICATION SOURCE REGRESSIONS: 5 / 5 PASSED ===');
