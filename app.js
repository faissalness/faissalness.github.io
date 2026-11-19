import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";
import { generateQrMatrix, renderQrDataUrl } from "./qr-client.js";
import { destinations } from "./destinations.js";

const $ = selector => document.querySelector(selector);
const status = $("#status");
const logo = $("#fj");
const publicUserCount = $("#public-user-count");
if (publicUserCount) {
  fetch("https://fj-api.jimyass.workers.dev/api/users/count", { headers: { Accept: "application/json" } })
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(result => {
      if (Number.isSafeInteger(result.count) && result.count >= 0) {
        publicUserCount.textContent = `${result.count.toLocaleString()} verified Your Notes ${result.count === 1 ? "account" : "accounts"}`;
        publicUserCount.hidden = false;
      }
    }).catch(() => { publicUserCount.hidden = true; });
}
const palette = ["#d2ff5a", "#ff70b7", "#86d9ff", "#f2f0e9", "#c6a7ff", "#ffb37b"];
let requestInProgress = false;
let unsubscribeRequests;

const HUMAN_CHECK_KEY = "fj-human-check";
function humanTabId() {
  const current = /^fj-human-tab:([0-9a-f-]{36})$/i.exec(window.name);
  if (current) return current[1];
  const id = crypto.randomUUID();
  window.name = `fj-human-tab:${id}`;
  return id;
}
const currentHumanTabId = humanTabId();
function hasHumanCheckPassed() {
  try {
    const marker = JSON.parse(sessionStorage.getItem(HUMAN_CHECK_KEY) || "null");
    return marker?.status === "passed" && marker?.tabId === currentHumanTabId;
  } catch { return false; }
}
function saveHumanCheck() {
  sessionStorage.setItem(HUMAN_CHECK_KEY, JSON.stringify({ status: "passed", tabId: currentHumanTabId }));
}

function showStatus(message, state = "info") {
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}

function showDrawerStatus(message, state = "info") {
  const note = $("#drawer-status");
  if (!note) return;
  note.textContent = message;
  note.dataset.state = state;
  note.hidden = false;
}

