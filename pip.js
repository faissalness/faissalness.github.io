import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getFirestore, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
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
    watchNotes(user);
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
