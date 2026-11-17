import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { 
  getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, 
  onSnapshot, serverTimestamp, updateDoc, deleteDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const $ = sel => document.querySelector(sel);
const gate = $("#unauthorized-gate");
const topbar = $("#topbar");
const pinModal = $("#pin-modal");
const pinForm = $("#pin-form");
const pinInput = $("#pin-input");
const pinConfirmGroup = $("#pin-confirm-group");
const pinConfirmInput = $("#pin-confirm-input");
const pinTitle = $("#pin-title");
const pinDesc = $("#pin-desc");
const pinStatus = $("#pin-status");
const pinSubmitBtn = $("#pin-submit-btn");
const pinResetBtn = $("#pin-reset-btn");
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

// State
let currentUser = null;
let isOwner = false;
let userSecurityDoc = null;
let isFirstTimeSetup = false;
let isResettingPin = false;
let pinUnlocked = false;
let failedPinAttempts = 0;
let lockoutTimer = null;
let currentNoteId = null;
let allNotes = [];
let currentAttachments = []; // Array of { id, name, size, type, dataUrl }
let unsubscribeNotes = null;

// IndexedDB Storage for Attachments
const IDB_NAME = "FJ_NOTES_DB";
const IDB_STORE = "attachments";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
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

// Web Crypto PBKDF2-SHA256
async function hashPin(pin, saltHex = null) {
  const enc = new TextEncoder();
  let salt;
  if (saltHex) {
    const match = saltHex.match(/.{1,2}/g) || [];
    salt = new Uint8Array(match.map(byte => parseInt(byte, 16)));
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
    saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return { hashHex, saltHex };
}

// Initial Authentication and Authorization Gate
onAuthStateChanged(auth, async user => {
  if (!user) {
    // Unauthenticated: Keep displaying "you cannot come in here"
    gate.hidden = false;
    topbar.hidden = true;
    pinModal.hidden = true;
    notesApp.hidden = true;
    return;
  }

  currentUser = user;
  isOwner = (user.uid === ownerUid);

  try {
    // Check if user is owner or active administrator
    let authorized = isOwner;
    if (!authorized) {
      const adminDoc = await getDoc(doc(db, "admins", user.uid));
      if (adminDoc.exists() && adminDoc.data().active === true) {
        authorized = true;
      }
    }

    if (!authorized) {
      // Unauthorized: strictly deny and sign out
      await signOut(auth);
      gate.hidden = false;
      topbar.hidden = true;
      pinModal.hidden = true;
      notesApp.hidden = true;
      return;
    }

    // Authenticated and Authorized: reveal navigation and prepare PIN
    topbar.hidden = false;
    gate.hidden = true;

    // Check user's individual security/PIN record in Firestore
    const secDocSnap = await getDoc(doc(db, "userSecurity", user.uid));
    if (!secDocSnap.exists()) {
      // First-time PIN setup
      isFirstTimeSetup = true;
      pinTitle.textContent = "Configure 6-digit PIN";
      pinDesc.textContent = "First-time setup: choose a secure 6-digit PIN for note access.";
      pinConfirmGroup.hidden = false;
      pinConfirmInput.required = true;
      pinSubmitBtn.innerHTML = "Save PIN <span>↗</span>";
      pinResetBtn.hidden = true;
    } else {
      // Returning user
      isFirstTimeSetup = false;
      userSecurityDoc = secDocSnap.data();
      pinTitle.textContent = "Enter 6-digit PIN";
      pinDesc.textContent = "Enter your personal 6-digit PIN to unlock your private notes.";
      pinConfirmGroup.hidden = true;
      pinConfirmInput.required = false;
      pinSubmitBtn.innerHTML = "Unlock <span>↗</span>";
      pinResetBtn.hidden = false;
    }

    if (!pinUnlocked) {
      pinModal.hidden = false;
      pinInput.value = "";
      pinConfirmInput.value = "";
      pinInput.focus();
    }
  } catch (error) {
    console.error("Authorization check failed:", error);
    await signOut(auth);
    gate.hidden = false;
    topbar.hidden = true;
    pinModal.hidden = true;
    notesApp.hidden = true;
  }
});

// PIN Form Submission
pinForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (lockoutTimer) return;

  const pin = pinInput.value.trim();
  if (!/^\d{6}$/.test(pin)) {
    showPinStatus("PIN must be exactly 6 numeric digits.", "error");
    return;
  }

  pinSubmitBtn.disabled = true;

  if (isFirstTimeSetup || isResettingPin) {
    const confirm = pinConfirmInput.value.trim();
    if (pin !== confirm) {
      showPinStatus("The two PIN entries do not match. Try again.", "error");
      pinSubmitBtn.disabled = false;
      return;
    }

    showPinStatus("Configuring your secure PIN…", "info");
    try {
      const { hashHex, saltHex } = await hashPin(pin);
      await setDoc(doc(db, "userSecurity", currentUser.uid), {
        uid: currentUser.uid,
        pinHash: hashHex,
        salt: saltHex,
        updatedAt: serverTimestamp()
      });

      userSecurityDoc = { pinHash: hashHex, salt: saltHex };
      isFirstTimeSetup = false;
      isResettingPin = false;
      showPinStatus("PIN configured successfully. Unlocking…", "success");
      setTimeout(unlockNotesApp, 400);
    } catch (err) {
      showPinStatus(`Could not save PIN: ${err.message}`, "error");
    } finally {
      pinSubmitBtn.disabled = false;
    }
  } else {
    // Verification
    if (!userSecurityDoc || !userSecurityDoc.salt || !userSecurityDoc.pinHash) {
      showPinStatus("Security record missing. Please re-authenticate.", "error");
      pinSubmitBtn.disabled = false;
      return;
    }

    try {
      const { hashHex } = await hashPin(pin, userSecurityDoc.salt);
      if (hashHex === userSecurityDoc.pinHash) {
        failedPinAttempts = 0;
        showPinStatus("PIN verified. Unlocking…", "success");
        setTimeout(unlockNotesApp, 300);
      } else {
        failedPinAttempts += 1;
        pinInput.value = "";
        pinInput.focus();
        if (failedPinAttempts >= 5) {
          enforceLockout(30);
        } else {
          showPinStatus(`Incorrect PIN. ${5 - failedPinAttempts} attempts remaining before temporary lockout.`, "error");
        }
      }
    } catch (err) {
      showPinStatus(`Verification error: ${err.message}`, "error");
    } finally {
      pinSubmitBtn.disabled = false;
    }
  }
});

