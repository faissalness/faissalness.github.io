import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { connectAuthEmulator, getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  connectFirestoreEmulator, getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy,
  onSnapshot, serverTimestamp, updateDoc, deleteDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// DOM Elements
const $ = sel => document.querySelector(sel);
const topbar = $("#topbar");

const notesApp = $("#notes-app");
const notesList = $("#notes-list");
const noteForm = $("#note-form");
const noteTitle = $("#note-title");
const noteTags = $("#note-tags");
const noteContent = $("#note-content");
const saveIndicator = $("#save-indicator");
const deleteNoteBtn = $("#delete-note-btn");
const newNoteBtn = $("#new-note-btn");
const notesSearch = $("#notes-search");
const attachmentFileInput = $("#attachment-file-input");
const attachmentsGallery = $("#attachments-gallery");
const attachmentCountSpan = $("#attachment-count");
const exportBackupBtn = $("#export-backup-btn");
const importBackupFile = $("#import-backup-file");
const manageAdminsBtn = $("#manage-admins-btn");
const adminDrawer = $("#admin-drawer");
const adminDrawerClose = $("#admin-drawer-close");
const addAdminForm = $("#add-admin-form");
const adminsList = $("#admins-list");
const changePasswordForm = $("#change-shared-password-form");
const generateInviteForm = $("#generate-invitation-form");
const newSharedPasswordInput = $("#new-shared-password");
const confirmSharedPasswordInput = $("#confirm-shared-password");
const passwordChangeStatus = $("#password-change-status");
const invitationResultBox = $("#invitation-result-box");
const invitationTokenDisplay = $("#invitation-token-display");

// In-Memory Session State (Strictly never persisted to localStorage, sessionStorage or IndexedDB)
let currentUser = null;
let isOwner = false;
let isNotesUnlocked = false;
let sessionExpiresAt = 0;
let resolveInitialAuthState;
const initialAuthState = new Promise(resolve => { resolveInitialAuthState = resolve; });

let currentNoteId = null;
let allNotes = [];
let currentAttachments = []; // Array of { id, name, size, type, dataUrl }
let unsubscribeNotes = null;

// Cryptographic Primitives (Web Crypto API: PBKDF2-SHA256, 100,000 iterations)
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
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

async function sha256DigestHex(str) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return bufferToHex(digest);
}

function lockNotesGate() {
  isNotesUnlocked = false;
  sessionExpiresAt = 0;
  clearPrivateNotesFromMemory();

  if (unsubscribeNotes) {
    unsubscribeNotes();
    unsubscribeNotes = null;
  }

  topbar.hidden = true;
  notesApp.hidden = true;
  manageAdminsBtn.hidden = true;
  adminDrawer.hidden = true;
}

