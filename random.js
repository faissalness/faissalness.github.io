const destinations = ["https://www.reddit.com/", "https://www.wikipedia.org/"];
const params = new URLSearchParams(location.search);
if (params.has("go")) location.replace(destinations[Math.random() < 0.5 ? 0 : 1]);
else { const target = new URL("random.html?go=1", location.href).href; document.querySelector("#qr").src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(target)}`; }