function enforceLockout(seconds) {
  let remaining = seconds;
  pinSubmitBtn.disabled = true;
  showPinStatus(`Too many failed attempts. Locked out for ${remaining}s.`, "error");

  lockoutTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(lockoutTimer);
      lockoutTimer = null;
      failedPinAttempts = 0;
      pinSubmitBtn.disabled = false;
      showPinStatus("Lockout cleared. Please enter your PIN.", "info");
    } else {
      showPinStatus(`Too many failed attempts. Locked out for ${remaining}s.`, "error");
    }
  }, 1000);
}

function showPinStatus(msg, state = "info") {
  pinStatus.textContent = msg;
  pinStatus.dataset.state = state;
}

// Secure PIN Change / Reset (Requires re-authentication)
pinResetBtn.addEventListener("click", async () => {
  const password = prompt("Re-enter your account password to verify identity before changing PIN:");
  if (!password) return;

  try {
    const cred = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, cred);

    isResettingPin = true;
    pinTitle.textContent = "Change 6-digit PIN";
    pinDesc.textContent = "Identity confirmed. Enter your new 6-digit PIN twice:";
    pinConfirmGroup.hidden = false;
    pinConfirmInput.required = true;
    pinInput.value = "";
    pinConfirmInput.value = "";
    pinSubmitBtn.innerHTML = "Update PIN <span>↗</span>";
    pinResetBtn.hidden = true;
    showPinStatus("Enter your new 6-digit PIN.", "info");
  } catch (err) {
    alert(`Authentication failed: ${err.message}`);
  }
});

function unlockNotesApp() {
  pinUnlocked = true;
  pinModal.hidden = true;
  notesApp.hidden = false;
  notesApp.classList.add("home-reveal");

  if (isOwner) {
    manageAdminsBtn.hidden = false;
  }

  initNotesRealtime();
}

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
    $("#storage-status-text").textContent = "Read restricted by Firestore rules";
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

// Sign-out
$("#sign-out").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  await signOut(auth);
  location.replace("index.html");
});
