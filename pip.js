import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { connectAuthEmulator, getAuth, onAuthStateChanged, reauthenticateWithCredential, signOut, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { addDoc, collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { decryptNotePayload, encryptNotePayload } from "./note-crypto.mjs";

const $ = selector => document.querySelector(selector);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (location.hostname === "127.0.0.1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
const API = "https://fj-api.jimyass.workers.dev";
let activeUser = null;
let selectedId = null;
let newNoteMode = null;
let unsubscribe = null;
let notes = [];
let accountDeletion = null;
let selectedPalUid = null;
let palRefreshTimer = null;
let pendingApprovalTimer = null;
let protectedNoteUnlocked = false;

function stopPendingApprovalPoll() {
  if (pendingApprovalTimer) {
    clearInterval(pendingApprovalTimer);
    pendingApprovalTimer = null;
  }
}

async function palApiForUser(user, path, options = {}) {
  const idToken = await user.getIdToken();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Service unavailable");
  return data;
}

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

async function ensureFirestoreAccountRecords(user) {
  const profileRef = doc(db, "users", user.uid);
  const requestRef = doc(db, "accessRequests", user.uid);
  const [profile, accessRequest] = await Promise.all([getDoc(profileRef), getDoc(requestRef)]);
  const writes = [];
  if (!profile.exists()) {
    writes.push(setDoc(profileRef, {
      email: user.email || "",
      approved: false,
      createdAt: serverTimestamp()
    }));
  }
  if (!accessRequest.exists()) {
    writes.push(setDoc(requestRef, {
      uid: user.uid,
      email: user.email || "",
      status: "pending",
      deliveryStatus: "pending",
      createdAt: serverTimestamp()
    }));
  }
  await Promise.all(writes);
}

function addTextNode(parent, text, className) {
  const node = document.createElement("p");
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function avatarInitials(name) {
  const initials = String(name || "PIP").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "");
  return initials.join("").toUpperCase() || "P";
}

function createProfileAvatar(uid, name, large = false) {
  const avatar = document.createElement("span");
  avatar.className = `pip-avatar${large ? " pip-avatar-large" : ""}`;
  avatar.setAttribute("role", "img");
  avatar.setAttribute("aria-label", `${name || "PIP user"} profile photo`);
  const fallback = document.createElement("span");
  fallback.className = "pip-avatar-fallback";
  fallback.textContent = avatarInitials(name);
  avatar.append(fallback);
  if (uid && activeUser) {
    const image = document.createElement("img");
    image.alt = "";
    image.hidden = true;
    image.onload = () => {
      image.hidden = false;
      URL.revokeObjectURL(image.dataset.photoUrl);
      fallback.hidden = true;
    };
    image.onerror = () => {
      URL.revokeObjectURL(image.dataset.photoUrl);
      image.remove();
    };
    avatar.append(image);
    activeUser.getIdToken().then(token => fetch(
      `${API}/api/profiles/${encodeURIComponent(uid)}/photo`,
      { headers: { Authorization: `Bearer ${token}` } }
    )).then(async response => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Profile photo unavailable");
      return response.blob();
    }).then(blob => {
      if (!blob || !image.isConnected) return;
      const photoUrl = URL.createObjectURL(blob);
      image.dataset.photoUrl = photoUrl;
      image.src = photoUrl;
    }).catch(() => image.remove());
  }
  return avatar;
}

function showOwnProfilePhoto(file = null) {
  const avatar = $("#pip-own-avatar");
  if (!avatar || !activeUser) return;
  avatar.replaceChildren(createProfileAvatar(activeUser.uid, activeUser.displayName, true));
  if (file) {
    const image = document.createElement("img");
    image.alt = "";
    const previewUrl = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(previewUrl);
    image.onerror = () => URL.revokeObjectURL(previewUrl);
    image.src = previewUrl;
    avatar.replaceChildren(image);
    $("#pip-save-profile-photo").disabled = false;
  } else {
    $("#pip-save-profile-photo").disabled = true;
  }
}

function addProfileNotification(parent, uid, name, message) {
  const row = document.createElement("div");
  row.className = "pip-profile-notification";
  row.append(createProfileAvatar(uid, name));
  addTextNode(row, message, "pip-note-row-title");
  parent.append(row);
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
    const row = document.createElement("div");
    row.type = "button";
    row.className = `pip-note-row${pal.uid === selectedPalUid ? " active" : ""}`;
    row.setAttribute("aria-label", `${pal.displayName || "Pal"}${pal.unread ? `, ${pal.unread} unread` : ""}`);
    row.append(createProfileAvatar(pal.uid, pal.displayName));
    const label = document.createElement("span");
    label.className = "pip-note-row-title";
    label.textContent = pal.displayName || "PIP Pal";
    const badge = document.createElement("span");
    badge.className = "pip-note-row-date";
    badge.textContent = pal.unread ? `${pal.unread} unread` : "Open conversation";
    unreadTotal += Number(pal.unread || 0);
    row.append(label, badge);
    row.addEventListener("click", () => openPalConversation(pal));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async event => {
      event.stopPropagation();
      if (!confirm(`Remove ${pal.displayName || "this Pal"}?`)) return;
      try {
        await palApi(`/api/pals/${encodeURIComponent(pal.uid)}`, { method: "DELETE" });
        await refreshPalExperience();
        await refreshPostFeed();
      } catch (error) { status(error.message, "error"); }
    });
    row.append(remove);
    palsList.append(row);
  }
  if (!invitations.length) addTextNode(invitesList, "No pending invitations.", "pip-empty");
  for (const invitation of invitations) {
    const row = document.createElement("div");
    row.className = "pip-invitation-row";
    const profileUid = invitation.direction === "received" ? invitation.inviterUid : invitation.recipientUid;
    row.append(createProfileAvatar(profileUid, invitation.inviterName));
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
    if (invitation.direction === "received") addProfileNotification(notyList, invitation.inviterUid, invitation.inviterName, `New Pal invitation from ${invitation.inviterName || "a PIP user"}.`);
    if (invitation.direction === "sent" && invitation.status === "accepted") addProfileNotification(notyList, invitation.recipientUid, invitation.inviterName, `${invitation.inviterName || "Your Pal"} accepted your Pal invitation.`);
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
  if (button.dataset.pipView === "feed") refreshPostFeed().catch(() => status("Could not load the social feed.", "error"));
  if (button.dataset.pipView !== "notes") refreshPalExperience().catch(() => status("Post It Pal is temporarily unavailable. Try again.", "error"));
}));

