import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";

const status = document.querySelector("#status");
const logo = document.querySelector("#fj");
const palette = ["#ff5b6e", "#55d6be", "#69a7ff", "#ffd166", "#c792ea", "#f78c6b", "#9be564", "#ffffff"];
let requestInProgress = false;

function showStatus(message, state = "info") {
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}

function errorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "This email already has an account. Sign in, or enter the email above and choose Reset password.",
    "auth/invalid-email": "That email address does not look valid. Check it and try again.",
    "auth/invalid-credential": "Email or password is incorrect. Check your details or choose Reset password.",
    "auth/user-not-found": "No account was found for that email. Choose Request access first.",
    "auth/too-many-requests": "Too many attempts were made. Wait a few minutes, then try again.",
    "auth/network-request-failed": "Connection problem. Check your internet connection and try again.",
    "permission-denied": "Firebase blocked this action. The website access rules may need updating.",
    "unavailable": "Firebase is temporarily unavailable. Try again in a moment."
  };
  return messages[error.code] || error.message || "An unexpected error occurred.";
}

function busy(button, isBusy, busyLabel) {
  if (isBusy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

logo.addEventListener("click", event => {
  event.preventDefault();
  const options = palette.filter(color => color !== logo.dataset.color);
  const next = options[Math.floor(Math.random() * options.length)];
  logo.dataset.color = next;
  logo.style.color = next;
});

const configured = !firebaseConfig.apiKey.startsWith("REPLACE_") && !firebaseConfig.projectId.startsWith("REPLACE_");
if (!configured) {
  showStatus("Firebase is not configured yet. Access requests and sign-in are unavailable.", "error");
  for (const form of document.querySelectorAll("form")) form.addEventListener("submit", event => event.preventDefault());
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const requestForm = document.querySelector("#request-form");
  const signInForm = document.querySelector("#sign-in-form");

  requestForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (requestInProgress) return;
    requestInProgress = true;
    const button = requestForm.querySelector('button[type="submit"]');
    const email = document.querySelector("#request-email").value.trim().toLowerCase();
    busy(button, true, "Submitting…");
    showStatus("Submitting your access request…", "info");
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, `${crypto.randomUUID()}Aa1!`);
      await setDoc(doc(db, "users", credential.user.uid), { email, approved: false, createdAt: serverTimestamp() });
      await setDoc(doc(db, "accessRequests", credential.user.uid), { uid: credential.user.uid, email, status: "pending", createdAt: serverTimestamp() });
      showStatus("Your request was submitted successfully. I’ll review it. After I approve it, use Reset password to choose your password from the secure email link.", "success");
    } catch (error) {
      showStatus(errorMessage(error), "error");
    } finally {
      requestInProgress = false;
      busy(button, false);
    }
  });

  signInForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = signInForm.querySelector('button[type="submit"]');
    busy(button, true, "Signing in…");
    showStatus("Checking your sign-in…", "info");
    try {
      await signInWithEmailAndPassword(auth, document.querySelector("#sign-in-email").value.trim(), document.querySelector("#sign-in-password").value);
    } catch (error) {
      showStatus(`Sign-in failed. ${errorMessage(error)}`, "error");
    } finally {
      busy(button, false);
    }
  });

  document.querySelector("#reset-password").addEventListener("click", async event => {
    const button = event.currentTarget;
    const email = document.querySelector("#sign-in-email").value.trim();
    if (!email) {
      showStatus("Enter your email in the Email box above, then click Reset password again.", "error");
      document.querySelector("#sign-in-email").focus();
      return;
    }
    busy(button, true, "Sending…");
    showStatus("Requesting a secure password setup email…", "info");
    try {
      await sendPasswordResetEmail(auth, email);
      showStatus("Firebase accepted the request. Check your inbox and spam folder for a password reset email, then follow its link to choose a password. For privacy, the page does not reveal whether this email has an account.", "success");
    } catch (error) {
      showStatus(`Could not send the password email. ${errorMessage(error)}`, "error");
    } finally {
      busy(button, false);
    }
  });

  document.querySelector("#sign-out").addEventListener("click", async event => {
    const button = event.currentTarget;
    busy(button, true, "Signing out…");
    try {
      await signOut(auth);
      showStatus("You have signed out.", "success");
    } catch (error) {
      showStatus(`Could not sign out. ${errorMessage(error)}`, "error");
      busy(button, false);
    }
  });

  onAuthStateChanged(auth, async user => {
    requestForm.hidden = Boolean(user);
    signInForm.hidden = Boolean(user);
    document.querySelector("#signed-in").hidden = !user;
    if (!user) {
      document.querySelector("#owner-panel").hidden = true;
      return;
    }
    document.querySelector("#signed-in-label").textContent = `Signed in as ${user.email}`;
    try {
      const profile = await getDoc(doc(db, "users", user.uid));
      if (!profile.exists() || profile.data().approved !== true) {
        if (!requestInProgress) showStatus("Your access request is waiting for approval. Once approved, choose Reset password on the sign-in form to get a secure password setup email.", "info");
        return;
      }
      showStatus("You are signed in and your access is approved.", "success");
      if (user.uid !== ownerUid || ownerUid.startsWith("REPLACE_")) return;
      const panel = document.querySelector("#owner-panel");
      panel.hidden = false;
      onSnapshot(query(collection(db, "accessRequests"), orderBy("createdAt", "desc")), snapshot => {
        const list = document.querySelector("#requests-list");
        list.replaceChildren();
        const pending = snapshot.docs.filter(item => item.data().status === "pending");
        if (!pending.length) {
          const empty = document.createElement("p");
          empty.textContent = "No access requests are waiting for review.";
          list.append(empty);
        }
        for (const item of pending) {
          const data = item.data();
          const row = document.createElement("div");
          row.className = "request-row";
          const email = document.createElement("span");
          email.textContent = data.email;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Approve & email setup link";
          button.addEventListener("click", async () => {
            busy(button, true, "Approving…");
            showStatus(`Approving ${data.email}…`, "info");
            try {
              await updateDoc(doc(db, "users", data.uid), { approved: true });
              await updateDoc(item.ref, { status: "approved", reviewedAt: serverTimestamp() });
              try {
                await sendPasswordResetEmail(auth, data.email);
                showStatus(`Approved ${data.email}. Firebase sent a secure password setup link to that address.`, "success");
              } catch (emailError) {
                showStatus(`Approved ${data.email}, but Firebase could not send the setup email: ${errorMessage(emailError)} Ask them to enter their email on the sign-in form and click Reset password.`, "error");
              }
            } catch (error) {
              showStatus(`Could not approve ${data.email}. ${errorMessage(error)}`, "error");
              busy(button, false);
            }
          });
          row.append(email, button);
          list.append(row);
        }
      }, error => showStatus(`Could not load access requests. ${errorMessage(error)}`, "error"));
    } catch (error) {
      showStatus(`Could not check your approval status. ${errorMessage(error)}`, "error");
    }
  });
}
