import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { createUserWithEmailAndPassword, deleteUser, EmailAuthProvider, getAuth, onAuthStateChanged, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { decryptNotePayload, encryptNotePayload } from "./note-crypto.mjs";

const $ = selector => document.querySelector(selector);
const app = initializeApp(firebaseConfig, "FJYourNotes");
const auth = getAuth(app);
const db = getFirestore(app);
const API = "https://fj-api.jimyass.workers.dev";
let activeUser = null;
let selectedId = null;
let unsubscribe = null;
let notes = [];
let emailVerificationUser = null;
let accountDeletion = null;
let selectedPalUid = null;
let palRefreshTimer = null;
let protectedNoteUnlocked = false;

async function palApi(path, options = {}) {
  if (!activeUser) throw new Error("Sign in required");
  const idToken = await activeUser.getIdToken();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Service unavailable");
  return data;
}

function addTextNode(parent, text, className) {
  const node = document.createElement("p");
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

async function refreshPalExperience() {
  if (!activeUser) return;
  const [palResult, inviteResult] = await Promise.all([
    palApi("/api/pals"), palApi("/api/pals/invitations")
  ]);
  const palsList = $("#pip-pal-list");
  const invitesList = $("#pip-pal-invitations");
  const notyList = $("#pip-noty-list");
  palsList.replaceChildren();
  invitesList.replaceChildren();
  notyList.replaceChildren();
  const pals = palResult.pals || [];
  const invitations = inviteResult.invitations || [];
  let unreadTotal = 0;
  if (!pals.length) addTextNode(palsList, "No Pals yet.", "pip-empty");
  for (const pal of pals) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `pip-note-row${pal.uid === selectedPalUid ? " active" : ""}`;
    row.setAttribute("aria-label", `${pal.displayName || "Pal"}${pal.unread ? `, ${pal.unread} unread` : ""}`);
    const label = document.createElement("span");
    label.className = "pip-note-row-title";
    label.textContent = pal.displayName || "PIP Pal";
    const badge = document.createElement("span");
    badge.className = "pip-note-row-date";
    badge.textContent = pal.unread ? `${pal.unread} unread` : "Open conversation";
    unreadTotal += Number(pal.unread || 0);
    row.append(label, badge);
    row.addEventListener("click", () => openPalConversation(pal));
    palsList.append(row);
  }
  if (!invitations.length) addTextNode(invitesList, "No pending invitations.", "pip-empty");
  for (const invitation of invitations) {
    const row = document.createElement("div");
    row.className = "pip-invitation-row";
    addTextNode(row, invitation.status === "accepted"
      ? `${invitation.inviterName || "Your Pal"} accepted your invitation`
      : invitation.direction === "received" ? `Pal invite from ${invitation.inviterName || "a PIP user"}` : "Pal invitation sent", "pip-note-row-title");
    if (invitation.direction === "received") {
      for (const action of ["accept", "decline"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-button";
        button.textContent = action === "accept" ? "+Pal" : "Ignore";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await palApi(`/api/pals/invitations/${encodeURIComponent(invitation.id)}/respond`, {
              method: "POST", body: JSON.stringify({ action })
            });
            await refreshPalExperience();
          } catch { status("Could not update this invitation. Try again.", "error"); button.disabled = false; }
        });
        row.append(button);
      }
    }
    invitesList.append(row);
    if (invitation.direction === "received") addTextNode(notyList, `New Pal invitation from ${invitation.inviterName || "a PIP user"}.`, "pip-noty-item");
    if (invitation.direction === "sent" && invitation.status === "accepted") addTextNode(notyList, `${invitation.inviterName || "Your Pal"} accepted your Pal invitation.`, "pip-noty-item");
  }
  if (unreadTotal) addTextNode(notyList, `${unreadTotal} unread Post It ${unreadTotal === 1 ? "note" : "notes"}.`, "pip-noty-item");
  if (!notyList.childElementCount) addTextNode(notyList, "You are all caught up.", "pip-empty");
  const notyCount = $("#pip-noty-count");
  const notificationCount = unreadTotal + invitations.filter(item => item.direction === "received" || item.status === "accepted").length;
  notyCount.textContent = String(notificationCount);
  notyCount.hidden = notificationCount === 0;
  if (selectedPalUid && !pals.some(item => item.uid === selectedPalUid)) {
    selectedPalUid = null;
    $("#pip-pal-title").textContent = "Choose a Pal";
    $("#pip-pal-messages").replaceChildren();
    $("#pip-pal-message-form").hidden = true;
  }
}