async function refreshPostFeed() {
  if (!activeUser) return;
  const result = await palApi("/api/posts");
  const feed = $("#pip-post-feed");
  feed.replaceChildren();
  const posts = result.posts || [];
  if (!posts.length) addTextNode(feed, "No social posts yet.", "pip-empty");
  for (const post of posts) {
    const article = document.createElement("article");
    article.className = "pip-noty-item";
    const author = document.createElement("div");
    author.className = "pip-profile-notification";
    author.append(createProfileAvatar(post.authorUid, post.authorName));
    addTextNode(author, post.authorName || "PIP user", "pip-note-row-title");
    article.append(author);
    addTextNode(article, post.body, "pip-message-body");
    addTextNode(article, `${post.visibility === "friends" ? "Friends" : "Private"} · ${new Date(post.createdAt).toLocaleString()}`, "pip-note-row-date");
    if (post.authorUid === activeUser.uid) {
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "text-button";
      trash.textContent = "Move to Trash";
      trash.addEventListener("click", async () => {
        try {
          await palApi(`/api/posts/${encodeURIComponent(post.id)}`, { method: "POST", body: JSON.stringify({ action: "trash" }) });
          await refreshPostFeed();
        } catch { status("Could not trash this post.", "error"); }
      });
      article.append(trash);
    }
    feed.append(article);
  }
}

$("#pip-post-submit").addEventListener("click", async () => {
  const body = $("#pip-post-body").value.trim();
  if (!body) return;
  const button = $("#pip-post-submit");
  button.disabled = true;
  try {
    await palApi("/api/posts", { method: "POST", body: JSON.stringify({ body, visibility: $("#pip-post-visibility").value }) });
    $("#pip-post-body").value = "";
    await refreshPostFeed();
  } catch (error) { status(error.message, "error"); }
  finally { button.disabled = false; }
});

