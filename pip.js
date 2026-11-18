import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { createUserWithEmailAndPassword, deleteUser, EmailAuthProvider, getAuth, onAuthStateChanged, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = selector => document.querySelector(selector);
const app = initializeApp(firebaseConfig, "FJYourNotes");
const auth = getAuth(app);
const db = getFirestore(app);
let activeUser = null;
let selectedId = null;
let unsubscribe = null;
let notes = [];
let emailVerificationUser = null;
let accountDeletion = null;

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
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "pip-empty";
    empty.textContent = "No notes yet. Create your first one.";
    list.append(empty);
  }
  for (const note of notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pip-note-row${note.id === selectedId ? " active" : ""}`;
    const title = document.createElement("span");
    title.className = "pip-note-row-title";
    title.textContent = note.title || "Untitled note";
    const date = document.createElement("span");
    date.className = "pip-note-row-date";
    const updated = note.updatedAt?.toDate?.();
    date.textContent = updated ? updated.toLocaleDateString() : "Just now";
    button.append(title, date);
    button.addEventListener("click", () => selectNote(note.id));
    list.append(button);
  }
  if (!selectedId && notes.length) selectNote(notes[0].id, false);
  if (selectedId && !notes.some(note => note.id === selectedId)) selectNote(null, false);
}

function selectNote(id, repaint = true) {
  selectedId = id;
  const note = notes.find(item => item.id === id);
  $("#pip-note-title").value = note?.title || "";
  $("#pip-note-content").value = note?.content || "";
  $("#pip-delete-note").hidden = !note;
  if (repaint) renderNotes();
}

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
  button.disabled = true;
  try {
    const now = Date.now();
    await setDoc(doc(db, "yourNotes", activeUser.uid), {
      deletionStatus: "scheduled",
      deletionRequestedAt: serverTimestamp(),
      deletionAt: Timestamp.fromMillis(now + 30 * 24 * 60 * 60 * 1000)
    });
    await syncAccountLifecycle(activeUser);
  } catch { status("Could not schedule deletion. Your account and notes are unchanged.", "error"); }
  finally { button.disabled = false; }
});

$("#pip-cancel-deletion").addEventListener("click", async () => {
  if (!activeUser || !confirm("Cancel account deletion and unlock your notes?")) return;
  const button = $("#pip-cancel-deletion");
  button.disabled = true;
  try {
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
    await erasePersonalNotes(activeUser.uid);
    await deleteDoc(doc(db, "yourNotes", activeUser.uid));
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
    if (selectedId) await updateDoc(doc(db, "yourNotes", activeUser.uid, "notes", selectedId), { title, content, updatedAt: serverTimestamp() });
    else {
      const created = await addDoc(noteCollection(activeUser.uid), { title, content, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      selectedId = created.id;
    }
    $("#pip-save-status").textContent = "Saved";
    $("#pip-save-status").classList.add("visible");
    setTimeout(() => $("#pip-save-status").classList.remove("visible"), 1500);
  } catch { status("Could not save this note. Check your connection and retry.", "error"); }
  finally { button.disabled = false; }
});

$("#pip-delete-note").addEventListener("click", async () => {
  if (!activeUser || !selectedId || !confirm("Delete this note? This cannot be undone.")) return;
  try { await deleteDoc(doc(db, "yourNotes", activeUser.uid, "notes", selectedId)); selectNote(null); }
  catch { status("Could not delete this note.", "error"); }
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
  } else {
    unsubscribe?.();
    unsubscribe = null;
    notes = [];
    selectedId = null;
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
