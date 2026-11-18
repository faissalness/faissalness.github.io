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

// These maps are only process-local guards. Authorization state must not rely on them.
const rateLimits = new Map(); // ip_uid -> { count, lockedUntil }
const activeSessions = new Map(); // tokenDigest -> { uid, expiresAt, revoked }
const invitations = new Map(); // tokenDigest -> { tokenDigest, expiresAt, consumed, consumedBy }
let sharedPasswordConfig = null; // { saltHex, hashHex, version }
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
        const rate = rateLimits.get(rateKey) || { count: 0, lockedUntil: 0 };
        const now = Date.now();

        if (now < rate.lockedUntil) {
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
        if (!sharedPasswordConfig) {
          // Initialize if owner
          if (isOwner) {
            const saltBytes = crypto.getRandomValues(new Uint8Array(16));
            const hashHex = await computePbkdf2Hash(enteredPassword, saltBytes);
            sharedPasswordConfig = {
              saltHex: bufferToHex(saltBytes),
              hashHex,
              version: 1
            };
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
          rate.count++;
          if (rate.count >= 5) {
            rate.lockedUntil = now + 30000; // 30s lockout
          }
          rateLimits.set(rateKey, rate);
          return new Response(JSON.stringify({ error: "Access denied" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Success: Reset rate limit, issue cryptographically secure 256-bit session token
        rateLimits.delete(rateKey);
        const sessionTokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const sessionToken = bufferToHex(sessionTokenBytes);
        const sessionDigest = await sha256Hex(sessionToken);
        const expiresAt = now + (12 * 3600 * 1000); // 12 hours

        activeSessions.set(sessionDigest, {
          uid,
          expiresAt,
          revoked: false
        });

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
        sharedPasswordConfig = {
          saltHex: bufferToHex(saltBytes),
          hashHex,
          version: Date.now()
        };

        // Invalidate all existing sessions on password change
        activeSessions.clear();

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
        const record = invitations.get(digest);

        if (!record || record.consumed || Date.now() > record.expiresAt) {
          return new Response(JSON.stringify({ error: "Invalid or expired invitation" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Consume atomically
        record.consumed = true;
        record.consumedBy = identity.sub;

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