$("#pip-profile-photo").addEventListener("change", event => {
  const file = event.currentTarget.files?.[0] || null;
  const statusNode = $("#pip-profile-photo-status");
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 262144) {
    event.currentTarget.value = "";
    statusNode.textContent = "Choose a PNG, JPEG, or WebP image no larger than 256 KB.";
    return;
  }
  showOwnProfilePhoto(file);
  statusNode.textContent = "Preview ready. Save to publish your photo.";
});

$("#pip-save-profile-photo").addEventListener("click", async event => {
  const file = $("#pip-profile-photo").files?.[0];
  if (!activeUser || !file) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const token = await activeUser.getIdToken();
    const response = await fetch(`${API}/api/profiles/${encodeURIComponent(activeUser.uid)}/photo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Profile photo upload failed");
    $("#pip-profile-photo").value = "";
    $("#pip-profile-photo-status").textContent = "Profile photo saved.";
    showOwnProfilePhoto();
  } catch (error) {
    button.disabled = false;
    $("#pip-profile-photo-status").textContent = error.message || "Profile photo upload failed.";
  }
});

$("#pip-remove-profile-photo").addEventListener("click", async event => {
  if (!activeUser) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const token = await activeUser.getIdToken();
    const response = await fetch(`${API}/api/profiles/${encodeURIComponent(activeUser.uid)}/photo`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok && response.status !== 404) throw new Error("Profile photo could not be removed.");
    $("#pip-profile-photo").value = "";
    $("#pip-profile-photo-status").textContent = "Profile photo removed.";
    showOwnProfilePhoto();
  } catch (error) {
    $("#pip-profile-photo-status").textContent = error.message || "Profile photo could not be removed.";
  } finally { button.disabled = false; }
});

$("#pip-profile-search").addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#pip-profile-query").value.trim();
  const results = $("#pip-profile-results");
  results.replaceChildren();
  try {
    const result = await palApi(`/api/profiles?q=${encodeURIComponent(query)}`);
    if (!(result.profiles || []).length) addTextNode(results, "No profiles found.", "pip-empty");
    for (const profile of result.profiles || []) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pip-note-row";
      row.append(createProfileAvatar(profile.uid, profile.displayName));
      addTextNode(row, profile.displayName || "PIP profile", "pip-note-row-title");
      row.addEventListener("click", async () => {
        status(`${profile.displayName || "Profile"} selected. Ask for their PIP email to send an invitation.`, "info");
      });
      results.append(row);
    }
  } catch (error) { status(error.message, "error"); }
});

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

function attachmentCollection(uid, noteId) {
  return collection(db, "yourNotes", uid, "notes", noteId, "attachments");
}

async function uploadPipAttachments(noteId) {
  if (!activeUser || !noteId) return;
  const input = $("#pip-note-attachments");
  for (const file of Array.from(input.files || [])) {
    if (file.size > 1_000_000) throw new Error(`${file.name} exceeds 1 MB`);
    if (!/^(image|text|application)\//.test(file.type)) throw new Error(`${file.name} has an unsupported file type`);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await addDoc(attachmentCollection(activeUser.uid, noteId), {
      name: file.name.slice(0, 180),
      type: file.type,
      size: file.size,
      dataUrl,
      createdAt: serverTimestamp()
    });
  }
  input.value = "";
}

async function refreshPipAttachments(noteId) {
  const list = $("#pip-note-attachment-list");
  list.replaceChildren();
  if (!activeUser || !noteId) return;
  const snapshot = await getDocs(query(attachmentCollection(activeUser.uid, noteId), orderBy("createdAt", "desc")));
  for (const attachment of snapshot.docs) {
    const data = attachment.data();
    const link = document.createElement("a");
    link.className = "text-button";
    link.href = data.dataUrl;
    link.download = data.name;
    link.textContent = data.name;
    list.append(link);
  }
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
  if (!selectedId && !newNoteMode && activeNotes.length) selectNote(activeNotes[0].id, false);
  if (selectedId && !activeNotes.some(note => note.id === selectedId)) selectNote(null, false);
}

function selectNote(id, repaint = true) {
  selectedId = id;
  const note = notes.find(item => item.id === id);
  protectedNoteUnlocked = false;
  const previouslyProtected = Boolean(note?.protection);
  noteHadProtection = previouslyProtected;
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
  refreshPipAttachments(id).catch(() => {});
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
    statusNode.textContent = "Deletion is pending, but secure full account deletion is not configured. No data has been removed. Cancel the request to restore access.";
    scheduleButton.hidden = true;
    cancelButton.hidden = !deletionTime;
    finalizePanel.hidden = true;
    notesLayout.hidden = true;
    unsubscribe?.();
    unsubscribe = null;
    notes = [];
    selectedId = null;
    renderNotes();
  } else {
    statusNode.textContent = "Your account is active. Secure full account deletion is not configured, so new deletion requests are unavailable.";
    scheduleButton.hidden = true;
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
    await palApi("/api/users/finalize-deletion", { method: "POST", body: JSON.stringify({ confirmed: true }) });
    activeUser = null;
    accountDeletion = null;
    await signOut(auth);
    showPrivateNotes(null);
    status("Your notes have been removed and the account deletion was completed.", "success");
  } catch (error) {
    const message = error.code === "auth/invalid-credential" || error.code === "auth/wrong-password"
      ? "The password did not match. Your account is unchanged."
      : error.message === "Secure full account deletion is not configured. No data was removed."
        ? error.message
        : "Deletion could not be completed. Your account and data remain unchanged; sign in again and retry.";
    status(message, "error");
  } finally { button.disabled = false; }
});

// PIP and Your Notes authenticate through the main FJ website only — there is
// no second login here. Unauthenticated users are sent back to the main site.
$("#pip-sign-out").addEventListener("click", async () => {
  try {
    await signOut(auth);
    showPrivateNotes(null);
  }
  catch { status("Could not sign out. Try again.", "error"); }
});

$("#pip-new-note").addEventListener("click", () => { selectNote(null); newNoteMode = true; });

$("#pip-note-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeUser) return;
  const button = $("#pip-save-note");
  button.disabled = true;
  const title = $("#pip-note-title").value.trim().slice(0, 160);
  const content = $("#pip-note-content").value.slice(0, 20000);
  try {
    const protectedNote = $("#pip-note-protected").checked;
    if (protectedNote && !protectedNoteUnlocked && selectedId && noteHadProtection) throw new Error("Unlock this note first");
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
      newNoteMode = null;
    }
    await uploadPipAttachments(selectedId);
    await refreshPipAttachments(selectedId);
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

async function showPrivateNotes(user) {
  if (!user) {
    activeUser = null;
    $("#pip-notes").hidden = true;
    stopPendingApprovalPoll();
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
    return;
  }
  try {
    await ensureFirestoreAccountRecords(user);
    const registration = await palApiForUser(user, "/api/users/register", { method: "POST", body: "{}" });
    // Registration records the account in D1. Ordinary users wait for owner
    // approval: their D1 account stays pending until the owner grants access.
    if (registration.status !== "active" || registration.pipStatus !== "active") {
      activeUser = null;
      $("#pip-auth").hidden = true;
      $("#pip-notes").hidden = true;
      status("Your PIP and Your Notes access is pending owner approval.", "info");
      stopPendingApprovalPoll();
      // Poll for the owner's approval instead of requiring a reload.
      pendingApprovalTimer = setInterval(() => {
        palApi("/api/users/register", { method: "POST", body: "{}" })
          .then(registrationResult => {
            if (registrationResult.status === "active") {
              stopPendingApprovalPoll();
              showPrivateNotes(user);
            }
          })
          .catch(() => {});
      }, 5000);
      return;
    }
  } catch (error) {
    activeUser = null;
    $("#pip-auth").hidden = true;
    $("#pip-notes").hidden = true;
    status(error.message || "Could not verify application access.", "error");
    return;
  }
  stopPendingApprovalPoll();
  activeUser = user;
  $("#pip-auth").hidden = Boolean(user);
  $("#pip-notes").hidden = !user;
  $("#pip-status").hidden = true;
  if (user) {
    showOwnProfilePhoto();
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

// PIP and Your Notes use the main FJ website session only — there is no
// second login. Users sign in through the main website; unauthenticated
// sessions are sent back there.
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "/";
    return;
  }
  showPrivateNotes(user);
});
