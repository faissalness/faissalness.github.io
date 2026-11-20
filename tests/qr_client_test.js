import assert from 'assert';
import { generateQrMatrix, renderQrDataUrl, renderQrSvg } from '../qr-client.js';
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

const scanUrl = "https://en.wikipedia.org/wiki/Alain_Tourret";
const scanMatrix = generateQrMatrix(scanUrl, 4, 'M');
assert.strictEqual(scanMatrix.length, 33, "Version 4 QR must contain 33 modules per side");
const pythonDecoder = "import json,sys,tempfile,os; from PIL import Image,ImageDraw; from qr_decoder import decode_qr_image; m=json.load(sys.stdin); b=4; q=12; n=len(m); im=Image.new('RGB',((n+2*b)*q,(n+2*b)*q),'white'); d=ImageDraw.Draw(im); [[d.rectangle(((x+b)*q,(y+b)*q,(x+b+1)*q-1,(y+b+1)*q-1),fill='black') for x,on in enumerate(row) if on] for y,row in enumerate(m)]; f=tempfile.NamedTemporaryFile(suffix='.png',dir='tests',delete=False); p=f.name; f.close(); im.save(p); print(decode_qr_image(p,version=4,ec_level='M')); os.unlink(p)";
const decoded = execSync(`python -c "${pythonDecoder}"`, { input: JSON.stringify(scanMatrix) }).toString().trim();
assert.strictEqual(decoded, scanUrl, "The QR-tech matrix must decode to the exact intended destination");
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
assert.match(qrTech, /const destination = "https:\/\/en\.wikipedia\.org\/wiki\/Alain_Tourret"/);
assert.doesNotMatch(qrTech, /fetch\(|Special:Random|random\/summary/, "The QR must render its fixed destination without network dependency");
assert.match(qrTech, /generateQrMatrix\(destination, 6, "M"\)/, "QR-tech uses a higher-capacity standard QR with medium error correction");
assert.match(qrTech, /renderQrSvg\(matrix, "#000000", "#ffffff", 4\)/, "QR-tech uses conventional dark modules, a light background, and a four-module quiet zone");
const rendered = renderQrSvg(generateQrMatrix(scanUrl, 6, 'M'), '#000000', '#ffffff', 4);
assert.match(rendered, /shape-rendering="crispEdges"/);
assert.match(rendered, /fill="#ffffff"/);
assert.ok((rendered.match(/fill="#000000"/g) || []).length > 500, "Finder and data modules must render dark");
const qrPage = readFileSync(new URL('../qr.html', import.meta.url), 'utf8');
assert.match(qrPage, /alt="QR code linking to https:\/\/en\.wikipedia\.org\/wiki\/Alain_Tourret"[^>]+width="600" height="600"/);
const renderAndDecode = "import json,sys,xml.etree.ElementTree as ET,tempfile,os; from PIL import Image,ImageDraw; from qr_decoder import decode_qr_image; x=json.load(sys.stdin); root=ET.fromstring(x['svg']); w,h=map(float,root.attrib['viewBox'].split()[2:]); image=Image.new('RGB',(int(w),int(h)),(255,255,255)); draw=ImageDraw.Draw(image); ns={'s':'http://www.w3.org/2000/svg'}; [draw.rectangle((float(r.attrib['x']),float(r.attrib['y']),float(r.attrib['x'])+float(r.attrib['width'])-1,float(r.attrib['y'])+float(r.attrib['height'])-1),fill=r.attrib['fill']) for r in root.findall('s:rect',ns) if 'x' in r.attrib]; image=image.resize((x['size'],x['size']),Image.Resampling.NEAREST); f=tempfile.NamedTemporaryFile(suffix='.png',delete=False); f.close(); image.save(f.name); print(json.dumps(decode_qr_image(f.name,version=6,ec_level='M'))); os.unlink(f.name)";
const scans = [420, 330, 220].map(size => JSON.parse(execSync(`python -c "${renderAndDecode}"`, {
  input: JSON.stringify({ svg: rendered, size })
}).toString()));
assert.deepStrictEqual(scans, [scanUrl, scanUrl, scanUrl], "Independent image decoding must match the exact payload at desktop and mobile display sizes");

console.log("=== QR CLIENT TEST COMPLETE ===\n");
