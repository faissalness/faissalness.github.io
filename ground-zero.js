/**
 * Ground Zero 00 — Owner/Admin Control Center
 *
 * Two distinct permission systems:
 *  - Website authorization: Firestore `users/{uid}.approved` — gates the main
 *    FJ website (app.js sign-in gate). Enforced by Firestore rules (owner update).
 *  - PIP + Your Notes authorization: D1 `registered_users.pip_status/notes_status`
 *    + the Firestore `applicationPermissions/{uid}` mirror — enforced by the
 *    Worker backend (accountIsActive) and Firestore rules
 *    (applicationPermissionActive).
 *
 * All mutations are owner-only (Worker verifies the owner UID from the
 * authenticated token; Firestore rules enforce owner-only writes).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { connectAuthEmulator, getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { connectFirestoreEmulator, doc, getDoc, collection, getDocs, getFirestore, updateDoc, setDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";

const $ = sel => document.querySelector(sel);
const status = $("#gz-status");
const API = "https://fj-api.jimyass.workers.dev";

// Use the default Firebase app instance so this page reads the same persisted
// auth state that the main site (app.js) wrote during sign-in. Firebase namespaces
// auth persistence per app name, so a custom instance name here would create a
// parallel auth state store and hide the restored owner session.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (location.hostname === "127.0.0.1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

let accounts = [];
let admins = new Map();

function setStatus(message, kind = "info") {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = kind;
  status.hidden = !message;
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

function statusLabel(value) {
  if (value === "active") return "Active";
  if (value === "revoked") return "Revoked";
  if (value === "pending") return "Pending";
  if (value === "scheduled") return "Suspended";
  return value ? String(value) : "Unavailable";
}

function badge(value) {
  const el = document.createElement("span");
  const tone = ["active", "revoked", "pending", "unavailable"].includes(value) ? value : "unavailable";
  el.className = `gz-badge gz-badge-${tone}`;
  el.textContent = statusLabel(value);
  return el;
}

function brief(uid) {
  return uid ? uid.slice(0, 8) + "…" : "";
}

async function workerAction(path, body) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? "{}" : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function workerGet(path) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, "Accept": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function loadAdmins() {
  const snap = await getDocs(collection(db, "admins"));
  admins = new Map();
  for (const docSnap of snap.docs) {
    if (docSnap.exists()) admins.set(docSnap.id, docSnap.data());
  }
}

async function loadAccounts() {
  const data = await workerGet("/api/admin/accounts");
  accounts = data.accounts || [];
  const tbody = $("#gz-accounts-table");
  if (!tbody) return;
  tbody.replaceChildren();
  const query = ($("#gz-search")?.value || "").trim().toLowerCase();
  const visible = accounts.filter(a =>
    !query ||
    (a.email || "").toLowerCase().includes(query) ||
    (a.displayName || "").toLowerCase().includes(query) ||
    a.uid.toLowerCase().includes(query));
  if (!visible.length) {
    $("#gz-empty").hidden = false;
    return;
  }
  $("#gz-empty").hidden = true;
  for (const account of visible) {
    const row = document.createElement("tr");
    const makeCell = text => { const td = document.createElement("td"); td.textContent = text; return td; };
    const makeBadgeCell = value => { const td = document.createElement("td"); td.append(badge(value)); return td; };
    row.append(
      makeCell(account.email || "(no Firebase account)"),
      makeCell(account.displayName || brief(account.uid)),
      makeCell(account.uid),
      makeBadgeCell(account.status || "unavailable"),
      makeCell(account.approved ? "Approved" : "Pending"),
      makeBadgeCell(account.pipStatus),
      makeBadgeCell(account.notesStatus)
    );
    const actions = document.createElement("td");
    actions.className = "gz-actions";
    const addAction = (label, kind, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => runAction(account.uid, label, kind, action, button));
      actions.append(button);
    };
    const addConfirm = (label, kind, action, confirmText) => {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("danger-btn");
      button.textContent = label;
      button.addEventListener("click", () => {
        if (!confirm(confirmText)) return;
        runAction(account.uid, label, kind, action, button);
      });
      actions.append(button);
    };
    addAction("Approve Website", "website", "approve");
    addAction("Reject Website", "website", "reject");
    addAction("Approve PIP", "pip", "approve");
    addAction("Revoke PIP", "pip", "revoke");
    addAction("Approve Notes", "notes", "approve");
    addAction("Revoke Notes", "notes", "revoke");
    addAction("Approve Both", "both", "approve");
    addAction("Revoke Both", "both", "revoke");
    addAction("Suspend", "account", "suspend");
    addAction("Reactivate", "account", "reactivate");
    addConfirm("Delete", "delete", "delete", `Delete account ${account.email || account.uid}? This removes the account and its records; it cannot be undone.`);
    row.append(actions);
    tbody.append(row);
  }
}

// --- Actions: website vs PIP/Notes stay separate permission systems ---

async function runAction(uid, label, kind, action, button) {
  setBusy(button, true, "Working…");
  setStatus(`Working on ${label}…`);
  try {
    if (kind === "website") {
      // Website authorization: Firestore users/{uid}.approved (owner-only writes via rules).
      const userRef = doc(db, "users", uid);
      if ((await getDoc(userRef)).exists()) {
        await updateDoc(userRef, { approved: action === "approve" });
      }
    } else if (kind === "pip" || kind === "notes" || kind === "both") {
      // PIP + Your Notes authorization: Worker D1 update + Firestore mirror.
      await workerAction("/api/admin/permissions", { uid, target: kind, action });
      const existing = ((await getDoc(doc(db, "applicationPermissions", uid))).data()) || {};
      await setDoc(doc(db, "applicationPermissions", uid), {
        pipStatus: (kind === "pip" || kind === "both") ? (action === "approve" ? "active" : "revoked") : (existing.pipStatus || "pending"),
        notesStatus: (kind === "notes" || kind === "both") ? (action === "approve" ? "active" : "revoked") : (existing.notesStatus || "pending"),
        updatedAt: serverTimestamp()
      }, { merge: true });
      if ((kind === "pip" || kind === "both") && action === "approve") {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && userSnap.data().approved !== true) {
          await updateDoc(userRef, { approved: true });
        }
      }
    } else if (kind === "account") {
      await workerAction(`/api/admin/accounts/${uid}/${action}`, {});
    } else if (kind === "delete") {
      await workerAction(`/api/admin/accounts/${uid}/delete`, {});
      const batch = writeBatch();
      for (const ref of [doc(db, "users", uid), doc(db, "accessRequests", uid), doc(db, "applicationPermissions", uid), doc(db, "yourNotes", uid)]) {
        batch.delete(ref);
      }
      batch.delete(doc(db, "activeNotesSessions", uid));
      await batch.commit();
    }
    setStatus(`${label} completed for ${brief(uid)}.`, "success");
  } catch (error) {
    setStatus(`Could not complete ${label}: ${error.message}`, "error");
  } finally {
    setBusy(button, false);
    await loadAccounts();
  }
}

// --- Admin authorization (owner only) ---

async function authorizeAdmin() {
  const uid = $("#gz-admin-uid").value.trim();
  const email = $("#gz-admin-email").value.trim().toLowerCase();
  if (!uid) { setStatus("Enter a UID to authorize an admin.", "error"); return; }
  try {
    await setDoc(doc(db, "admins", uid), { uid, email: email || "", active: true, createdAt: serverTimestamp() }, { merge: true });
    setStatus(`${uid} is now an authorized admin.`, "success");
    await loadAdmins();
    await loadAccounts();
  } catch (error) { setStatus(`Could not authorize admin: ${error.message}`, "error"); }
  finally { $("#gz-admin-uid").value = ""; $("#gz-admin-email").value = ""; }
}

async function deactivateAdmin(uid, button) {
  setBusy(button, true, "Deactivating…");
  try {
    await updateDoc(doc(db, "admins", uid), { active: false });
    setStatus(`Admin ${uid} deactivated.`, "success");
    await loadAdmins();
    await loadAccounts();
  } catch (error) { setStatus(`Could not deactivate admin: ${error.message}`, "error"); }
  finally { setBusy(button, false); }
}

function renderAdmins() {
  const list = $("#gz-admins-list");
  list.replaceChildren();
  if (!admins.size) {
    const empty = document.createElement("p");
    empty.className = "gz-sub";
    empty.textContent = "No authorized admins yet.";
    list.append(empty);
    return;
  }
  for (const [uid, data] of admins) {
    const row = document.createElement("div");
    row.className = "gz-admin-row";
    const text = document.createElement("span");
    text.textContent = `${data.email || uid} (${uid})${data.active === false ? " — inactive" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = data.active === false ? "Reactivate" : "Deactivate";
    button.addEventListener("click", () => deactivateAdmin(uid, button));
    row.append(text, button);
    list.append(row);
  }
}

// --- Events ---

$("#gz-search")?.addEventListener("input", () => loadAccounts());
$("#gz-refresh")?.addEventListener("click", () => loadAccounts());
$("#gz-admin-form")?.addEventListener("submit", event => {
  event.preventDefault();
  authorizeAdmin();
});

function redirectHome() { window.location.href = "/"; }

// Ground Zero 00 — deterministic auth state machine (per Firebase docs):
//   INITIALIZING -> AUTHENTICATED -> AUTHORIZED
//                -> UNAUTHORIZED (settled but not owner/admin)
//                -> ERROR      (settled, technical failure — shown, not redirected)
// Never redirect during INITIALIZING; never treat backend errors as "signed out".
let gzStatus = "INITIALIZING";
let gzUser = null;

function setGzStatus(state) { gzStatus = state; }

function setGzError(message) {
  setGzStatus("ERROR");
  setStatus(message, "error");
}

function gzDisplayLoading() {
  setStatus("Verifying access to Ground Zero 00…", "info");
  const table = $("#gz-accounts-table");
  if (table) table.hidden = true;
  // Hide the hero and main page content while the access decision is pending so
  // the Ground Zero screen never flashes before authorization is determined.
  const hero = document.querySelector(".gz-hero");
  const page = document.querySelector(".gz-page");
  if (hero) hero.hidden = true;
  if (page) page.hidden = true;
}

function gzShowContent() {
  const hero = document.querySelector(".gz-hero");
  const page = document.querySelector(".gz-page");
  if (hero) hero.removeAttribute("hidden");
  if (page) page.removeAttribute("hidden");
}

async function gzCheckAuthorization(user) {
  await gzWaitForAuthSettled();
  if (!user) { gzStatus = "UNAUTHORIZED"; redirectHome(); return; }
  gzUser = user;
  setGzStatus("AUTHENTICATED");
  let authorized = false;
  if (gzUser.uid === ownerUid) {
    // The owner bypasses every application and permission state.
    authorized = true;
  } else {
    try { await loadAdmins(); } catch (_) { admins = new Map(); }
    renderAdmins();
    if (admins.has(gzUser.uid)) {
      const adminRecord = admins.get(gzUser.uid);
      authorized = Boolean(adminRecord) && adminRecord.active !== false;
    }
  }
  if (!authorized) {
    gzStatus = "UNAUTHORIZED";
    setStatus("Ground Zero 00 is exclusively for the owner and authorized admins.", "error");
    redirectHome();
    return;
  }
  gzStatus = "AUTHORIZED";
  gzShowContent();
  setStatus("");
  try { await loadAccounts(); } catch (error) { setGzError(`Could not load accounts: ${error.message}`); }
}

async function gzWaitForAuthSettled() {
  // Official deterministic settlement signal (auth.authStateReady()). The
  // onAuthStateChanged listener registration itself awaits Auth initialization
  // before invoking its callback, so evaluation never runs mid-INITIALIZING.
  try { await auth.authStateReady(); } catch (_) { /* use the settled user from the listener */ }
}

onAuthStateChanged(auth, async user => {
  gzDisplayLoading();
  await gzCheckAuthorization(user);
}, authError => {
  // Technical failures surface as ERROR and are shown — never disguised as signed-out states.
  setGzError(`Ground Zero 00 access check failed: ${authError?.message || "unknown error"}`);
});
