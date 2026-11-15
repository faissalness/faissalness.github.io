import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";

const $ = selector => document.querySelector(selector);
const status = $("#status");
const logo = $("#fj");
const palette = ["#d2ff5a", "#ff70b7", "#86d9ff", "#f2f0e9", "#c6a7ff", "#ffb37b"];
let requestInProgress = false;
let unsubscribeRequests;

function showStatus(message, state = "info") {
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}

function showDrawerStatus(message, state = "info") {
  const note = $("#drawer-status");
  note.textContent = message;
  note.dataset.state = state;
  note.hidden = false;
}

function showSiteFeedback(message, state = "error") {
  const note = $("#site-feedback");
  note.textContent = message;
  note.dataset.state = state;
  note.hidden = false;
}

function errorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "This email already has an account. Sign in, or request a password link using the same email.",
    "auth/invalid-email": "That email address does not look valid. Check it and try again.",
    "auth/invalid-credential": "Email or password is incorrect. Check your details or request a password link.",
    "auth/user-not-found": "No account was found for that email. Request access first.",
    "auth/too-many-requests": "Too many attempts were made. Wait a few minutes, then try again.",
    "auth/network-request-failed": "Connection problem. Check your internet connection and try again.",
    "permission-denied": "Firebase blocked this action. The website access rules may need updating.",
    "unavailable": "Firebase is temporarily unavailable. Try again in a moment."
  };
  return messages[error.code] || error.message || "An unexpected error occurred.";
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function changeLogoColor() {
  const previous = logo.dataset.color;
  const choices = palette.filter(color => color !== previous);
  const color = choices[Math.floor(Math.random() * choices.length)];
  logo.dataset.color = color;
  logo.style.color = color;
}

function changeMonogramColor() {
  const monogram = $(".monogram");
  if (!monogram) return;
  const previous = monogram.dataset.color;
  const choices = palette.filter(color => color !== previous);
  const color = choices[Math.floor(Math.random() * choices.length)];
  monogram.dataset.color = color;
  monogram.style.color = color;
}

logo.addEventListener("pointerenter", changeLogoColor);
logo.addEventListener("click", event => { event.preventDefault(); changeLogoColor(); });
logo.addEventListener("touchstart", changeLogoColor, { passive: true });
$(".monogram").addEventListener("pointerenter", changeMonogramColor);
$(".monogram").addEventListener("click", changeMonogramColor);
$(".monogram").addEventListener("touchstart", changeMonogramColor, { passive: true });

function humanChallenge() {
  const humanForm = $("#human-form");
  const humanGate = $("#human-gate");
  const authShell = $("#auth-shell");
  const a = Math.floor(Math.random() * 7) + 2;
  const b = Math.floor(Math.random() * 7) + 2;
  $("#human-question").textContent = `Quick check: what is ${a} + ${b}?`;
  if (sessionStorage.getItem("fj-human-check") === "passed") {
    humanGate.hidden = true;
    authShell.hidden = false;
  }
  humanForm.addEventListener("submit", event => {
    event.preventDefault();
    if (Number($("#human-answer").value) !== a + b) {
      $("#human-status").textContent = "That answer didn’t match. Try the addition again.";
      $("#human-answer").value = "";
      $("#human-answer").focus();
      return;
    }
    sessionStorage.setItem("fj-human-check", "passed");
    $("#human-status").textContent = "Verified. Opening the access screen…";
    humanGate.classList.add("gate-complete");
    window.setTimeout(() => {
      humanGate.hidden = true;
      authShell.hidden = false;
      authShell.classList.add("auth-reveal");
      $("#sign-in-email").focus();
    }, 220);
  });
}

humanChallenge();

function revealMainPage(user) {
  $("#human-gate").hidden = true;
  $("#auth-shell").hidden = true;
  $("#site-nav").hidden = false;
  $("#private-home").hidden = false;
  $("#private-home").classList.add("home-reveal");
  $("#owner-open").hidden = user.uid !== ownerUid;
  const flash = $("#screen-flash");
  flash.classList.remove("play");
  void flash.offsetWidth;
  flash.classList.add("play");
  animateMagneticTiles();
  loadRandomArticle();
}