async function openPalConversation(pal) {
  selectedPalUid = pal.uid;
  $("#pip-pal-title").textContent = pal.displayName || "PIP conversation";
  $("#pip-pal-message-form").hidden = false;
  try {
    const result = await palApi(`/api/pals/${encodeURIComponent(pal.uid)}/messages`);
    const container = $("#pip-pal-messages");
    container.replaceChildren();
    if (!(result.messages || []).length) addTextNode(container, "Start the conversation with a Post It.", "pip-empty");
    for (const message of result.messages || []) {
      const article = document.createElement("article");
      article.className = `pip-message${message.senderUid === activeUser.uid ? " own" : ""}`;
      addTextNode(article, message.body, "pip-message-body");
      addTextNode(article, new Date(message.createdAt).toLocaleString(), "pip-note-row-date");
      container.append(article);
    }
    container.scrollTop = container.scrollHeight;
    await refreshPalExperience();
  } catch { status("Could not load this conversation.", "error"); }
}

document.querySelectorAll("[data-pip-view]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-pip-view]").forEach(item => item.classList.toggle("active", item === button));
  document.querySelectorAll(".pip-view").forEach(view => { view.hidden = view.id !== `pip-view-${button.dataset.pipView}`; });
  if (button.dataset.pipView !== "notes") refreshPalExperience().catch(() => status("Post It Pal is temporarily unavailable. Try again.", "error"));
}));

$("#pip-pal-invite-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const email = $("#pip-pal-email").value.trim();
    const result = await palApi("/api/pals/invite", { method: "POST", body: JSON.stringify({ email }) });
    status(result.message, "success");
    event.currentTarget.reset();
    await refreshPalExperience();
  } catch (error) { status(error.message, "error"); }
  finally { button.disabled = false; }
});

$("#pip-pal-message-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedPalUid) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await palApi(`/api/pals/${encodeURIComponent(selectedPalUid)}/messages`, {
      method: "POST", body: JSON.stringify({ body: $("#pip-pal-message").value })
    });
    $("#pip-pal-message").value = "";
    await openPalConversation({ uid: selectedPalUid, displayName: $("#pip-pal-title").textContent });
  } catch (error) { status(error.message, "error"); }
  finally { button.disabled = false; }
});

function status(message, kind = "info") {
  const box = $("#pip-status");
  box.textContent = message;
  box.dataset.state = kind;
  box.hidden = false;
}

function noteCollection(uid) {
  return collection(db, "yourNotes", uid, "notes");
}

