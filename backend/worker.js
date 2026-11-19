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
    const now = Date.now();
    const due = await env.DB.prepare("SELECT uid FROM registered_users WHERE status = 'scheduled' AND deletion_at <= ?")
      .bind(now).all();
    for (const account of due.results || []) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM pip_messages WHERE sender_uid = ? OR recipient_uid = ?").bind(account.uid, account.uid),
        env.DB.prepare("DELETE FROM pals WHERE uid_low = ? OR uid_high = ?").bind(account.uid, account.uid),
        env.DB.prepare("UPDATE registered_users SET status = 'active', deletion_at = NULL WHERE uid = ?").bind(account.uid)
      ]);
    }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("Origin");
    const corsHeaders = {
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      const account = await env.DB.prepare("SELECT status FROM registered_users WHERE uid = ?").bind(uid).first();
      return account?.status === "active";
    };

    if (url.pathname === "/api/users/count" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM registered_users WHERE status = 'active'").first();
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
        await env.DB.prepare("INSERT OR IGNORE INTO registered_users (uid, registered_at, display_name, email_digest) VALUES (?, ?, ?, ?)")
          .bind(identity.sub, Date.now(), String(identity.name || "").slice(0, 80), emailDigest).run();
        await env.DB.prepare("UPDATE registered_users SET display_name = ?, email_digest = ? WHERE uid = ?")
          .bind(String(identity.name || "").slice(0, 80), emailDigest, identity.sub).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Registration could not be recorded" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/admin/lookup" && request.method === "POST") {
      try {
        const identity = await readIdentity();
        if (!identity) return new Response(JSON.stringify({ error: "Access denied" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (identity.email_verified !== true) return new Response(JSON.stringify({ error: "Verified email required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (!await accountIsActive(identity.sub)) return new Response(JSON.stringify({ error: "Active PIP account required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        const now = Date.now();
        const account = await env.DB.prepare("SELECT status, deletion_at AS deletionAt FROM registered_users WHERE uid = ?").bind(identity.sub).first();
        if (!account) return new Response(JSON.stringify({ error: "PIP account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (body.action === "schedule") {
          const deletionAt = now + 30 * 24 * 60 * 60 * 1000;
          await env.DB.prepare("UPDATE registered_users SET status = 'scheduled', deletion_at = ? WHERE uid = ? AND status = 'active'").bind(deletionAt, identity.sub).run();
          return new Response(JSON.stringify({ success: true, deletionAt }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (body.action === "cancel") {
          const result = await env.DB.prepare("UPDATE registered_users SET status = 'active', deletion_at = NULL WHERE uid = ? AND status = 'scheduled' AND deletion_at > ? RETURNING uid").bind(identity.sub, now).first();
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
        const emailDigest = await emailLookupDigest(identity.email.trim().toLowerCase(), env.PAL_LOOKUP_SECRET);
        const due = await env.DB.prepare("SELECT uid FROM registered_users WHERE uid = ? AND status = 'scheduled' AND deletion_at <= ?")
          .bind(identity.sub, Date.now()).first();
        if (!due) return new Response(JSON.stringify({ error: "The 30-day grace period has not ended" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        await env.DB.batch([
          env.DB.prepare("DELETE FROM pip_messages WHERE sender_uid = ? OR recipient_uid = ?").bind(identity.sub, identity.sub),
          env.DB.prepare("DELETE FROM pals WHERE uid_low = ? OR uid_high = ?").bind(identity.sub, identity.sub),
          env.DB.prepare("DELETE FROM pal_invitations WHERE inviter_uid = ? OR recipient_uid = ? OR email_digest = ?").bind(identity.sub, identity.sub, emailDigest),
          env.DB.prepare("DELETE FROM registered_users WHERE uid = ?").bind(identity.sub)
        ]);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (_) {
        return new Response(JSON.stringify({ error: "Post It Pal account data could not be removed" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        const result = await env.DB.prepare(`SELECT id, inviter_uid AS inviterUid, inviter_name AS inviterName, status, created_at AS createdAt,
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
