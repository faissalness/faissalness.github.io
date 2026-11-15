const params = new URLSearchParams(location.search);
let destination;
if (params.has("to")) {
  const title = params.get("to").replaceAll(" ", "_");
  destination = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
} else if (params.has("random") || params.has("go")) {
  destination = "https://en.wikipedia.org/wiki/Special:Random";
} else {
  destination = "https://en.wikipedia.org/wiki/Special:Random";
}
const label = document.querySelector("#redirect-status");
if (label) label.textContent = "Your random Wikipedia page is ready. Redirecting…";
window.setTimeout(() => location.replace(destination), 140);