function renderNotes() {
  const list = $("#pip-note-list");
  list.replaceChildren();
  const activeNotes = notes.filter(note => note.deletionStatus !== "trashed");
  const trashedNotes = notes.filter(note => note.deletionStatus === "trashed");
  if (!activeNotes.length) {
    const empty = document.createElement("p");
    empty.className = "pip-empty";
    empty.textContent = "No notes yet. Create your first one.";
    list.append(empty);
  }
  for (const note of activeNotes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pip-note-row${note.id === selectedId ? " active" : ""}`;
    const title = document.createElement("span");
    title.className = "pip-note-row-title";
    title.textContent = note.protection ? "Protected note" : (note.title || "Untitled note");
    const date = document.createElement("span");
    date.className = "pip-note-row-date";
    const updated = note.updatedAt?.toDate?.();
    date.textContent = updated ? updated.toLocaleDateString() : "Just now";
    button.append(title, date);
    button.addEventListener("click", () => selectNote(note.id));
    list.append(button);
  }
  const trashList = $("#pip-trash-list");
  trashList.replaceChildren();
  if (!trashedNotes.length) addTextNode(trashList, "Trash is empty.", "pip-empty");
  for (const note of trashedNotes) {
    const row = document.createElement("div");
    row.className = "pip-invitation-row";
    addTextNode(row, note.protection ? "Protected note" : (note.title || "Untitled note"), "pip-note-row-title");
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "text-button";
    restore.textContent = "Restore";
    restore.addEventListener("click", async () => {
      restore.disabled = true;
      try {
        await updateDoc(doc(db, "yourNotes", activeUser.uid, "notes", note.id), {
          deletionStatus: "active",
          deletedAt: null,
          updatedAt: serverTimestamp()
        });
      } catch { status("Could not restore this note.", "error"); restore.disabled = false; }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Delete forever";
    remove.addEventListener("click", async () => {
      if (!confirm("Permanently delete this trashed note? This cannot be undone.")) return;
      remove.disabled = true;
      try { await deleteDoc(doc(db, "yourNotes", activeUser.uid, "notes", note.id)); }
      catch { status("Could not permanently delete this note.", "error"); remove.disabled = false; }
    });
    row.append(restore, remove);
    trashList.append(row);
  }
  if (!selectedId && activeNotes.length) selectNote(activeNotes[0].id, false);
  if (selectedId && !activeNotes.some(note => note.id === selectedId)) selectNote(null, false);
}

function selectNote(id, repaint = true) {
  selectedId = id;
  const note = notes.find(item => item.id === id);
  protectedNoteUnlocked = false;
  const protectedNote = Boolean(note?.protection);
  $("#pip-note-protected").checked = protectedNote;
  $("#pip-note-protected").disabled = protectedNote;
  $("#pip-note-password").hidden = !protectedNote;
  $("#pip-note-password").required = protectedNote;
  $("#pip-note-password").value = "";
  $("#pip-note-unlock").hidden = !protectedNote;
  $("#pip-note-lock-status").hidden = !protectedNote;
  $("#pip-note-lock-status").textContent = protectedNote ? "This note is encrypted. Enter its password and unlock it to view or edit." : "";
  $("#pip-note-title").value = protectedNote ? "" : (note?.title || "");
  $("#pip-note-content").value = protectedNote ? "" : (note?.content || "");
  $("#pip-note-title").disabled = protectedNote;
  $("#pip-note-content").disabled = protectedNote;
  $("#pip-save-note").disabled = protectedNote;
  $("#pip-delete-note").hidden = !note;
  if (repaint) renderNotes();
}

$("#pip-note-protected").addEventListener("change", event => {
  const enabled = event.currentTarget.checked;
  $("#pip-note-password").hidden = !enabled;
  $("#pip-note-password").required = enabled;
  $("#pip-note-lock-status").hidden = !enabled;
  $("#pip-note-lock-status").textContent = enabled ? "The title and body are encrypted before they reach Firestore." : "";
  if (!enabled) $("#pip-note-password").value = "";
});

$("#pip-note-unlock").addEventListener("click", async () => {
  const note = notes.find(item => item.id === selectedId);
  if (!note?.protection) return;
  const button = $("#pip-note-unlock");
  button.disabled = true;
  try {
    const unlocked = await decryptNotePayload(note.protection, $("#pip-note-password").value);
    protectedNoteUnlocked = true;
    $("#pip-note-protected").disabled = false;
    $("#pip-note-password").required = true;
    $("#pip-note-title").disabled = false;
    $("#pip-note-content").disabled = false;
    $("#pip-save-note").disabled = false;
    $("#pip-note-title").value = unlocked.title;
    $("#pip-note-content").value = unlocked.content;
    $("#pip-note-unlock").hidden = true;
    $("#pip-note-lock-status").textContent = "Unlocked in this page session. The password is not saved.";
    $("#pip-note-title").focus();
  } catch {
    $("#pip-note-password").value = "";
    $("#pip-note-password").focus();
    status("That note password did not unlock the note.", "error");
  } finally { button.disabled = false; }
});

function watchNotes(user) {
  unsubscribe?.();
  notes = [];
  selectedId = null;
  unsubscribe = onSnapshot(query(noteCollection(user.uid), orderBy("updatedAt", "desc")), snapshot => {
    notes = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    if (selectedId && !notes.some(item => item.id === selectedId)) selectedId = null;
    renderNotes();
  }, error => status(error.code === "permission-denied" ? "Your account cannot access this notes collection." : "Could not load notes. Check your connection and retry.", "error"));
}

async function syncAccountLifecycle(user) {
  const accountRef = doc(db, "yourNotes", user.uid);
  const snapshot = await getDoc(accountRef);
  accountDeletion = snapshot.exists() ? snapshot.data() : null;
  const scheduled = ["scheduled", "ready"].includes(accountDeletion?.deletionStatus);
  const deletionTime = accountDeletion?.deletionAt?.toDate?.() || null;
  let due = accountDeletion?.deletionStatus === "ready" || Boolean(deletionTime && deletionTime.getTime() <= Date.now());
  if (accountDeletion?.deletionStatus === "scheduled" && due) {
    await updateDoc(accountRef, { deletionStatus: "ready", deletionReadyAt: serverTimestamp() });
    accountDeletion = { ...accountDeletion, deletionStatus: "ready" };
  }
  const statusNode = $("#pip-deletion-status");
  const scheduleButton = $("#pip-schedule-deletion");
  const cancelButton = $("#pip-cancel-deletion");
  const finalizePanel = $("#pip-finalize-deletion");
  const notesLayout = $("#pip-notes-layout");

  if (scheduled) {
    statusNode.textContent = `Deletion requested. Your notes are locked until ${deletionTime?.toLocaleString() || "the end of the 30-day grace period"}. Sign in after that date and confirm to permanently delete your account and notes.`;
    scheduleButton.hidden = true;
    cancelButton.hidden = !deletionTime || due;
    finalizePanel.hidden = !due;
    notesLayout.hidden = true;
    unsubscribe?.();
    unsubscribe = null;
    notes = [];
    selectedId = null;
    renderNotes();
  } else {
    statusNode.textContent = "Your account is active. You can request deletion with a 30-day grace period.";
    scheduleButton.hidden = false;
    cancelButton.hidden = true;
    finalizePanel.hidden = true;
    notesLayout.hidden = false;
    if (!unsubscribe) watchNotes(user);
  }
}

$("#pip-schedule-deletion").addEventListener("click", async () => {
  if (!activeUser || !confirm("Schedule account deletion? Your notes will be locked now. You can cancel for 30 days, then sign in again and confirm permanent deletion.")) return;
  const button = $("#pip-schedule-deletion");
  let apiScheduled = false;
  button.disabled = true;
  try {
    const apiSchedule = await palApi("/api/users/deletion", { method: "POST", body: JSON.stringify({ action: "schedule" }) });
    apiScheduled = true;
    const now = Date.now();
    await setDoc(doc(db, "yourNotes", activeUser.uid), {
      deletionStatus: "scheduled",
      deletionRequestedAt: serverTimestamp(),
      deletionAt: Timestamp.fromMillis(apiSchedule.deletionAt || now + 30 * 24 * 60 * 60 * 1000)
    });
    await syncAccountLifecycle(activeUser);
  } catch {
    if (apiScheduled) await palApi("/api/users/deletion", { method: "POST", body: JSON.stringify({ action: "cancel" }) }).catch(() => {});
    status("Could not schedule deletion across account services. Check your connection and retry.", "error");
  }
  finally { button.disabled = false; }
});

$("#pip-cancel-deletion").addEventListener("click", async () => {
  if (!activeUser || !confirm("Cancel account deletion and unlock your notes?")) return;
  const button = $("#pip-cancel-deletion");
  button.disabled = true;
  try {
    await palApi("/api/users/deletion", { method: "POST", body: JSON.stringify({ action: "cancel" }) });
    await updateDoc(doc(db, "yourNotes", activeUser.uid), {
      deletionStatus: "active",
      deletionCancelledAt: serverTimestamp()
    });
    await syncAccountLifecycle(activeUser);
  } catch { status("Could not cancel deletion. Try again before the grace period ends.", "error"); }
  finally { button.disabled = false; }
});

async function erasePersonalNotes(uid) {
  const notesQuery = () => query(noteCollection(uid), orderBy(documentId()), limit(200));
  while (true) {
    const page = await getDocs(notesQuery());
    if (page.empty) return;
    const batch = writeBatch(db);
    page.docs.forEach(note => batch.delete(note.ref));
    await batch.commit();
  }
}

$("#pip-finalize-deletion-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeUser?.email || accountDeletion?.deletionStatus !== "ready") return;
  const deadline = accountDeletion.deletionAt?.toDate?.();
  if (!deadline || deadline.getTime() > Date.now()) return status("The 30-day grace period has not ended yet.", "error");
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const credential = EmailAuthProvider.credential(activeUser.email, $("#pip-delete-password").value);
    await reauthenticateWithCredential(activeUser, credential);
    await activeUser.getIdToken(true);
    await erasePersonalNotes(activeUser.uid);
    await deleteDoc(doc(db, "yourNotes", activeUser.uid));
    await palApi("/api/users/finalize-deletion", { method: "POST", body: JSON.stringify({ confirmed: true }) });
    await deleteUser(activeUser);
    activeUser = null;
    accountDeletion = null;
    await signOut(auth);
    showPrivateNotes(null);
    status("Your notes have been removed and the account deletion was completed.", "success");
  } catch (error) {
    const message = error.code === "auth/invalid-credential" || error.code === "auth/wrong-password"
      ? "The password did not match. Your account is unchanged."
      : "Deletion could not be completed. Your account remains available; sign in again and retry.";
    status(message, "error");
  } finally { button.disabled = false; }
});

$("#pip-register-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const name = $("#pip-register-name").value.trim();
    const email = $("#pip-register-email").value.trim().toLowerCase();
    const credential = await createUserWithEmailAndPassword(auth, email, $("#pip-register-password").value);
    await updateProfile(credential.user, { displayName: name });
    $("#pip-welcome").textContent = name ? `${name}'s Notes.` : "Your Notes.";
    await sendEmailVerification(credential.user);
    status("Check your inbox for the verification link to activate Your Notes.", "success");
  } catch (error) {
    if (error.code === "auth/email-already-in-use") status("Account already exists.", "error");
    else if (error.code === "auth/weak-password") status("Use a password with at least 8 characters.", "error");
    else status("Could not create the account. Check the details and try again.", "error");
  } finally { button.disabled = false; }
});

