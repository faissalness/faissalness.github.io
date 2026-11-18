import assert from 'assert';
import { generateQrMatrix, renderQrDataUrl } from '../qr-client.js';
import { isSafeQrDestination } from '../qr-url.js';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

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

const scanUrl = "https://en.wikipedia.org/wiki/Great_Barrier_Reef";
const scanMatrix = generateQrMatrix(scanUrl, 4, 'M');
assert.strictEqual(scanMatrix.length, 33, "Version 4 QR must contain 33 modules per side");
const pythonDecoder = "import json,sys,tempfile,os; from PIL import Image,ImageDraw; from qr_decoder import decode_qr_image; m=json.load(sys.stdin); b=4; q=12; n=len(m); im=Image.new('RGB',((n+2*b)*q,(n+2*b)*q),'white'); d=ImageDraw.Draw(im); [[d.rectangle(((x+b)*q,(y+b)*q,(x+b+1)*q-1,(y+b+1)*q-1),fill='black') for x,on in enumerate(row) if on] for y,row in enumerate(m)]; f=tempfile.NamedTemporaryFile(suffix='.png',dir='tests',delete=False); p=f.name; f.close(); im.save(p); print(decode_qr_image(p,version=4,ec_level='M')); os.unlink(p)";
const decoded = execSync(`python -c "${pythonDecoder}"`, { input: JSON.stringify(scanMatrix) }).toString().trim();
assert.strictEqual(decoded, scanUrl, "The QR-tech version 6 matrix must decode to the exact active destination");
console.log(" PASS: Independently decoded version 4 QR matches its destination exactly.");
assert.strictEqual(isSafeQrDestination(scanUrl), true, "HTTPS Wikipedia destination must be accepted");
assert.strictEqual(isSafeQrDestination("https://www.reddit.com/r/space/"), true, "HTTPS Reddit destination must be accepted");
assert.strictEqual(isSafeQrDestination("https://evilwikipedia.org/wiki/Fake"), false, "Lookalike domains must be rejected");
assert.strictEqual(isSafeQrDestination("http://en.wikipedia.org/wiki/Earth"), false, "Non-HTTPS destinations must be rejected");
assert.strictEqual(isSafeQrDestination("javascript:alert(1)"), false, "Script URLs must be rejected");
assert.strictEqual(isSafeQrDestination("https://user:pass@en.wikipedia.org/wiki/Earth"), false, "Credential-bearing URLs must be rejected");
assert.strictEqual(isSafeQrDestination(`https://en.wikipedia.org/wiki/${'A'.repeat(60)}`), false, "Destinations that exceed QR capacity must be rejected");
console.log(" PASS: Destination validation rejects unsafe schemes, lookalikes, credentials, and overlength links.");

const qrTech = readFileSync(new URL('../qr-tech.js', import.meta.url), 'utf8');
assert.match(qrTech, /const QR_COLORS = \[.*?#d2ff5a.*?#ff70b7.*?#86d9ff/s, "QR-tech provides high-contrast FJ colors");
assert.match(qrTech, /function nextQrColor\(\)[\s\S]*?previousQrColor = choices\[Math\.floor\(Math\.random\(\) \* choices\.length\)\]/,
  "Each QR refresh picks a random color and avoids immediately repeating the last color");
assert.match(qrTech, /renderQrSvg\(generateQrMatrix\(destination\.url, 4, "M"\), nextQrColor\(\), "#020203", 4\)/,
  "The random accent is applied to the scannable QR itself with dark contrast and a four-module quiet zone");

console.log("=== QR CLIENT TEST COMPLETE ===\n");
