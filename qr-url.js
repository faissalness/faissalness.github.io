const ALLOWED_ROOTS = ["wikipedia.org", "wikimedia.org", "reddit.com"];
const MAX_QR_BYTES = 64;

export function isSafeQrDestination(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      new TextEncoder().encode(url.href).length <= MAX_QR_BYTES &&
      ALLOWED_ROOTS.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`));
  } catch {
    return false;
  }
}