$("#pip-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try { await signInWithEmailAndPassword(auth, $("#pip-login-email").value.trim(), $("#pip-login-password").value); }
  catch { status("Sign-in failed. Check your email and password.", "error"); }
  finally { button.disabled = false; }
});

$("#pip-reset").addEventListener("click", async () => {
  const email = $("#pip-login-email").value.trim();
  if (!email) return status("Enter your email address first.", "info");
  try { await sendPasswordResetEmail(auth, email); }
  catch { /* Keep the response indistinguishable to reduce account enumeration. */ }
  status("If an account matches that address, a password reset link will arrive by email.", "success");
});

$("#pip-sign-out").addEventListener("click", async () => {
  try { await signOut(auth); }
  catch { status("Could not sign out. Try again.", "error"); }
});

$("#pip-verify-sign-out").addEventListener("click", async () => { await signOut(auth); });
$("#pip-resend-verification").addEventListener("click", async () => {
  try { await sendEmailVerification(emailVerificationUser); status("A fresh verification link has been sent.", "success"); }
  catch { status("Could not send a new verification link yet. Wait a moment and try again.", "error"); }
});
$("#pip-check-verified").addEventListener("click", async () => {
  try {
    await emailVerificationUser.reload();
    emailVerificationUser = auth.currentUser;
    if (!emailVerificationUser?.emailVerified) return status("The email is not verified yet. Open the link, then retry.", "info");
    await emailVerificationUser.getIdToken(true);
    showPrivateNotes(emailVerificationUser);
  } catch { status("Could not check verification status. Try again.", "error"); }
});