function animateMagneticTiles() {
  const field = $("#magnetic-field");
  field.replaceChildren();
  const colors = ["#d2ff5a", "#f4f2e9", "#ff70b7", "#86d9ff"];
  for (let index = 0; index < 24; index += 1) {
    const tile = document.createElement("i");
    tile.className = "magnet-tile";
    const angle = Math.random() * Math.PI * 2;
    const radius = 190 + Math.random() * 360;
    tile.style.setProperty("--sx", `${Math.cos(angle) * radius}px`);
    tile.style.setProperty("--sy", `${Math.sin(angle) * radius}px`);
    tile.style.setProperty("--ex", `${(Math.random() - .5) * 80}px`);
    tile.style.setProperty("--ey", `${(Math.random() - .5) * 80}px`);
    tile.style.setProperty("--rot", `${Math.random() * 180 - 90}deg`);
    tile.style.setProperty("--delay", `${Math.random() * 260}ms`);
    tile.style.setProperty("--tile", colors[index % colors.length]);
    field.append(tile);
    tile.addEventListener("animationend", () => tile.remove(), { once: true });
  }
}

async function loadRandomArticle() {
  const label = $("#article-label");
  const image = $("#qr-image");
  try {
    const endpoint = "https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*";
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Wikipedia did not respond");
    const payload = await response.json();
    const page = payload.query.random[0];
    const encodedTitle = page.title.replaceAll(" ", "_");
    const redirect = new URL("random.html", location.href);
    redirect.searchParams.set("to", encodedTitle);
    const destination = redirect.href;
    const code = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=8&color=0-0-0&bgcolor=255-255-255&data=${encodeURIComponent(destination)}`;
    image.src = code;
    image.dataset.destination = destination;
    image.alt = `Scan to open the Wikipedia article ${page.title}`;
    label.textContent = `THIS VISIT / ${page.title.toUpperCase()}`;
  } catch {
    const destination = new URL("random.html?random=1", location.href).href;
    image.src = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=8&data=${encodeURIComponent(destination)}`;
    image.dataset.destination = destination;
    image.alt = "Scan to open a random Wikipedia article";
    label.textContent = "THIS VISIT / RANDOM WIKIPEDIA ARTICLE";
  }
}

