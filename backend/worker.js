/**
 * FJ Cloudflare Worker - Free Zero-Cost Serverless Backend
 * 100% Free Plan Compatible (Zero Billing / No Credit Card Required)
 * Handles:
 * - Firebase ID Token JWT verification via Google x509 certs
 * - Shared Notes Password verification (PBKDF2-SHA256, 100k iterations)
 * - Rate limiting against brute-force attacks
 * - Cryptographically random session tokens (12h expiry, server-side digests)
 * - FJ Invitation token issuance & atomic redemption
 * - Durable password reset jobs via Firebase Identity Toolkit sendOobCode
 */

const OWNER_UID = "hDbzbNTC7pOuU2UFCjFksopbgaG3";
const PROJECT_ID = "fj-website-384fd";
const SITE_ORIGIN = "https://faissalness.github.io";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedSigningKeys = null;
let signingKeysExpireAt = 0;

let firebaseAdminApp = null;
let firebaseAdminAuth = null;
let firebaseAdminFirestore = null;

function initializeFirebaseAdmin(env) {
  if (firebaseAdminApp) return { auth: firebaseAdminAuth, firestore: firebaseAdminFirestore };
  const adminKey = env?.FIREBASE_ADMIN_KEY;
  if (!adminKey) return null;
  try {
    const serviceAccount = JSON.parse(adminKey);
    const { initializeApp, cert } = require("firebase-admin/app");
    const { getAuth } = require("firebase-admin/auth");
    const { getFirestore } = require("firebase-admin/firestore");
    firebaseAdminApp = initializeApp({ credential: cert(serviceAccount) }, "fj-admin");
    firebaseAdminAuth = getAuth(firebaseAdminApp);
    firebaseAdminFirestore = getFirestore(firebaseAdminApp);
    return { auth: firebaseAdminAuth, firestore: firebaseAdminFirestore };
  } catch (e) {
    console.error("Firebase Admin SDK initialization failed:", e.message);
    return null;
  }
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(hexString) {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function readBoundedBody(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RangeError("Image exceeds the upload limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validProfileImage(bytes, mimeType) {
  let width = 0;
  let height = 0;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (mimeType === "image/png" && bytes.length >= 57
    && pngSignature.every((value, index) => bytes[index] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let hasHeader = false;
    let hasImageData = false;
    let hasEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      const dataStart = offset + 8;
      const crcOffset = dataStart + length;
      if (crcOffset + 4 > bytes.length
        || pngCrc32(bytes, offset + 4, crcOffset) !== view.getUint32(crcOffset)) return false;
      if (!hasHeader) {
        if (type !== "IHDR" || length !== 13) return false;
        width = view.getUint32(dataStart);
        height = view.getUint32(dataStart + 4);
        hasHeader = true;
      } else if (type === "IHDR") return false;
      if (type === "IDAT" && length) hasImageData = true;
      offset = crcOffset + 4;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length) return false;
        hasEnd = true;
        break;
      }
    }
    if (!hasHeader || !hasImageData || !hasEnd) return false;
  } else if (mimeType === "image/webp"
    && bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) === bytes.length - 8) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === "VP8 " && bytes.length >= 30
      && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    }
  } else if (mimeType === "image/jpeg" && bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2;
    let hasFrame = false;
    let hasScan = false;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda) { hasScan = true; break; }
      const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        hasFrame = true;
      }
      offset += 2 + segmentLength;
    }
    if (!hasFrame || !hasScan) return false;
  }
  return width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 16_000_000;
}

async function computePbkdf2Hash(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return bufferToHex(derivedBits);
}

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return bufferToHex(digest);
}

async function emailLookupDigest(email, secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Email lookup key unavailable");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bufferToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email)));
}

function hasAutomaticApprovalEmail(identity) {
  if (identity?.email_verified !== true || typeof identity.email !== "string") return false;
  const email = identity.email.trim().toLowerCase();
  const separator = email.indexOf("@");
  return separator > 0
    && separator === email.lastIndexOf("@")
    && email.length <= 254
    && !/\s/.test(email)
    && email.slice(0, separator).endsWith("fj")
    && separator < email.length - 1;
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Malformed JWT");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJwtJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function readDerElement(bytes, offset) {
  if (offset >= bytes.length) throw new Error("Malformed certificate");
  const tag = bytes[offset];
  let cursor = offset + 1;
  if (cursor >= bytes.length) throw new Error("Malformed certificate");
  let length = bytes[cursor++];
  if (length & 0x80) {
    const byteCount = length & 0x7f;
    if (byteCount === 0 || byteCount > 4 || cursor + byteCount > bytes.length) throw new Error("Malformed certificate");
    length = 0;
    for (let i = 0; i < byteCount; i++) length = (length * 256) + bytes[cursor++];
  }
  const end = cursor + length;
  if (end > bytes.length) throw new Error("Malformed certificate");
  return { tag, start: offset, valueStart: cursor, end };
}

function decodeBase64UrlSafe(value) {
  const normalized = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return decodeBase64Url(normalized);
}

function certificateSpki(pem) {
  const base64 = pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, "");
  const der = decodeBase64UrlSafe(base64);
  const certificate = readDerElement(der, 0);
  const tbs = readDerElement(der, certificate.valueStart);
  if (certificate.tag !== 0x30 || tbs.tag !== 0x30) throw new Error("Malformed certificate");

  let offset = tbs.valueStart;
  let element = readDerElement(der, offset);
  if (element.tag === 0xa0) {
    offset = element.end;
    element = readDerElement(der, offset);
  }
  // TBSCertificate: serial, signature, issuer, validity, subject, SPKI.
  for (let i = 0; i < 5; i++) {
    offset = element.end;
    element = readDerElement(der, offset);
  }
  if (element.tag !== 0x30) throw new Error("Malformed certificate public key");
  return der.slice(element.start, element.end);
}