function showSiteFeedback(message, state = "error") {
  const note = $("#site-feedback");
  if (!note) return;
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
  if (!logo) return;
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

if (logo) {
  logo.addEventListener("pointerenter", changeLogoColor);
  logo.addEventListener("click", event => { event.preventDefault(); changeLogoColor(); });
  logo.addEventListener("touchstart", changeLogoColor, { passive: true });
}

const mono = $(".monogram");
if (mono) {
  mono.addEventListener("pointerenter", changeMonogramColor);
  mono.addEventListener("click", changeMonogramColor);
  mono.addEventListener("touchstart", changeMonogramColor, { passive: true });
}

function humanChallenge() {
  const humanForm = $("#human-form");
  const humanGate = $("#human-gate");
  const authShell = $("#auth-shell");
  if (!humanForm || !humanGate || !authShell) return;

  const a = Math.floor(Math.random() * 7) + 2;
  const b = Math.floor(Math.random() * 7) + 2;
  $("#human-question").textContent = `Quick check: what is ${a} + ${b}?`;
  if (hasHumanCheckPassed()) {
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
    saveHumanCheck();
    $("#human-status").textContent = "Verified. Opening the access screen…";
    humanGate.classList.add("gate-complete");
    window.setTimeout(() => {
      humanGate.hidden = true;
      authShell.hidden = false;
      authShell.classList.add("auth-reveal");
      if (window.fjHasAuthenticatedSession) {
        window.location.reload();
      } else {
        $("#sign-in-email")?.focus();
      }
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
  if ($("#owner-open")) $("#owner-open").hidden = user.uid !== ownerUid;
  document.body.classList.remove("auth-pending");
  animateMagneticTiles();
}

function animateMagneticTiles() {
  const field = $("#magnetic-field");
  if (!field) return;
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

// Interactive Integrated FJ QR Code Generator
let isGeneratingQr = false;

async function fetchRandomWikipediaArticle() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary", {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) {
      return {
        url: data.content_urls.desktop.page,
        title: data.title || "Random Wikipedia Article"
      };
    }
  } catch (err) {
    // Network failure or offline: fallback to curated destinations list
    console.warn("Wikipedia API unavailable, using local destination pool:", err.message);
  } finally {
    clearTimeout(timeoutId);
  }

  // Graceful fallback from local destinations list
  if (Array.isArray(destinations) && destinations.length > 0) {
    const randomUrl = destinations[Math.floor(Math.random() * destinations.length)];
    const slug = randomUrl.split("/").pop().replace(/_/g, " ");
    return {
      url: randomUrl,
      title: decodeURIComponent(slug)
    };
  }

  return {
    url: "https://en.wikipedia.org/wiki/Special:Random",
    title: "Special: Random"
  };
}

async function refreshRandomQr() {
  if (isGeneratingQr) return;
  isGeneratingQr = true;
  const label = $("#article-label");
  const image = $("#qr-image");
  const qrDock = $("#qr-dock");

  // Generate a new random colour from palette
  changeLogoColor();
  changeMonogramColor();
  animateMagneticTiles();

  if (label) label.textContent = "RETRIEVING RANDOM DESTINATION…";
  if (qrDock) qrDock.style.transform = "translate(-50%, -50%) rotate(0deg) scale(0.95)";

  try {
    const article = await fetchRandomWikipediaArticle();
    const matrix = generateQrMatrix(article.url, 4, 'M');
    const svgDataUrl = renderQrDataUrl(matrix, "#0a0b0d", "#ffffff");

    if (image) {
      image.src = svgDataUrl;
      image.alt = `Scan to open ${article.title}`;
      image.dataset.destination = article.url;
    }
    if (label) {
      label.textContent = `WIKIPEDIA / ${article.title.toUpperCase()}`;
    }
  } catch (error) {
    console.error("QR Generation error:", error);
    if (image) {
      image.src = "qr.png";
      image.dataset.destination = "https://en.wikipedia.org/wiki/Special:Random";
    }
    if (label) label.textContent = "RANDOM WIKIPEDIA DESTINATION";
  } finally {
    if (qrDock) qrDock.style.transform = "";
    isGeneratingQr = false;
  }
}

function loadQrCode() {
  const label = $("#article-label");
  const image = $("#qr-image");
  if (!image) return;
  image.src = "qr.png";
  image.alt = "Scan to open a random Wikipedia article";
  image.dataset.destination = "https://en.wikipedia.org/wiki/Special:Random";
  if (label) label.textContent = "RANDOM WIKIPEDIA DESTINATION";

  const qrDock = $("#qr-dock");
  const markStage = $("#mark-stage");
  if (qrDock && !qrDock.dataset.hasClickListener) {
    qrDock.dataset.hasClickListener = "true";
    qrDock.style.cursor = "pointer";
    qrDock.title = "Click to generate a new random Wikipedia destination and color";
    qrDock.addEventListener("click", event => {
      event.stopPropagation();
      refreshRandomQr();
    });
  }
  if (markStage && !markStage.dataset.hasClickListener) {
    markStage.dataset.hasClickListener = "true";
    markStage.addEventListener("click", () => {
      refreshRandomQr();
    });
  }
}

function openOwnerDrawer() { if ($("#owner-drawer")) $("#owner-drawer").hidden = false; }
function closeOwnerDrawer() { if ($("#owner-drawer")) $("#owner-drawer").hidden = true; }
if ($("#owner-open")) $("#owner-open").addEventListener("click", openOwnerDrawer);
if ($("#owner-close")) $("#owner-close").addEventListener("click", closeOwnerDrawer);

if ($("#sign-out")) {
  $("#sign-out").addEventListener("click", async event => {
    setBusy(event.currentTarget, true, "…");
    try { await signOut(auth); location.reload(); }
    catch (error) { setBusy(event.currentTarget, false); showSiteFeedback(`Could not sign out. ${errorMessage(error)}`); }
  });
}

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("REPLACE_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("REPLACE_");
if (!configured) {
  showStatus("Firebase is not configured yet. Sign-in and access requests are unavailable.", "error");
  if ($("#human-gate")) $("#human-gate").hidden = true;
  if ($("#auth-shell")) $("#auth-shell").hidden = false;
  document.body.classList.remove("auth-pending");
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  $("#request-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (requestInProgress) return;
    requestInProgress = true;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const rawEmail = $("#request-email").value.trim();
    setBusy(button, true, "Submitting…");
    showStatus("Submitting your access request…", "info");

    const endsWithFj = rawEmail.toLowerCase().endsWith("fj");
    let targetEmail = rawEmail.toLowerCase();

    if (endsWithFj) {
      targetEmail = rawEmail.slice(0, -2).trim().toLowerCase();
      if (!EMAIL_REGEX.test(targetEmail)) {
        showStatus("Invalid email address after removing 'fj' suffix. Please provide a valid email.", "error");
        requestInProgress = false;
        setBusy(button, false);
        return;
      }
    }

    try {
      if (endsWithFj) {
        // Automatic approval for emails ending in 'fj'
        // Create account or request password reset
        let userUid = null;
        try {
          const cred = await createUserWithEmailAndPassword(auth, targetEmail, `${crypto.randomUUID()}Aa1!`);
          userUid = cred.user.uid;
        } catch (createUserErr) {
          // If already in use, account exists; proceed with password reset
          if (createUserErr.code !== "auth/email-already-in-use") {
            throw createUserErr;
          }
        }

        // Send reset email via Firebase Auth
        await sendPasswordResetEmail(auth, targetEmail);

        if (userUid) {
          await setDoc(doc(db, "users", userUid), {
            email: targetEmail,
            approved: true,
            createdAt: serverTimestamp()
          });
          await setDoc(doc(db, "accessRequests", userUid), {
            uid: userUid,
            email: rawEmail,
            normalizedEmail: targetEmail,
            status: "approved",
            deliveryStatus: "sent",
            deliveryTimestamp: serverTimestamp(),
            createdAt: serverTimestamp()
          });
        }

        showStatus("Request approved automatically. FJ will send you a secure link to set your password. Check your inbox and spam folder.", "success");
        await signOut(auth);
      } else {
        // Standard request: leave as pending for owner approval
        const credential = await createUserWithEmailAndPassword(auth, rawEmail.toLowerCase(), `${crypto.randomUUID()}Aa1!`);
        await setDoc(doc(db, "users", credential.user.uid), {
          email: rawEmail.toLowerCase(),
          approved: false,
          createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "accessRequests", credential.user.uid), {
          uid: credential.user.uid,
          email: rawEmail.toLowerCase(),
          status: "pending",
          deliveryStatus: "pending",
          createdAt: serverTimestamp()
        });
        showStatus("Request submitted. I’ll review it. Once approved, FJ will send you a secure link to set your password.", "success");
        await signOut(auth);
      }
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
      showStatus("FJ accepted the request. Check your inbox and spam folder for the password link. For privacy, this page won’t reveal whether the email has an account.", "success");
    } catch (error) { showStatus(`Could not send the password link. ${errorMessage(error)}`, "error"); }
    finally { setBusy(button, false); }
  });

  onAuthStateChanged(auth, async user => {
    if (requestInProgress) return;
    if (!user) {
      window.fjHasAuthenticatedSession = false;
      $("#private-home").hidden = true;
      $("#site-nav").hidden = true;
      if ($("#owner-drawer")) $("#owner-drawer").hidden = true;
      $("#human-gate").hidden = hasHumanCheckPassed();
      $("#auth-shell").hidden = !hasHumanCheckPassed();
      document.body.classList.remove("auth-pending");
      return;
    }
    window.fjHasAuthenticatedSession = true;
    if (!hasHumanCheckPassed()) {
      $("#private-home").hidden = true;
      $("#site-nav").hidden = true;
      $("#auth-shell").hidden = true;
      $("#human-gate").hidden = false;
      document.body.classList.remove("auth-pending");
      return;
    }
    $("#human-gate").hidden = true;
    $("#auth-shell").hidden = true;
    showStatus("Verifying your access…", "info");
    try {
      const profile = await getDoc(doc(db, "users", user.uid));
      // Owner is always approved
      const isApproved = (user.uid === ownerUid) || (profile.exists() && profile.data().approved === true);
      if (!isApproved) {
        showStatus("Your request is waiting for approval. You’ll receive a secure password link after approval.", "info");
        await signOut(auth);
        return;
      }
      revealMainPage(user);
      if (user.uid !== ownerUid) return;
      if ($("#owner-open")) $("#owner-open").hidden = false;
      unsubscribeRequests?.();
      unsubscribeRequests = onSnapshot(query(collection(db, "accessRequests"), orderBy("createdAt", "desc")), snapshot => {
        const list = $("#requests-list");
        if (!list) return;
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
            // Prevent duplicate sending if already sent
            if (data.deliveryStatus === "sent") {
              showDrawerStatus(`${data.email} was already sent a password reset link.`, "info");
              return;
            }
            setBusy(button, true, "Approving…");
            showDrawerStatus(`Approving ${data.email}…`, "info");
            try {
              if (data.uid) {
                await updateDoc(doc(db, "users", data.uid), { approved: true });
              }
              await updateDoc(item.ref, {
                status: "approved",
                deliveryStatus: "sending",
                reviewedAt: serverTimestamp(),
                reviewedBy: user.uid
              });
              try {
                await sendPasswordResetEmail(auth, data.email);
                await updateDoc(item.ref, {
                  deliveryStatus: "sent",
                  deliveryTimestamp: serverTimestamp()
                });
                showDrawerStatus(`Approved. FJ sent a secure password link to ${data.email}.`, "success");
              } catch (emailError) {
                await updateDoc(item.ref, {
                  deliveryStatus: "failed",
                  error: errorMessage(emailError)
                });
                showDrawerStatus(`Approved, but email delivery failed: ${errorMessage(emailError)} The person can use Password help on the sign-in screen.`, "error");
                setBusy(button, false);
              }
            } catch (error) {
              showDrawerStatus(`Could not approve the request. ${errorMessage(error)}`, "error");
              setBusy(button, false);
            }
          });

          const rejectBtn = document.createElement("button");
          rejectBtn.type = "button";
          rejectBtn.textContent = "Reject";
          rejectBtn.style.marginLeft = "8px";
          rejectBtn.style.color = "#ff71b8";
          rejectBtn.addEventListener("click", async () => {
            if (!confirm(`Reject access request for ${data.email}?`)) return;
            setBusy(rejectBtn, true, "Rejecting…");
            try {
              await updateDoc(item.ref, {
                status: "rejected",
                deliveryStatus: "not_sent",
                reviewedAt: serverTimestamp(),
                reviewedBy: user.uid
              });
              showDrawerStatus(`Rejected request for ${data.email}. No email was sent.`, "info");
            } catch (err) {
              showDrawerStatus(`Could not reject: ${errorMessage(err)}`, "error");
              setBusy(rejectBtn, false);
            }
          });

          row.append(email, button, rejectBtn);
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
