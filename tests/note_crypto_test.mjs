import assert from 'node:assert/strict';
import { decryptNotePayload, encryptNotePayload } from '../note-crypto.mjs';

const note = { title: 'A private title 🔐', content: 'Sensitive body — line two\nwith emoji 💌' };
const first = await encryptNotePayload(note, 'correct horse battery');
assert.equal(first.version, 1);
assert.equal(first.saltHex.length, 32);
assert.equal(first.ivHex.length, 24);
assert.ok(!JSON.stringify(first).includes(note.title));
assert.ok(!JSON.stringify(first).includes('Sensitive body'));
assert.deepEqual(await decryptNotePayload(first, 'correct horse battery'), note);

const second = await encryptNotePayload(note, 'correct horse battery');
assert.notEqual(first.saltHex, second.saltHex, 'Each note encryption uses a fresh random salt');
assert.notEqual(first.ivHex, second.ivHex, 'Each note encryption uses a fresh random GCM nonce');
await assert.rejects(() => decryptNotePayload(first, 'incorrect password'));
const tampered = { ...first, ciphertextHex: `${first.ciphertextHex.slice(0, -2)}00` };
await assert.rejects(() => decryptNotePayload(tampered, 'correct horse battery'));
await assert.rejects(() => encryptNotePayload(note, 'short'));
await assert.rejects(() => decryptNotePayload({ ...first, ivHex: '00' }, 'correct horse battery'));
console.log('NOTE CRYPTO: 9 assertions passed');