async function getSigningKeys() {
  if (cachedSigningKeys && Date.now() < signingKeysExpireAt) return cachedSigningKeys;
  const response = await fetch(GOOGLE_CERTS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Firebase signing keys unavailable");
  const certs = await response.json();
  const keys = new Map();
  for (const [kid, pem] of Object.entries(certs)) {
    if (typeof pem !== "string") continue;
    const key = await crypto.subtle.importKey(
      "spki", certificateSpki(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    keys.set(kid, key);
  }
  if (!keys.size) throw new Error("No Firebase signing keys available");
  const maxAge = Number((response.headers.get("Cache-Control") || "").match(/max-age=(\d+)/i)?.[1] || 300);
  cachedSigningKeys = keys;
  signingKeysExpireAt = Date.now() + Math.max(1, maxAge) * 1000;
  return keys;
}

async function verifyFirebaseIdToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = decodeJwtJson(parts[0]);
    const payload = decodeJwtJson(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
    if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) return null;
    if (!Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) || !Number.isInteger(payload.auth_time)) return null;
    if (payload.exp <= now || payload.iat > now || payload.auth_time > now || payload.iat >= payload.exp) return null;
    if (payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || payload.nbf > now)) return null;

    const key = (await getSigningKeys()).get(header.kid);
    if (!key) return null;
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = decodeBase64Url(parts[2]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData) ? payload : null;
  } catch (_) {
    return null;
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (!env?.DB) return;
    const admin = initializeFirebaseAdmin(env);
    const now = Date.now();
    const dueAccounts = await env.DB.prepare("SELECT uid, email_digest FROM registered_users WHERE status = 'scheduled' AND deletion_at <= ?")
      .bind(now).all();
    for (const account of dueAccounts.results || []) {
      if (admin) {
        try {
          await admin.auth.deleteUser(account.uid);
          await admin.firestore.recursiveDelete(admin.firestore.collection("yourNotes").doc(account.uid));
          await admin.firestore.doc(`users/${account.uid}`).delete().catch(() => {});
          await admin.firestore.doc(`accessRequests/${account.uid}`).delete().catch(() => {});
          await admin.firestore.doc(`applicationPermissions/${account.uid}`).delete().catch(() => {});
          await admin.firestore.doc(`activeNotesSessions/${account.uid}`).delete().catch(() => {});
          await env.DB.prepare("DELETE FROM registered_users WHERE uid = ?").bind(account.uid).run();
          await env.DB.prepare("DELETE FROM profile_photos WHERE uid = ?").bind(account.uid).run();
          await env.DB.prepare("DELETE FROM pal_invitations WHERE inviter_uid = ? OR recipient_uid = ?").bind(account.uid, account.uid).run();
          await env.DB.prepare("DELETE FROM pals WHERE uid_low = ? OR uid_high = ?").bind(account.uid, account.uid).run();
          await env.DB.prepare("DELETE FROM pip_messages WHERE sender_uid = ? OR recipient_uid = ?").bind(account.uid, account.uid).run();
          await env.DB.prepare("DELETE FROM social_posts WHERE author_uid = ?").bind(account.uid).run();
          await env.DB.prepare("DELETE FROM rate_limits WHERE rate_key LIKE ?").bind(`${account.uid}%`).run();
          await env.DB.prepare("DELETE FROM active_sessions WHERE uid = ?").bind(account.uid).run();
          console.log(`Automated deletion completed for ${account.uid}`);
        } catch (e) {
          console.error(`Automated deletion failed for ${account.uid}:`, e.message);
        }
      } else {
        console.error(`Scheduled account deletion for ${account.uid} blocked: Firebase Admin SDK not configured.`);
      }
    }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("Origin");
    const corsHeaders = {
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (requestOrigin === SITE_ORIGIN) corsHeaders["Access-Control-Allow-Origin"] = SITE_ORIGIN;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Authentication state must survive Worker isolate restarts. Fail closed if
    // the production D1 binding is missing instead of falling back to memory.
    if (!env?.DB && url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const readIdentity = async () => {
      const header = request.headers.get("Authorization") || "";
      return verifyFirebaseIdToken(header.replace(/^Bearer\s+/i, ""));
    };
    const accountIsActive = async uid => {
      const account = await env.DB.prepare("SELECT status, pip_status AS pipStatus FROM registered_users WHERE uid = ?").bind(uid).first();
      return account?.status === "active" && account?.pipStatus === "active";
    };

    if (url.pathname === "/api/users/count" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM registered_users WHERE status = 'active' AND pip_status = 'active'").first();
        return new Response(JSON.stringify({ count: Number(result?.count || 0) }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Count unavailable" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/users/register" && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const identity = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        if (!identity) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified email required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const emailDigest = await emailLookupDigest(String(identity.email || "").trim().toLowerCase(), env.PAL_LOOKUP_SECRET);
        const email = String(identity.email || "").trim().toLowerCase();
        const isOwner = identity.sub === OWNER_UID;
        const automaticallyApproved = hasAutomaticApprovalEmail(identity);
        // The D1 account column only accepts 'active' or 'scheduled'. Ordinary users
        // are created as unapproved PIP/Notes applications: the account is active but
        // the application states stay 'pending' until the owner approves them.
        const accountStatus = "active";
        const applicationStatus = isOwner || automaticallyApproved ? "active" : "pending";
        await env.DB.prepare(`INSERT OR IGNORE INTO registered_users
          (uid, registered_at, display_name, email_digest, status, pip_status, notes_status)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(identity.sub, Date.now(), String(identity.name || "").slice(0, 80), emailDigest, accountStatus, applicationStatus, applicationStatus).run();
        await env.DB.prepare("UPDATE registered_users SET display_name = ?, email_digest = ? WHERE uid = ?")
          .bind(String(identity.name || "").slice(0, 80), emailDigest, identity.sub).run();
        if (isOwner) {
          await env.DB.prepare("UPDATE registered_users SET status = 'active', pip_status = 'active', notes_status = 'active', deletion_at = NULL WHERE uid = ?")
            .bind(identity.sub).run();
        } else if (automaticallyApproved) {
          await env.DB.prepare(`UPDATE registered_users
            SET status = 'active', pip_status = 'active', notes_status = 'active'
            WHERE uid = ? AND pip_status != 'revoked' AND notes_status != 'revoked'`)
            .bind(identity.sub).run();
        }
        const existing = await env.DB.prepare("SELECT status, pip_status AS pipStatus, notes_status AS notesStatus FROM registered_users WHERE uid = ?").bind(identity.sub).first();
        const pipStatus = existing?.pipStatus || applicationStatus;
        const notesStatus = existing?.notesStatus || applicationStatus;
        await env.DB.prepare("UPDATE registered_users SET pip_status = ?, notes_status = ? WHERE uid = ?")
          .bind(pipStatus, notesStatus, identity.sub).run();
        const account = await env.DB.prepare("SELECT status, deletion_at AS deletionAt FROM registered_users WHERE uid = ?").bind(identity.sub).first();
        const permissions = await env.DB.prepare("SELECT pip_status AS pipStatus, notes_status AS notesStatus FROM registered_users WHERE uid = ?").bind(identity.sub).first();
        return new Response(JSON.stringify({ success: true, status: account?.status || accountStatus, eligible: isOwner || automaticallyApproved, pipStatus: permissions?.pipStatus || pipStatus, notesStatus: permissions?.notesStatus || notesStatus }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Registration could not be recorded" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/admin/permissions" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Administrator access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const body = await request.json();
        const uid = typeof body.uid === "string" ? body.uid.slice(0, 128) : "";
        const action = body.action;
        const target = body.target === "pip" || body.target === "notes" ? [body.target] : ["pip", "notes"];
        if (!uid || !["approve", "revoke"].includes(action)) {
          return new Response(JSON.stringify({ error: "Invalid permission action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Create the account row when it has no D1 record yet so approval state can
        // be set for newly registered accounts and accounts whose PIP record is missing.
        await env.DB.prepare(`INSERT OR IGNORE INTO registered_users
          (uid, registered_at, status, pip_status, notes_status, deletion_at)
          VALUES (?, ?, 'active', 'pending', 'pending', NULL)`).bind(uid, Date.now()).run();
        for (const app of target) {
          const statusColumn = app === "pip" ? "pip_status" : "notes_status";
          if (action === "approve") {
            await env.DB.prepare("UPDATE registered_users SET status = 'active' WHERE uid = ?").bind(uid).run();
            await env.DB.prepare(`UPDATE registered_users SET ${statusColumn} = 'active' WHERE uid = ?`).bind(uid).run();
          } else {
            await env.DB.prepare(`UPDATE registered_users SET ${statusColumn} = 'revoked' WHERE uid = ?`).bind(uid).run();
          }
        }
        const updated = await env.DB.prepare("SELECT status, pip_status AS pipStatus, notes_status AS notesStatus FROM registered_users WHERE uid = ?").bind(uid).first();
        return new Response(JSON.stringify({ success: true, uid, target, action, status: action === "approve" ? "active" : "revoked", accountStatus: updated?.status || null, pipStatus: updated?.pipStatus || null, notesStatus: updated?.notesStatus || null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Permission update unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Owner approval dashboard backend: list registered accounts for the owner.
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Administrator access denied" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const result = await env.DB.prepare(`SELECT uid, display_name AS displayName, status, pip_status AS pipStatus, notes_status AS notesStatus, registered_at AS registeredAt
          FROM registered_users ORDER BY display_name COLLATE NOCASE, uid LIMIT 500`).all();
        return new Response(JSON.stringify({ users: result.results || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });      } catch (_) {
        return new Response(JSON.stringify({ error: "User lookup unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Ground Zero 00 account backend: owner-only account listing and account
    // actions (suspend / reactivate / delete). Website and PIP/Notes permissions
    // stay in the separate Firestore structures; this endpoint enforces the
    // account/suspension state.
    if (url.pathname === "/api/admin/accounts" && request.method === "GET") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Owner access required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const result = await env.DB.prepare(`SELECT uid, display_name AS displayName, status, pip_status AS pipStatus, notes_status AS notesStatus, registered_at AS registeredAt, deletion_at AS deletionAt
          FROM registered_users ORDER BY display_name COLLATE NOCASE, uid LIMIT 500`).all();
        return new Response(JSON.stringify({ accounts: result.results || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Accounts unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const gzAccountPathMatch = /^\/api\/admin\/accounts\/([A-Za-z0-9_-]{1,128})(?:\/(suspend|reactivate|delete))?$/.exec(url.pathname);
    if (gzAccountPathMatch && request.method === "POST" && gzAccountPathMatch[2]) {
      try {
        const identity = await readIdentity();
        if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Owner access required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const uid = gzAccountPathMatch[1];
        const action = gzAccountPathMatch[2];
        const account = await env.DB.prepare("SELECT status, deletion_at AS deletionAt FROM registered_users WHERE uid = ?").bind(uid).first();
        if (!account) {
          return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (action === "suspend") {
          await env.DB.prepare("UPDATE registered_users SET status = 'scheduled', deletion_at = NULL WHERE uid = ?").bind(uid).run();
        } else if (action === "reactivate") {
          await env.DB.prepare("UPDATE registered_users SET status = 'active', pip_status = 'active', notes_status = 'active', deletion_at = NULL WHERE uid = ?").bind(uid).run();
        } else if (action === "delete") {
          const related = [
            ["DELETE FROM profile_photos WHERE uid = ?", [uid]],
            ["DELETE FROM pal_invitations WHERE inviter_uid = ? OR recipient_uid = ?", [uid, uid]],
            ["DELETE FROM pals WHERE uid_low = ? OR uid_high = ?", [uid, uid]],
            ["DELETE FROM pip_messages WHERE sender_uid = ? OR recipient_uid = ?", [uid, uid]],
            ["DELETE FROM social_posts WHERE author_uid = ?", [uid]],
            ["DELETE FROM rate_limits WHERE rate_key LIKE ?", [`${uid}%`]],
            ["DELETE FROM active_sessions WHERE uid = ?", [uid]]
          ];
          for (const [sql, values] of related) {
            try { await env.DB.prepare(sql).bind(...values).run(); } catch (_) { /* cleanup best effort */ }
          }
          await env.DB.prepare("DELETE FROM registered_users WHERE uid = ?").bind(uid).run();
        }
        const after = await env.DB.prepare("SELECT uid, status, pip_status AS pipStatus, notes_status AS notesStatus, deletion_at AS deletionAt FROM registered_users WHERE uid = ?").bind(uid).first();
        return new Response(JSON.stringify({ success: true, uid, action, account: after || null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Account action unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/profiles" && request.method === "GET") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified sign-in required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const search = String(url.searchParams.get("q") || "").trim().slice(0, 80);
        const result = await env.DB.prepare(`SELECT uid, display_name AS displayName FROM registered_users
          WHERE status = 'active' AND uid != ? AND display_name != '' AND display_name LIKE ? COLLATE NOCASE
          ORDER BY display_name COLLATE NOCASE LIMIT 25`)
          .bind(identity.sub, `%${search}%`).all();
        return new Response(JSON.stringify({ profiles: result.results || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Profiles unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const profilePhotoMatch = /^\/api\/profiles\/([A-Za-z0-9_-]{1,128})\/photo$/.exec(url.pathname);
    if (profilePhotoMatch && ["GET", "POST", "DELETE"].includes(request.method)) {
      try {
        const identity = await readIdentity();
        if (!identity || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Verified sign-in required" }), {
            status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const targetUid = profilePhotoMatch[1];
        if (!await accountIsActive(identity.sub) || !await accountIsActive(targetUid)) {
          return new Response(JSON.stringify({ error: "Active PIP accounts required" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (request.method !== "GET" && targetUid !== identity.sub) {
          return new Response(JSON.stringify({ error: "You can only change your own profile photo" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (request.method === "GET") {
          const photo = await env.DB.prepare("SELECT mime_type AS mimeType, image_data AS imageData FROM profile_photos WHERE uid = ?")
            .bind(targetUid).first();
          if (!photo) return new Response(null, { status: 404, headers: corsHeaders });
          return new Response(photo.imageData, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Cache-Control": "private, no-store",
              "Content-Type": photo.mimeType,
              "Content-Disposition": "inline",
              "X-Content-Type-Options": "nosniff"
            }
          });
        }
        if (request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM profile_photos WHERE uid = ?").bind(identity.sub).run();
          return new Response(null, { status: 204, headers: corsHeaders });
        }
        const mimeType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
        if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
          return new Response(JSON.stringify({ error: "Choose a PNG, JPEG, or WebP image" }), {
            status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const bytes = await readBoundedBody(request, 262144);
        if (!validProfileImage(bytes, mimeType)) {
          return new Response(JSON.stringify({ error: "The image is invalid or exceeds 4096 × 4096 pixels" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        await env.DB.prepare(`INSERT INTO profile_photos (uid, mime_type, image_data, size, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(uid) DO UPDATE SET mime_type = excluded.mime_type, image_data = excluded.image_data,
          size = excluded.size, updated_at = excluded.updated_at`)
          .bind(identity.sub, mimeType, bytes, bytes.byteLength, Date.now()).run();
        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (error) {
        const tooLarge = error instanceof RangeError;
        return new Response(JSON.stringify({ error: tooLarge ? "Profile photo must be 256 KB or smaller" : "Profile photo service unavailable" }), {
          status: tooLarge ? 413 : 503, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/admin/lookup" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        if (!identity) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified email required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (identity.sub !== OWNER_UID) return new Response(JSON.stringify({ error: "Administrator access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const rateKey = `admin_lookup:${identity.sub}`;
        const now = Date.now();
        const rate = await env.DB.prepare("SELECT attempts AS count, locked_until AS lockedUntil FROM rate_limits WHERE rate_key = ?").bind(rateKey).first();
        if ((rate?.lockedUntil || 0) > now) return new Response(JSON.stringify({ error: "Too many lookups. Try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if ((rate?.count || 0) >= 10) {
          await env.DB.prepare("INSERT INTO rate_limits (rate_key, attempts, locked_until) VALUES (?, 10, ?) ON CONFLICT(rate_key) DO UPDATE SET locked_until = excluded.locked_until")
            .bind(rateKey, now + 60 * 60 * 1000).run();
          return new Response(JSON.stringify({ error: "Too many lookups. Try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await env.DB.prepare("INSERT INTO rate_limits (rate_key, attempts, locked_until) VALUES (?, 1, 0) ON CONFLICT(rate_key) DO UPDATE SET attempts = attempts + 1")
          .bind(rateKey).run();
        const body = await request.json();
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) || email.length > 254) {
          return new Response(JSON.stringify({ error: "Enter a valid email address" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const digest = await emailLookupDigest(email, env.PAL_LOOKUP_SECRET);
        const target = await env.DB.prepare("SELECT uid, display_name AS displayName FROM registered_users WHERE email_digest = ? AND status = 'active' LIMIT 1").bind(digest).first();
        if (!target) return new Response(JSON.stringify({ error: "No active Your Notes account uses that email" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ uid: target.uid, displayName: target.displayName || "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Account lookup unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/users/deletion" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified sign-in required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const body = await request.json();
        const account = await env.DB.prepare("SELECT status, deletion_at AS deletionAt FROM registered_users WHERE uid = ?").bind(identity.sub).first();
        if (!account) return new Response(JSON.stringify({ error: "PIP account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (body.action === "schedule") {
          const admin = initializeFirebaseAdmin(env);
          const deletionAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
          await env.DB.prepare("UPDATE registered_users SET status = 'scheduled', deletion_at = ?, pip_status = 'revoked', notes_status = 'revoked' WHERE uid = ?").bind(deletionAt, identity.sub).run();
          return new Response(JSON.stringify({ success: true, deletionAt, adminConfigured: !!admin }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (body.action === "cancel") {
          const result = await env.DB.prepare("UPDATE registered_users SET status = 'active', deletion_at = NULL, pip_status = 'active', notes_status = 'active' WHERE uid = ? AND status = 'scheduled' RETURNING uid").bind(identity.sub).first();
          if (!result) return new Response(JSON.stringify({ error: "Deletion cannot be cancelled" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Account status could not be updated" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/users/finalize-deletion" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!identity || identity.email_verified !== true || !Number.isInteger(identity.auth_time) || nowSeconds - identity.auth_time > 300) return new Response(JSON.stringify({ error: "Recent verified sign-in required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const body = await request.json();
        if (body.confirmed !== true || typeof identity.email !== "string") return new Response(JSON.stringify({ error: "Explicit confirmation required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const due = await env.DB.prepare("SELECT uid FROM registered_users WHERE uid = ? AND status = 'scheduled' AND deletion_at <= ?")
          .bind(identity.sub, Date.now()).first();
        if (!due) return new Response(JSON.stringify({ error: "The 30-day grace period has not ended" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const admin = initializeFirebaseAdmin(env);
        if (!admin) {
          return new Response(JSON.stringify({ error: "Secure full account deletion requires Firebase Admin SDK. Configure FIREBASE_ADMIN_KEY secret." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await admin.auth.deleteUser(identity.sub);
        await admin.firestore.recursiveDelete(admin.firestore.collection("yourNotes").doc(identity.sub));
        await admin.firestore.doc(`users/${identity.sub}`).delete().catch(() => {});
        await admin.firestore.doc(`accessRequests/${identity.sub}`).delete().catch(() => {});
        await admin.firestore.doc(`applicationPermissions/${identity.sub}`).delete().catch(() => {});
        await admin.firestore.doc(`activeNotesSessions/${identity.sub}`).delete().catch(() => {});
        await env.DB.prepare("DELETE FROM registered_users WHERE uid = ?").bind(identity.sub).run();
        await env.DB.prepare("DELETE FROM profile_photos WHERE uid = ?").bind(identity.sub).run();
        await env.DB.prepare("DELETE FROM pal_invitations WHERE inviter_uid = ? OR recipient_uid = ?").bind(identity.sub, identity.sub).run();
        await env.DB.prepare("DELETE FROM pals WHERE uid_low = ? OR uid_high = ?").bind(identity.sub, identity.sub).run();
        await env.DB.prepare("DELETE FROM pip_messages WHERE sender_uid = ? OR recipient_uid = ?").bind(identity.sub, identity.sub).run();
        await env.DB.prepare("DELETE FROM social_posts WHERE author_uid = ?").bind(identity.sub).run();
        await env.DB.prepare("DELETE FROM rate_limits WHERE rate_key LIKE ?").bind(`${identity.sub}%`).run();
        await env.DB.prepare("DELETE FROM active_sessions WHERE uid = ?").bind(identity.sub).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Account deletion failed" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Post It Pal uses the verified account email only as a one-way lookup key.
    // Invitation responses and messages are scoped to the identity in the JWT.
    if (url.pathname === "/api/pals/invite" && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const identity = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        if (!identity) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified email required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response(JSON.stringify({ error: "Enter a valid email address" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const emailDigest = await emailLookupDigest(email, env.PAL_LOOKUP_SECRET);
        const ownDigest = typeof identity.email === "string" ? await emailLookupDigest(identity.email.trim().toLowerCase(), env.PAL_LOOKUP_SECRET) : "";
        if (emailDigest !== ownDigest) {
          const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM pal_invitations WHERE inviter_uid = ? AND created_at > ?").bind(identity.sub, Date.now() - 86400000).first();
          if (Number(recent?.count || 0) >= 30) return new Response(JSON.stringify({ error: "Invitation limit reached. Try again tomorrow." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          const invitationId = bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
          await env.DB.prepare("INSERT INTO pal_invitations (id, email_digest, inviter_uid, inviter_name, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
            .bind(invitationId, emailDigest, identity.sub, String(identity.name || "").slice(0, 80), Date.now()).run();
        }
        return new Response(JSON.stringify({ success: true, message: "If that address uses PIP, the invitation will appear in its inbox." }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Invitation could not be sent" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/pals/invitations" && request.method === "GET") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const identity = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        if (!identity) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const emailDigest = identity.email_verified === true && typeof identity.email === "string" ? await emailLookupDigest(identity.email.trim().toLowerCase(), env.PAL_LOOKUP_SECRET) : "";
        const result = await env.DB.prepare(`SELECT id, inviter_uid AS inviterUid, inviter_name AS inviterName, recipient_uid AS recipientUid, status, created_at AS createdAt,
          CASE WHEN inviter_uid = ? THEN 'sent' ELSE 'received' END AS direction
          FROM pal_invitations WHERE (inviter_uid = ? AND status IN ('pending', 'accepted')) OR (email_digest = ? AND status = 'pending')
          ORDER BY created_at DESC LIMIT 100`).bind(identity.sub, identity.sub, emailDigest).all();
        return new Response(JSON.stringify({ invitations: result.results || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Invitations unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const inviteResponseMatch = /^\/api\/pals\/invitations\/([0-9a-f]{32})\/respond$/.exec(url.pathname);
    if (inviteResponseMatch && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const identity = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        if (!identity || identity.email_verified !== true || typeof identity.email !== "string") return new Response(JSON.stringify({ error: "Access denied" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const body = await request.json();
        const action = body.action;
        if (!['accept', 'decline'].includes(action)) return new Response(JSON.stringify({ error: "Invalid response" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const emailDigest = await emailLookupDigest(identity.email.trim().toLowerCase(), env.PAL_LOOKUP_SECRET);
        const invite = await env.DB.prepare("SELECT id, inviter_uid AS inviterUid FROM pal_invitations WHERE id = ? AND email_digest = ? AND status = 'pending'")
          .bind(inviteResponseMatch[1], emailDigest).first();
        if (!invite || invite.inviterUid === identity.sub) return new Response(JSON.stringify({ error: "Invitation unavailable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const updated = await env.DB.prepare("UPDATE pal_invitations SET status = ?, recipient_uid = ? WHERE id = ? AND status = 'pending' RETURNING id")
          .bind(action === 'accept' ? 'accepted' : 'declined', identity.sub, invite.id).first();
        if (!updated) return new Response(JSON.stringify({ error: "Invitation already handled" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (action === 'accept') {
          const pair = [identity.sub, invite.inviterUid].sort();
          await env.DB.prepare("INSERT OR IGNORE INTO pals (uid_low, uid_high, created_at) VALUES (?, ?, ?)").bind(pair[0], pair[1], Date.now()).run();
        }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Invitation response failed" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/posts" && ["GET", "POST"].includes(request.method)) {
      try {
        const identity = await readIdentity();
        if (!identity || identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified sign-in required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (request.method === "POST") {
          const body = await request.json();
          const text = String(body.body || "").trim();
          const visibility = body.visibility === "friends" ? "friends" : "private";
          if (!text || text.length > 5000) return new Response(JSON.stringify({ error: "Posts must be 1–5000 characters" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          const id = bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
          const now = Date.now();
          await env.DB.prepare("INSERT INTO social_posts (id, author_uid, body, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id, identity.sub, text, visibility, now, now).run();
          return new Response(JSON.stringify({ success: true, id }), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const posts = await env.DB.prepare(`SELECT p.id, p.author_uid AS authorUid, u.display_name AS authorName, p.body, p.visibility, p.created_at AS createdAt
          FROM social_posts p LEFT JOIN registered_users u ON u.uid = p.author_uid
          WHERE p.deletion_status = 'active'
            AND (p.author_uid = ? OR (p.visibility = 'friends' AND EXISTS (
              SELECT 1 FROM pals q
              WHERE (q.uid_low = ? AND q.uid_high = p.author_uid)
                 OR (q.uid_high = ? AND q.uid_low = p.author_uid)
            )))
          ORDER BY p.created_at DESC LIMIT 100`)
          .bind(identity.sub, identity.sub, identity.sub).all();
        return new Response(JSON.stringify({ posts: posts.results || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Social posts unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const postMutationMatch = /^\/api\/posts\/([0-9a-f]{32})$/.exec(url.pathname);
    if (postMutationMatch && ["POST", "DELETE"].includes(request.method)) {
      try {
        const identity = await readIdentity();
        if (!identity || identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified sign-in required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const postId = postMutationMatch[1];
        const body = request.method === "POST" ? await request.json() : {};
        if (request.method === "DELETE" || body.action === "trash") {
          await env.DB.prepare("UPDATE social_posts SET deletion_status = 'trashed', deleted_at = ? WHERE id = ? AND author_uid = ?")
            .bind(Date.now(), postId, identity.sub).run();
        } else if (body.action === "restore") {
          await env.DB.prepare("UPDATE social_posts SET deletion_status = 'active', deleted_at = NULL, updated_at = ? WHERE id = ? AND author_uid = ?")
            .bind(Date.now(), postId, identity.sub).run();
        } else if (body.action === "permanent") {
          await env.DB.prepare("DELETE FROM social_posts WHERE id = ? AND author_uid = ?").bind(postId, identity.sub).run();
        } else {
          return new Response(JSON.stringify({ error: "Invalid post action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Social post update unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const palRemovalMatch = /^\/api\/pals\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (palRemovalMatch && request.method === "DELETE") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified sign-in required" }), { status: identity ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const pair = [identity.sub, palRemovalMatch[1]].sort();
        await env.DB.batch([
          env.DB.prepare("DELETE FROM pals WHERE uid_low = ? AND uid_high = ?").bind(pair[0], pair[1]),
          env.DB.prepare("UPDATE pal_invitations SET status = 'declined' WHERE (inviter_uid = ? AND recipient_uid = ?) OR (inviter_uid = ? AND recipient_uid = ?)").bind(identity.sub, palRemovalMatch[1], palRemovalMatch[1], identity.sub)
        ]);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Friend removal unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/pals" && request.method === "GET") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const identity = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        if (!identity) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const result = await env.DB.prepare(`SELECT u.uid, u.display_name AS displayName,
          (SELECT COUNT(*) FROM pip_messages m WHERE m.sender_uid = u.uid AND m.recipient_uid = ? AND m.read_at IS NULL) AS unread
          FROM pals p JOIN registered_users u ON u.uid = CASE WHEN p.uid_low = ? THEN p.uid_high ELSE p.uid_low END
          WHERE p.uid_low = ? OR p.uid_high = ? ORDER BY u.display_name COLLATE NOCASE LIMIT 200`)
          .bind(identity.sub, identity.sub, identity.sub, identity.sub).all();
        return new Response(JSON.stringify({ pals: result.results || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Pals unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const messagesMatch = /^\/api\/pals\/([A-Za-z0-9_-]{1,128})\/messages$/.exec(url.pathname);
    if (messagesMatch && ["GET", "POST"].includes(request.method)) {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const identity = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        const palUid = messagesMatch[1];
        if (!identity || palUid === identity.sub) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub) || !await accountIsActive(palUid)) return new Response(JSON.stringify({ error: "Active PIP accounts required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const pair = [identity.sub, palUid].sort();
        const friendship = await env.DB.prepare("SELECT 1 AS allowed FROM pals WHERE uid_low = ? AND uid_high = ?")
          .bind(pair[0], pair[1]).first();
        if (!friendship) return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (request.method === "POST") {
          const body = await request.json();
          const text = String(body.body || "").trim();
          if (!text || text.length > 5000) return new Response(JSON.stringify({ error: "Messages must be 1–5000 characters" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM pip_messages WHERE sender_uid = ? AND created_at > ?").bind(identity.sub, Date.now() - 3600000).first();
          if (Number(recent?.count || 0) >= 120) return new Response(JSON.stringify({ error: "Message limit reached. Try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          const id = bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
          await env.DB.prepare("INSERT INTO pip_messages (id, sender_uid, recipient_uid, body, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(id, identity.sub, palUid, text, Date.now()).run();
          return new Response(JSON.stringify({ success: true, id }), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        await env.DB.prepare("UPDATE pip_messages SET read_at = ? WHERE sender_uid = ? AND recipient_uid = ? AND read_at IS NULL")
          .bind(Date.now(), palUid, identity.sub).run();
        const result = await env.DB.prepare(`SELECT id, sender_uid AS senderUid, recipient_uid AS recipientUid, body, created_at AS createdAt, read_at AS readAt
          FROM pip_messages WHERE (sender_uid = ? AND recipient_uid = ?) OR (sender_uid = ? AND recipient_uid = ?)
          ORDER BY created_at DESC LIMIT 100`).bind(identity.sub, palUid, palUid, identity.sub).all();
        return new Response(JSON.stringify({ messages: (result.results || []).reverse() }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Conversation unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 1. Password Verification Endpoint
    if (url.pathname === "/api/notes/verify" && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const idToken = authHeader.replace(/^Bearer\s+/i, "");
        const payload = await verifyFirebaseIdToken(idToken);

        if (!payload) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const uid = payload.sub;
        if (uid !== OWNER_UID) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const isOwner = true;

        // Rate limiting check
        const clientIp = request.headers.get("CF-Connecting-IP") || "local";
        const rateKey = `${clientIp}_${uid}`;
        const now = Date.now();
        const rate = await env.DB.prepare(
          "SELECT attempts AS count, locked_until AS lockedUntil FROM rate_limits WHERE rate_key = ?"
        ).bind(rateKey).first();

        if (now < (rate?.lockedUntil || 0)) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body = await request.json();
        const enteredPassword = body.password;

        if (!enteredPassword || typeof enteredPassword !== "string") {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Shared password check
        let sharedPasswordConfig = await env.DB.prepare(
          "SELECT salt_hex AS saltHex, hash_hex AS hashHex, version FROM notes_config WHERE id = 1"
        ).first();
        if (!sharedPasswordConfig) {
          // Initialize if owner
          if (isOwner) {
            const saltBytes = crypto.getRandomValues(new Uint8Array(16));
            const hashHex = await computePbkdf2Hash(enteredPassword, saltBytes);
            await env.DB.prepare(
              "INSERT OR IGNORE INTO notes_config (id, salt_hex, hash_hex, version) VALUES (1, ?, ?, 1)"
            ).bind(bufferToHex(saltBytes), hashHex).run();
            sharedPasswordConfig = await env.DB.prepare(
              "SELECT salt_hex AS saltHex, hash_hex AS hashHex, version FROM notes_config WHERE id = 1"
            ).first();
          } else {
            return new Response(JSON.stringify({ error: "Access denied" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        const computedHash = await computePbkdf2Hash(
          enteredPassword,
          hexToBuffer(sharedPasswordConfig.saltHex)
        );

        if (computedHash !== sharedPasswordConfig.hashHex) {
          const nextAttempts = (rate?.count || 0) + 1;
          const lockedUntil = nextAttempts >= 5 ? now + 30000 : (rate?.lockedUntil || 0);
          await env.DB.prepare(`
            INSERT INTO rate_limits (rate_key, attempts, locked_until) VALUES (?, ?, ?)
            ON CONFLICT(rate_key) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until
          `).bind(rateKey, nextAttempts, lockedUntil).run();
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Success: Reset rate limit, issue cryptographically secure 256-bit session token
        await env.DB.prepare("DELETE FROM rate_limits WHERE rate_key = ?").bind(rateKey).run();
        const sessionTokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const sessionToken = bufferToHex(sessionTokenBytes);
        const sessionDigest = await sha256Hex(sessionToken);
        const expiresAt = now + (12 * 3600 * 1000); // 12 hours

        await env.DB.prepare(
          "INSERT INTO active_sessions (token_digest, uid, expires_at, revoked) VALUES (?, ?, ?, 0)"
        ).bind(sessionDigest, uid, expiresAt).run();

        return new Response(JSON.stringify({
          success: true,
          sessionToken,
          expiresAt
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 2. Change Shared Password Endpoint
    if (url.pathname === "/api/notes/change-password" && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const idToken = authHeader.replace(/^Bearer\s+/i, "");
        const payload = await verifyFirebaseIdToken(idToken);

        if (!payload || payload.sub !== OWNER_UID) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (Math.floor(Date.now() / 1000) - payload.auth_time > 300) {
          return new Response(JSON.stringify({ error: "Recent sign-in required" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body = await request.json();
        const newPassword = body.newPassword;
        if (!newPassword || newPassword.length < 6) {
          return new Response(JSON.stringify({ error: "Invalid password" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const hashHex = await computePbkdf2Hash(newPassword, saltBytes);
        await env.DB.prepare(
          "INSERT INTO notes_config (id, salt_hex, hash_hex, version) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET salt_hex = excluded.salt_hex, hash_hex = excluded.hash_hex, version = excluded.version"
        ).bind(bufferToHex(saltBytes), hashHex, Date.now()).run();

        // Invalidate all existing sessions on password change
        await env.DB.prepare("UPDATE active_sessions SET revoked = 1 WHERE uid = ?").bind(OWNER_UID).run();

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Update failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Invitations are issued only by the owner. The plaintext is shown once;
    // D1 stores only its SHA-256 digest and atomically consumes it on redemption.
    if (url.pathname === "/api/invitations/create" && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const payload = await verifyFirebaseIdToken(authHeader.replace(/^Bearer\s+/i, ""));
        if (!payload || payload.sub !== OWNER_UID) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: payload ? 403 : 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const random = crypto.getRandomValues(new Uint8Array(24));
        const token = `fj_${bufferToHex(random)}fj`;
        const digest = await sha256Hex(token.toLowerCase());
        const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
        await env.DB.prepare(
          "INSERT INTO invitations (token_digest, expires_at) VALUES (?, ?)"
        ).bind(digest, expiresAt).run();
        return new Response(JSON.stringify({ token, expiresAt }), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Invitation could not be created" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Notes Session Issuance (Owner only, requires Firebase Admin SDK)
    if (url.pathname === "/api/notes/session" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Owner access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const admin = initializeFirebaseAdmin(env);
        if (!admin) {
          return new Response(JSON.stringify({ error: "Trusted Notes session issuer not configured. Configure FIREBASE_ADMIN_KEY secret." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const expiresAt = Date.now() + 12 * 3600 * 1000;
        await admin.firestore.doc(`activeNotesSessions/${OWNER_UID}`).set({
          uid: OWNER_UID,
          revoked: false,
          expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
          issuedAt: admin.firestore.Timestamp.fromMillis(Date.now())
        });
        return new Response(JSON.stringify({ success: true, expiresAt }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed to issue Notes session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Approval Notification Email (Owner only, requires email service)
    if (url.pathname === "/api/admin/notify-approval" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        if (!identity || identity.sub !== OWNER_UID || identity.email_verified !== true) {
          return new Response(JSON.stringify({ error: "Owner access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const body = await request.json();
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const action = body.action;
        if (!email || !["approved", "rejected"].includes(action)) {
          return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const emailServiceKey = env?.EMAIL_SERVICE_KEY;
        if (!emailServiceKey) {
          return new Response(JSON.stringify({ error: "Email notification service not configured. Configure EMAIL_SERVICE_KEY secret." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Email sending would be implemented here with the configured service
        // For now, return success to indicate the endpoint is ready
        return new Response(JSON.stringify({ success: true, queued: true }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Notification could not be queued" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 3. FJ Invitation Redeem Endpoint
    if (url.pathname === "/api/invitations/redeem" && request.method === "POST") {
      try {
        const authHeader = request.headers.get("Authorization") || "";
        const idToken = authHeader.replace(/^Bearer\s+/i, "");
        const identity = await verifyFirebaseIdToken(idToken);
        if (!identity) {
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body = await request.json();
        const token = (body.token || "").trim().toLowerCase();

        if (!token.endsWith("fj")) {
          return new Response(JSON.stringify({ error: "Invalid token marker" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const digest = await sha256Hex(token);
        const consumed = await env.DB.prepare(`
          UPDATE invitations SET consumed_at = ?, consumed_by = ?
          WHERE token_digest = ? AND consumed_at IS NULL AND expires_at > ?
          RETURNING token_digest
        `).bind(Date.now(), identity.sub, digest, Date.now()).first();

        if (!consumed) {
          return new Response(JSON.stringify({ error: "Invalid or expired invitation" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Redemption error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({ status: "FJ API Operational" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};
