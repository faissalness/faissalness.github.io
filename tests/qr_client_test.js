import assert from 'assert';
import { generateQrMatrix, renderQrDataUrl } from '../qr-client.js';
import { execSync } from 'child_process';

console.log("=== TESTING QR CLIENT GENERATOR ===");

const url = "https://en.wikipedia.org/wiki/Special:Random";
const jsMatrix = generateQrMatrix(url, 4, 'M');

assert.strictEqual(jsMatrix.length, 33, "Version 4 must be 33x33 modules");
assert.strictEqual(jsMatrix[0].length, 33);

// Get Python matrix from qr_engine.py
const pyOutput = execSync(`python -c "import qr_engine, json; qr = qr_engine.QRCode(version=4, ec_level='M'); m = qr.encode('${url}'); print(json.dumps(m))"`).toString();
const pyMatrix = JSON.parse(pyOutput);

assert.strictEqual(jsMatrix.length, pyMatrix.length);
let differences = 0;
for (let r = 0; r < 33; r++) {
  for (let c = 0; c < 33; c++) {
    if (jsMatrix[r][c] !== pyMatrix[r][c]) {
      differences++;
    }
  }
}

assert.strictEqual(differences, 0, `JS and Python matrices must match exactly. Found ${differences} differences.`);
console.log(" PASS: JavaScript client-side QR generator exactly matches Python ISO/IEC engine!");

const dataUrl = renderQrDataUrl(jsMatrix);
assert.ok(dataUrl.startsWith("data:image/svg+xml"), "Data URL must be SVG");
console.log(" PASS: SVG data URL successfully rendered.");

console.log("=== QR CLIENT TEST COMPLETE ===\n");
