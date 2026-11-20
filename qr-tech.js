import { generateQrMatrix, renderQrSvg } from "./qr-client.js";
import { isSafeQrDestination } from "./qr-url.js";

const $ = selector => document.querySelector(selector);
const image = $("#qr-tech-image");
function render() {
  const destination = "https://en.wikipedia.org/wiki/Alain_Tourret";
  if (!isSafeQrDestination(destination)) throw new Error("QR destination is not allowed");
  const matrix = generateQrMatrix(destination, 6, "M");
  const svg = renderQrSvg(matrix, "#000000", "#ffffff", 4)
    .replace('width="100%" height="100%"', 'width="600" height="600"');
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  image.hidden = false;
}

render();
