import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ownerUid } from "./firebase-config.js";

const mark = document.querySelector("#fj");
const colors = ["#d2ff5a", "#ff70b7", "#86d9ff", "#f3f2ee", "#c6a7ff"];
function recolor() { if (mark) mark.style.color = colors[Math.floor(Math.random() * colors.length)]; }
if (mark) {
  mark.addEventListener("pointerenter", recolor);
  mark.addEventListener("touchstart", recolor, { passive: true });
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const signoutBtn = document.querySelector("#sign-out");
if (signoutBtn) {
  signoutBtn.addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try { await signOut(auth); } catch (_) { /* ignore */ }
    location.replace("/");
  });
}
const db = getFirestore(app);
onAuthStateChanged(auth, async user => {
  if (!user) { location.replace("index.html"); return; }
  try {
    const profile = await getDoc(doc(db, "users", user.uid));
    const isApproved = (user.uid === ownerUid) || (profile.exists() && profile.data().approved === true);
    if (!isApproved) { await signOut(auth); location.replace("index.html"); return; }
    const siteNav = document.querySelector("#site-nav");
    if (siteNav) siteNav.hidden = false;
    const content = document.querySelector("#protected-content");
    if (content) {
      content.hidden = false;
      content.classList.add("home-reveal");
    }
  } catch {
    await signOut(auth);
    location.replace("index.html");
  }
});

for (const button of document.querySelectorAll(".filter-button")) {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    for (const other of document.querySelectorAll(".filter-button")) other.setAttribute("aria-pressed", String(other === button));
    for (const card of document.querySelectorAll(".inspiration-card")) {
      card.hidden = filter !== "all" && !card.dataset.category.split(" ").includes(filter);
    }
  });
}