$("#pip-new-note").addEventListener("click", () => selectNote(null));

$("#pip-note-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeUser) return;
  const button = $("#pip-save-note");
  button.disabled = true;
  const title = $("#pip-note-title").value.trim().slice(0, 160);
  const content = $("#pip-note-content").value.slice(0, 20000);
  try {
    const protectedNote = $("#pip-note-protected").checked;
    if (protectedNote && !protectedNoteUnlocked && selectedId) throw new Error("Unlock this note first");
    const password = $("#pip-note-password").value;
    if (protectedNote && password.length < 8) throw new Error("Use a note password with at least 8 characters");
    const protection = protectedNote ? await encryptNotePayload({ title, content }, password) : null;
    const record = protectedNote
      ? { title: "Protected note", content: "", protection, updatedAt: serverTimestamp() }
      : { title, content, protection: null, updatedAt: serverTimestamp() };
    if (selectedId) await updateDoc(doc(db, "yourNotes", activeUser.uid, "notes", selectedId), record);
    else {
      const created = await addDoc(noteCollection(activeUser.uid), { ...record, createdAt: serverTimestamp() });
      selectedId = created.id;
    }
    if (protectedNote) protectedNoteUnlocked = true;
    $("#pip-save-status").textContent = "Saved";
    $("#pip-save-status").classList.add("visible");
    setTimeout(() => $("#pip-save-status").classList.remove("visible"), 1500);
  } catch { status("Could not save this note. Check your connection and retry.", "error"); }
  finally { button.disabled = false; }
});

