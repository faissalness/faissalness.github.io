const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  if (typeof value !== "string" || value.length % 2 || !/^[0-9a-f]*$/i.test(value)) throw new Error("Invalid encrypted note");
  return Uint8Array.from(value.match(/.{2}/g) || [], pair => parseInt(pair, 16));
}

async function deriveKey(password, salt) {
  if (typeof password !== "string" || password.length < 8 || password.length > 256) throw new Error("Use a note password with at least 8 characters");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptNotePayload(note, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = encoder.encode(JSON.stringify({ title: String(note.title || ""), content: String(note.content || "") }));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { version: 1, saltHex: toHex(salt), ivHex: toHex(iv), ciphertextHex: toHex(ciphertext) };
}

export async function decryptNotePayload(envelope, password) {
  if (!envelope || envelope.version !== 1 || typeof envelope.ciphertextHex !== "string" || envelope.ciphertextHex.length > 200000) throw new Error("Invalid encrypted note");
  const salt = fromHex(envelope.saltHex);
  const iv = fromHex(envelope.ivHex);
  if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid encrypted note");
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, fromHex(envelope.ciphertextHex));
  const value = JSON.parse(decoder.decode(plaintext));
  if (typeof value.title !== "string" || typeof value.content !== "string") throw new Error("Invalid encrypted note");
  return { title: value.title, content: value.content };
}