// IndexedDB Storage for Attachments & Offline Notes
const IDB_NAME = "FJ_NOTES_DB";
const IDB_STORE = "attachments";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAttachmentToIDB(attachment) {
  try {
    const idb = await openDB();
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(attachment);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (err) {
    console.error("IndexedDB save error:", err);
  }
}

async function getAttachmentFromIDB(id) {
  try {
    const idb = await openDB();
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch (err) {
    console.error("IndexedDB read error:", err);
    return null;
  }
}

async function deleteAttachmentFromIDB(id) {
  try {
    const idb = await openDB();
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
  } catch (err) {
    console.error("IndexedDB delete error:", err);
  }
}

function clearPrivateNotesFromMemory() {
  allNotes = [];
  currentNoteId = null;
  currentAttachments = [];

  notesList.replaceChildren();
  noteTitle.value = "";
  noteTags.value = "";
  noteContent.value = "";

  renderAttachmentsGallery();
}

// Persistent lock gate enforcement
function unlockNotesApp() {
  topbar.hidden = false;
  notesApp.hidden = false;
  manageAdminsBtn.hidden = !isOwner;
  notesApp.classList.add("home-reveal");

  initNotesRealtime();
}

// Notes uses the main FJ website session only — there is no second login.
onAuthStateChanged(auth, async user => {
  if (resolveInitialAuthState) {
    resolveInitialAuthState();
    resolveInitialAuthState = null;
  }
  if (!user) {
    currentUser = null;
    isOwner = false;
    lockNotesGate();
    // Users authenticate through the main FJ website; there is no separate
    // login here, so unauthenticated visitors return to the main website.
    window.location.href = "/";
    return;
  }

  // Update user reference
  currentUser = user;
  isOwner = (user.uid === ownerUid);

  // The owner bypasses the trusted-session and secondary Notes gates and
  // enters Notes immediately after main-website authentication.
  if (isOwner) {
    isNotesUnlocked = true;
    sessionExpiresAt = Date.now() + (12 * 3600 * 1000);
    unlockNotesApp();
    return;
  }

  // Notes is exclusively the owner's application; other accounts are locked.
  lockNotesGate();
});
// Notes CRUD & Realtime Listener
function initNotesRealtime() {
  if (unsubscribeNotes) unsubscribeNotes();

  const q = query(
    collection(db, "privateNotes"),
    orderBy("updatedAt", "desc")
  );

  unsubscribeNotes = onSnapshot(q, snapshot => {
    allNotes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNotesList(filterNotes(notesSearch.value.trim()));
    // If current note was updated externally, refresh editor
    if (currentNoteId) {
      const active = allNotes.find(n => n.id === currentNoteId);
      if (active && document.activeElement !== noteContent && document.activeElement !== noteTitle) {
        loadNoteIntoEditor(active, false);
      }
    }
  }, err => {
    console.error("Firestore notes read denied or error:", err);

    if (err.code === "permission-denied") {
      console.error("Firestore authorization was revoked or denied.");
      lockNotesGate();
      return;
    }

    $("#storage-status-text").textContent =
      "Firestore connection error";
  });
}

function filterNotes(queryStr) {
  if (!queryStr) return allNotes;
  const lower = queryStr.toLowerCase();
  return allNotes.filter(n => {
    const inTitle = (n.title || "").toLowerCase().includes(lower);
    const inContent = (n.content || "").toLowerCase().includes(lower);
    const inTags = (n.tags || []).some(t => t.toLowerCase().includes(lower));
    return inTitle || inContent || inTags;
  });
}

function renderNotesList(notes) {
  notesList.replaceChildren();
  if (notes.length === 0) {
    const empty = document.createElement("p");
    empty.style.color = "#777";
    empty.style.fontSize = "11px";
    empty.style.padding = "10px";
    empty.textContent = "No notes found.";
    notesList.append(empty);
    return;
  }

  notes.forEach(note => {
    const item = document.createElement("div");
    item.className = `note-item ${note.id === currentNoteId ? "active" : ""}`;
    item.tabIndex = 0;

    const title = document.createElement("h3");
    title.className = "note-item-title";
    title.textContent = note.title || "Untitled Note";

    const meta = document.createElement("div");
    meta.className = "note-item-meta";
    const dateStr = note.updatedAt ? new Date(note.updatedAt.toDate ? note.updatedAt.toDate() : note.updatedAt).toLocaleDateString() : "Just now";
    meta.textContent = `${dateStr} • ${note.attachmentsMeta?.length || 0} files`;

    item.append(title, meta);

    if (note.tags && note.tags.length > 0) {
      const tagsContainer = document.createElement("div");
      tagsContainer.className = "note-item-tags";
      note.tags.forEach(t => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.textContent = t.startsWith("#") ? t : `#${t}`;
        tagsContainer.append(pill);
      });
      item.append(tagsContainer);
    }

    item.addEventListener("click", () => loadNoteIntoEditor(note, true));
    item.addEventListener("keydown", e => { if (e.key === "Enter") loadNoteIntoEditor(note, true); });
    notesList.append(item);
  });
}

notesSearch.addEventListener("input", e => {
  renderNotesList(filterNotes(e.target.value.trim()));
});

async function loadNoteIntoEditor(note, fetchAttachments = true) {
  currentNoteId = note.id;
  noteTitle.value = note.title || "";
  noteContent.value = note.content || "";
  noteTags.value = (note.tags || []).join(", ");
  deleteNoteBtn.hidden = false;

  renderNotesList(filterNotes(notesSearch.value.trim()));

  if (fetchAttachments) {
    currentAttachments = [];
    if (note.attachmentsMeta && note.attachmentsMeta.length > 0) {
      for (const meta of note.attachmentsMeta) {
        const fullAtt = await getAttachmentFromIDB(meta.id);
        if (fullAtt) {
          currentAttachments.push(fullAtt);
        } else {
          currentAttachments.push(meta); // fallback to meta
        }
      }
    }
    renderAttachmentsGallery();
  }
}

newNoteBtn.addEventListener("click", () => {
  currentNoteId = null;
  noteTitle.value = "";
  noteContent.value = "";
  noteTags.value = "";
  currentAttachments = [];
  deleteNoteBtn.hidden = true;
  renderAttachmentsGallery();
  renderNotesList(filterNotes(notesSearch.value.trim()));
  noteTitle.focus();
});

// Note Form Save
noteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const title = noteTitle.value.trim();
  const content = noteContent.value;
  const rawTags = noteTags.value.split(/[,\s]+/).map(t => t.trim().replace(/^#/, "")).filter(Boolean);

  const saveBtn = $("#save-note-btn");
  saveBtn.disabled = true;

  try {
    // Save attachments to IndexedDB
    const attachmentsMeta = [];
    for (const att of currentAttachments) {
      await saveAttachmentToIDB(att);
      attachmentsMeta.push({
        id: att.id,
        name: att.name,
        size: att.size,
        type: att.type
      });
    }

    const notePayload = {
      title,
      content,
      tags: rawTags,
      authorUid: currentUser.uid,
      updatedAt: serverTimestamp(),
      attachmentsMeta
    };

    if (currentNoteId) {
      await updateDoc(doc(db, "privateNotes", currentNoteId), notePayload);
    } else {
      notePayload.createdAt = serverTimestamp();
      const newDocRef = doc(collection(db, "privateNotes"));
      await setDoc(newDocRef, notePayload);
      currentNoteId = newDocRef.id;
    }

    flashSaveIndicator();
  } catch (err) {
    alert(`Could not save note to Firestore: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
  }
});

function flashSaveIndicator() {
  saveIndicator.classList.add("visible");
  setTimeout(() => saveIndicator.classList.remove("visible"), 2000);
}

// Delete Note
deleteNoteBtn.addEventListener("click", async () => {
  if (!currentNoteId) return;
  if (!confirm("Are you sure you want to delete this note?")) return;

  try {
    for (const att of currentAttachments) {
      await deleteAttachmentFromIDB(att.id);
    }
    await deleteDoc(doc(db, "privateNotes", currentNoteId));
    newNoteBtn.click();
  } catch (err) {
    alert(`Could not delete note: ${err.message}`);
  }
});

// Attachment Handling: File Input & Paste
attachmentFileInput.addEventListener("change", async event => {
  const files = Array.from(event.target.files);
  for (const file of files) {
    await processAndAddAttachment(file);
  }
  attachmentFileInput.value = "";
  renderAttachmentsGallery();
});

// Paste Handling: Text & Images
window.addEventListener("paste", async event => {
  // Only handle paste if user is in notes app
  if (notesApp.hidden) return;

  const items = event.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        await processAndAddAttachment(file);
        renderAttachmentsGallery();
        flashSaveIndicator();
      }
    }
  }
});

async function processAndAddAttachment(file) {
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const dataUrl = await readFileAsDataURL(file);
  currentAttachments.push({
    id,
    name: file.name || "Pasted-Image.png",
    size: file.size,
    type: file.type || "image/png",
    dataUrl
  });
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

function renderAttachmentsGallery() {
  attachmentsGallery.replaceChildren();
  attachmentCountSpan.textContent = currentAttachments.length;

  currentAttachments.forEach((att, idx) => {
    const card = document.createElement("div");
    card.className = "attachment-card";

    if (att.type?.startsWith("image/") && att.dataUrl) {
      const img = document.createElement("img");
      img.src = att.dataUrl;
      img.alt = att.name;
      card.append(img);
    } else {
      const icon = document.createElement("div");
      icon.className = "file-icon";
      icon.textContent = `${att.name.slice(0, 10)}\n${Math.round(att.size / 1024)}KB`;
      card.append(icon);
    }

    if (att.dataUrl) {
      const dload = document.createElement("a");
      dload.className = "att-download";
      dload.href = att.dataUrl;
      dload.download = att.name;
      dload.textContent = "DL";
      card.append(dload);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "att-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove attachment";
    removeBtn.addEventListener("click", () => {
      deleteAttachmentFromIDB(att.id);
      currentAttachments.splice(idx, 1);
      renderAttachmentsGallery();
    });
    card.append(removeBtn);

    attachmentsGallery.append(card);
  });
}

// Backup Export & Import (JSON)
exportBackupBtn.addEventListener("click", async () => {
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    notes: allNotes,
    attachments: []
  };

  try {
    const idb = await openDB();
    const tx = idb.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const allAttsReq = store.getAll();

    allAttsReq.onsuccess = () => {
      exportData.attachments = allAttsReq.result || [];
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fj-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
});

importBackupFile.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.notes || !Array.isArray(data.notes)) {
      throw new Error("Invalid backup format: notes array missing.");
    }

    if (!confirm(`Import ${data.notes.length} notes and ${data.attachments?.length || 0} attachments from backup?`)) {
      return;
    }

    // Restore attachments to IDB
    if (data.attachments && Array.isArray(data.attachments)) {
      const idb = await openDB();
      const tx = idb.transaction(IDB_STORE, "readwrite");
      for (const att of data.attachments) {
        tx.objectStore(IDB_STORE).put(att);
      }
    }

    // Restore notes to Firestore
    for (const n of data.notes) {
      const { id, ...rest } = n;
      rest.updatedAt = serverTimestamp();
      await setDoc(doc(db, "privateNotes", id || doc(collection(db, "privateNotes")).id), rest);
    }

    alert("Backup imported successfully.");
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  } finally {
    importBackupFile.value = "";
  }
});

// Admin Management (Owner Only)
manageAdminsBtn.addEventListener("click", () => {
  adminDrawer.hidden = false;
  loadAdminsList();
});
adminDrawerClose.addEventListener("click", () => {
  adminDrawer.hidden = true;
});

async function loadAdminsList() {
  adminsList.replaceChildren();
  try {
    const snap = await getDocs(collection(db, "admins"));
    if (snap.empty) {
      adminsList.innerHTML = "<p style='color:#777;font-size:11px'>No external administrators configured.</p>";
      return;
    }

    snap.forEach(d => {
      const data = d.data();
      const row = document.createElement("div");
      row.className = "admin-item";

      const info = document.createElement("span");
      info.textContent = `${data.email || data.uid} ${data.active ? "(Active)" : "(Revoked)"}`;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "revoke-btn";
      btn.textContent = data.active ? "Revoke" : "Re-activate";
      btn.addEventListener("click", async () => {
        await updateDoc(d.ref, { active: !data.active, updatedAt: serverTimestamp() });
        loadAdminsList();
      });

      row.append(info, btn);
      adminsList.append(row);
    });
  } catch (err) {
    adminsList.innerHTML = `<p style='color:#ff71b8;font-size:11px'>Error loading admins: ${err.message}</p>`;
  }
}

addAdminForm.addEventListener("submit", async event => {
  event.preventDefault();
  const uid = $("#admin-uid-input").value.trim();
  const email = $("#admin-email-input").value.trim();

  try {
    await setDoc(doc(db, "admins", uid), {
      uid,
      email,
      active: true,
      authorizedAt: serverTimestamp(),
      authorizedBy: currentUser.uid
    });
    $("#admin-uid-input").value = "";
    $("#admin-email-input").value = "";
    loadAdminsList();
  } catch (err) {
    alert(`Could not authorize admin: ${err.message}`);
  }
});

// Recolor Mark on Hover
const mark = $("#fj");
const colors = ["#d2ff5a", "#ff70b7", "#86d9ff", "#f3f2ee", "#c6a7ff"];
function recolor() { if (mark) mark.style.color = colors[Math.floor(Math.random() * colors.length)]; }
if (mark) {
  mark.addEventListener("pointerenter", recolor);
  mark.addEventListener("touchstart", recolor, { passive: true });
}

// Change Shared Password (Owner Only)
if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!isOwner) return;

    const p1 = newSharedPasswordInput.value;
    const p2 = confirmSharedPasswordInput.value;

    if (p1 !== p2) {
      passwordChangeStatus.textContent = "Passwords do not match.";
      passwordChangeStatus.dataset.state = "error";
      return;
    }
    if (p1.length < 6) {
      passwordChangeStatus.textContent = "Password must be at least 6 characters.";
      passwordChangeStatus.dataset.state = "error";
      return;
    }

    const submitBtn = changePasswordForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    passwordChangeStatus.textContent = "Computing PBKDF2 hash (100,000 iterations)…";
    passwordChangeStatus.dataset.state = "info";

    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const hashHex = await computePbkdf2Hash(p1, saltBytes);
      const saltHex = bufferToHex(saltBytes);

      await setDoc(doc(db, "notesConfig", "sharedPassword"), {
        saltHex,
        hashHex,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
        version: Date.now()
      });

      newSharedPasswordInput.value = "";
      confirmSharedPasswordInput.value = "";
      passwordChangeStatus.textContent = "Shared Notes password updated successfully. All other sessions have been invalidated.";
      passwordChangeStatus.dataset.state = "success";
    } catch (err) {
      passwordChangeStatus.textContent = `Update failed: ${err.message}`;
      passwordChangeStatus.dataset.state = "error";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Generate FJ Invitation (Owner Only)
if (generateInviteForm) {
  generateInviteForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!isOwner) return;

    const submitBtn = generateInviteForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      // High-entropy token ending with case-insensitive 'fj'
      const randomHex = bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
      const token = `fj_${randomHex}fj`;
      const tokenDigest = await sha256DigestHex(token.toLowerCase());

      await setDoc(doc(db, "invitations", tokenDigest), {
        tokenDigest,
        createdAt: serverTimestamp(),
        expiresAt: Date.now() + (7 * 86400 * 1000), // 7 days expiry
        consumed: false,
        createdBy: currentUser.uid
      });

      invitationTokenDisplay.value = token;
      invitationResultBox.hidden = false;
      invitationTokenDisplay.select();
    } catch (err) {
      alert(`Could not generate invitation: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Sign-out
$("#sign-out").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  await signOut(auth);
  location.replace("index.html");
});