function openOwnerDrawer() { $("#owner-drawer").hidden = false; }
function closeOwnerDrawer() { $("#owner-drawer").hidden = true; }
$("#owner-open").addEventListener("click", openOwnerDrawer);
$("#owner-close").addEventListener("click", closeOwnerDrawer);
$("#sign-out").addEventListener("click", async event => {
  setBusy(event.currentTarget, true, "…");
  try { await signOut(auth); location.reload(); }
  catch (error) { setBusy(event.currentTarget, false); showSiteFeedback(`Could not sign out. ${errorMessage(error)}`); }
});

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REPLACE_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("REPLACE_");
if (!configured) {
  showStatus("Firebase is not configured yet. Sign-in and access requests are unavailable.", "error");
  $("#human-gate").hidden = true;
  $("#auth-shell").hidden = false;
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  $("#request-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (requestInProgress) return;
    requestInProgress = true;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const email = $("#request-email").value.trim().toLowerCase();
    setBusy(button, true, "Submitting…");
    showStatus("Submitting your access request…", "info");
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, `${crypto.randomUUID()}Aa1!`);
      await setDoc(doc(db, "users", credential.user.uid), { email, approved: false, createdAt: serverTimestamp() });
      await setDoc(doc(db, "accessRequests", credential.user.uid), { uid: credential.user.uid, email, status: "pending", createdAt: serverTimestamp() });
      showStatus("Request submitted. I’ll review it. After approval, Firebase sends you a secure link to set your password.", "success");
      await signOut(auth);
    } catch (error) {
      showStatus(`Request not completed. ${errorMessage(error)}`, "error");
    } finally {
      requestInProgress = false;
      setBusy(button, false);
    }
  });

  $("#sign-in-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, "Opening…");
    showStatus("Checking your sign-in…", "info");
    try { await signInWithEmailAndPassword(auth, $("#sign-in-email").value.trim(), $("#sign-in-password").value); }
    catch (error) { showStatus(`Sign-in failed. ${errorMessage(error)}`, "error"); }
    finally { setBusy(button, false); }
  });

  $("#reset-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const email = $("#reset-email").value.trim();
    setBusy(button, true, "Sending…");
    showStatus("Requesting a secure password link…", "info");
    try {
      await sendPasswordResetEmail(auth, email);
      showStatus("Firebase accepted the request. Check your inbox and spam folder for the password link. For privacy, this page won’t reveal whether the email has an account.", "success");
    } catch (error) { showStatus(`Could not send the password link. ${errorMessage(error)}`, "error"); }
    finally { setBusy(button, false); }
  });

  onAuthStateChanged(auth, async user => {
    if (requestInProgress) return;
    if (!user) {
      $("#private-home").hidden = true;
      $("#site-nav").hidden = true;
      $("#owner-drawer").hidden = true;
      $("#human-gate").hidden = sessionStorage.getItem("fj-human-check") === "passed";
      $("#auth-shell").hidden = sessionStorage.getItem("fj-human-check") !== "passed";
      return;
    }
    $("#human-gate").hidden = true;
    $("#auth-shell").hidden = true;
    showStatus("Verifying your access…", "info");
    try {
      const profile = await getDoc(doc(db, "users", user.uid));
      if (!profile.exists() || profile.data().approved !== true) {
        showStatus("Your request is waiting for approval. You’ll receive a secure password link after approval.", "info");
        await signOut(auth);
        return;
      }
      revealMainPage(user);
      if (user.uid !== ownerUid) return;
      $("#owner-open").hidden = false;
      unsubscribeRequests?.();
      unsubscribeRequests = onSnapshot(query(collection(db, "accessRequests"), orderBy("createdAt", "desc")), snapshot => {
        const list = $("#requests-list");
        list.replaceChildren();
        const pending = snapshot.docs.filter(item => item.data().status === "pending");
        if (!pending.length) {
          const empty = document.createElement("p");
          empty.textContent = "No requests are waiting right now.";
          list.append(empty);
          return;
        }
        for (const item of pending) {
          const data = item.data();
          const row = document.createElement("div");
          row.className = "request-row";
          const email = document.createElement("span");
          email.textContent = data.email;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Approve & email link";
          button.addEventListener("click", async () => {
            setBusy(button, true, "Approving…");
            showDrawerStatus(`Approving ${data.email}…`, "info");
            try {
              await updateDoc(doc(db, "users", data.uid), { approved: true });
              await updateDoc(item.ref, { status: "approved", reviewedAt: serverTimestamp() });
              try {
                await sendPasswordResetEmail(auth, data.email);
                showDrawerStatus(`Approved. Firebase sent a secure password link to ${data.email}.`, "success");
              } catch (emailError) {
                showDrawerStatus(`Approved, but email delivery failed: ${errorMessage(emailError)} The person can use Password help on the sign-in screen.`, "error");
              }
            } catch (error) {
              showDrawerStatus(`Could not approve the request. ${errorMessage(error)}`, "error");
              setBusy(button, false);
            }
          });
          row.append(email, button);
          list.append(row);
        }
      }, error => showDrawerStatus(`Could not load requests. ${errorMessage(error)}`, "error"));
    } catch (error) {
      $("#auth-shell").hidden = false;
      showStatus(`Could not verify access. ${errorMessage(error)}`, "error");
      await signOut(auth);
    }
  });
}
