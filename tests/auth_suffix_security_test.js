const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const requestHandler = source.slice(source.indexOf('$("#request-form").addEventListener'), source.indexOf('$("#sign-in-form").addEventListener'));
assert.ok(requestHandler.includes('approved: false'), 'Every self-service registration must start unapproved');
assert.ok(requestHandler.includes('status: "pending"'), 'Every self-service request must enter owner review');
assert.ok(!/endsWith\s*\(|endsWithFj|endsWith\(['"]fj['"]\)/i.test(requestHandler), 'Email suffix must never determine authorization');
assert.ok(!/approved:\s*true|status:\s*["']approved["']/.test(requestHandler), 'Registration handler must never approve an account');
console.log('PASS: Arbitrary email suffixes cannot auto-approve registrations; requests remain pending.');
