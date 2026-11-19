import { generateQrMatrix, renderQrSvg } from "./qr-client.js";
import { isSafeQrDestination } from "./qr-url.js";

const $ = selector => document.querySelector(selector);
const image = $("#qr-tech-image");
async function chooseDestination() {
  const fallback = "https://en.wikipedia.org/wiki/Special:Random";
  try {
    const response = await fetch("https://en.wikipedia.org/api/rest_v1/page/random/summary", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data = await response.json();
      const url = data?.content_urls?.desktop?.page;
      const pageId = Number(data?.pageid);
      if (isSafeQrDestination(url)) {
        const compactUrl = new TextEncoder().encode(url).length <= 106
          ? url
          : Number.isSafeInteger(pageId) && pageId > 0
            ? `https://en.wikipedia.org/?curid=${pageId}`
            : fallback;
        if (isSafeQrDestination(compactUrl)) return compactUrl;
      }
    }
  } catch { /* Keep a valid random-article destination when the summary API is unavailable. */ }
  return fallback;
}

async function render() {
  const destination = await chooseDestination();
  const matrix = generateQrMatrix(destination, 6, "M");
  const svg = renderQrSvg(matrix, "#ffffff", "#020203", 4)
    .replace('width="100%" height="100%"', 'width="420" height="420"');
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  image.hidden = false;
}

render().catch(() => image.removeAttribute("src"));