$("#pip-delete-note").addEventListener("click", async () => {
  if (!activeUser || !selectedId || !confirm("Move this note to Trash for 30 days?")) return;
  try {
    await updateDoc(doc(db, "yourNotes", activeUser.uid, "notes", selectedId), {
      deletionStatus: "trashed",
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    selectNote(null);
  } catch { status("Could not move this note to Trash.", "error"); }
});

function showPrivateNotes(user) {
  emailVerificationUser = null;
  activeUser = user;
  $("#pip-verify").hidden = true;
  $("#pip-auth").hidden = Boolean(user);
  $("#pip-notes").hidden = !user;
  $("#pip-status").hidden = true;
  if (user) {
    $("#pip-welcome").textContent = user.displayName ? `${user.displayName}'s Notes.` : "Your Notes.";
    syncAccountLifecycle(user).catch(() => status("Could not load account status. Notes remain protected until it can be checked.", "error"));
    palApi("/api/users/register", { method: "POST", body: "{}" })
      .then(refreshPalExperience)
      .catch(() => status("Your private notes are available; the public account count and Post It Pal could not sync.", "error"));
    clearInterval(palRefreshTimer);
    palRefreshTimer = setInterval(() => refreshPalExperience().catch(() => {}), 30000);
  } else {
    clearInterval(palRefreshTimer);
    palRefreshTimer = null;
    unsubscribe?.();
    unsubscribe = null;
    notes = [];
    selectedId = null;
    protectedNoteUnlocked = false;
    $("#pip-note-password").value = "";
    $("#pip-note-content").value = "";
    $("#pip-note-title").value = "";
  }
}

onAuthStateChanged(auth, user => {
  if (user && !user.emailVerified) {
    activeUser = null;
    emailVerificationUser = user;
    unsubscribe?.();
    unsubscribe = null;
    $("#pip-auth").hidden = true;
    $("#pip-notes").hidden = true;
    $("#pip-verify").hidden = false;
    return;
  }
  $("#pip-verify").hidden = true;
  showPrivateNotes(user);
});
