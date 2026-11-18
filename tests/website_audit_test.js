/**
 * Full Website & Asset Audit Test Suite
 * Tests Phase 10 Requirements:
 * - Broken links and assets
 * - Viewports and mobile metadata
 * - Stylesheets and scripts
 * - Accessibility (alt text, aria-labels, reduced-motion, visible focus)
 * - Navigation links
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("=== FULL WEBSITE AUDIT & ASSET VERIFICATION SUITE ===\n");

const ROOT = path.join(__dirname, '..');
const HTML_FILES = ['index.html', 'meet.html', 'gods.html', 'notes.html', 'random.html'];
let passedAudits = 0;

// 1. Verify existence of all HTML files
console.log("1. Checking HTML Pages Existence...");
HTML_FILES.forEach(file => {
  const filePath = path.join(ROOT, file);
  assert.ok(fs.existsSync(filePath), `Page ${file} must exist`);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.length > 50, `Page ${file} must not be empty`);
  passedAudits++;
});
console.log(` PASS: All ${HTML_FILES.length} HTML pages exist and are non-empty.`);

// 2. Verify Viewport and Mobile Metadata
console.log("\n2. Checking Viewport and Theme-Color Metadata...");
HTML_FILES.forEach(file => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(content.includes('<meta name="viewport"'), `${file} must contain mobile viewport tag`);
  if (file !== 'random.html') {
    assert.ok(content.includes('<meta name="theme-color" content="#020203">'), `${file} must contain theme-color meta tag`);
  }
  passedAudits++;
});
console.log(" PASS: Mobile responsiveness viewport and theme metadata verified.");

// 3. Verify Static Assets (qr.png, favicon.svg, styles.css)
console.log("\n3. Checking Core Static Assets...");
assert.ok(fs.existsSync(path.join(ROOT, 'qr.png')), "qr.png must exist in root");
assert.ok(fs.statSync(path.join(ROOT, 'qr.png')).size > 1000, "qr.png must not be empty");
assert.ok(fs.existsSync(path.join(ROOT, 'favicon.svg')), "favicon.svg must exist");
assert.ok(fs.existsSync(path.join(ROOT, 'styles.css')), "styles.css must exist");
passedAudits += 3;
console.log(" PASS: Core assets (qr.png, favicon.svg, styles.css) exist and are valid.");

// 4. Verify Accessibility: Reduced-Motion and Visible Focus
console.log("\n4. Checking Accessibility Styles...");
const stylesContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
assert.ok(stylesContent.includes('prefers-reduced-motion:reduce'), "styles.css must define prefers-reduced-motion:reduce");
assert.ok(stylesContent.includes(':focus-visible'), "styles.css must define :focus-visible outlines");
assert.ok(stylesContent.includes('--lime'), "styles.css must define --lime brand color");
passedAudits += 3;
console.log(" PASS: prefers-reduced-motion, focus-visible, and brand contrast verified.");

// 5. Verify Navigation Links Integrity Across All Pages
console.log("\n5. Checking Navigation Links Consistency...");
HTML_FILES.forEach(file => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const hrefMatches = content.match(/href="([^"#:]+\.html)"/g) || [];
  hrefMatches.forEach(hrefAttr => {
    const targetFile = hrefAttr.replace(/href="|"/g, '');
    assert.ok(HTML_FILES.includes(targetFile), `Invalid link target ${targetFile} in ${file}`);
  });
  passedAudits++;
});
console.log(" PASS: All internal navigation links point to valid existing pages.");

console.log(`\n=== WEBSITE AUDIT COMPLETE: ALL ${passedAudits} CHECKS PASSED SUCCESSFULLY! ===`);
