// Copy values from Firebase Console > Project settings > Your apps.
// Set ownerUid after creating and signing into the owner's Firebase account once.
const emulatorHost = typeof location !== "undefined" && location.hostname === "127.0.0.1";
export const firebaseConfig = {
  apiKey: emulatorHost ? "fake-api-key" : "AIzaSyD17U-rz-QefHSQ85EWj09O1vMQRsbZGcE",
  authDomain: "fj-website-384fd.firebaseapp.com",
  projectId: emulatorHost ? "demo-fj-website-384fd" : "fj-website-384fd",
  appId: emulatorHost ? "1:123456789:web:fj-emulator" : "1:554097342719:web:a3dcb539717595a7a474ca"
};

export const ownerUid = "hDbzbNTC7pOuU2UFCjFksopbgaG3";

export const siteConfig = {
  siteUrl: "https://faissalness.github.io"
};
