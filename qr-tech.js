import { generateQrMatrix, renderQrSvg } from "./qr-client.js";
import { isSafeQrDestination } from "./qr-url.js";

const $ = selector => document.querySelector(selector);
const image = $("#qr-tech-image");
const download = $("#qr-download");
const label = $("#qr-destination");
const open = $("#qr-open");
const QR_COLORS = ["#d2ff5a", "#ff70b7", "#86d9ff", "#c6a7ff", "#f2f0e9"];
let previousQrColor = "";
function nextQrColor() {
  const choices = QR_COLORS.filter(color => color !== previousQrColor);
  previousQrColor = choices[Math.floor(Math.random() * choices.length)];
  return previousQrColor;
}
async function chooseDestination() {
  try {
    const response = await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data = await response.json();
      const url = data?.content_urls?.desktop?.page;
      if (isSafeQrDestination(url)) return { url, title: data.title || url };
    }
  } catch { /* A live destination must be returned by the public summary API. */ }
  throw new Error("No live destination could be verified. Try again when connected.");
}

async function refresh() {
  const button = $("#qr-refresh");
  button.disabled = true;
  label.textContent = "Finding a destination…";
  try {
    const destination = await chooseDestination();
    const svg = renderQrSvg(generateQrMatrix(destination.url, 4, "M"), nextQrColor(), "#020203", 4)
      .replace('width="100%" height="100%"', 'width="410" height="410"');
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const previous = image.dataset.objectUrl;
    image.src = objectUrl;
    image.dataset.objectUrl = objectUrl;
    if (previous) URL.revokeObjectURL(previous);
    download.href = objectUrl;
    open.href = destination.url;
    label.textContent = destination.title;
  } catch (error) {
    label.textContent = error.message;
    image.removeAttribute("src");
    download.removeAttribute("href");
    open.removeAttribute("href");
  } finally {
    button.disabled = false;
  }
}

$("#qr-refresh").addEventListener("click", refresh);
refresh();
