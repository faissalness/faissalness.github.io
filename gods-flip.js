/**
 * 3D Flip Card — Gods 02
 * Fetches random funny images from meme-api.com (keyless, free),
 * preloads a buffer pool, and flips cards on click / flips back on mouseleave.
 * Never shows the same image twice in a row on a card.
 */

const MEME_API = 'https://meme-api.com/gimme/10';
const POOL_SIZE = 10;
const REFILL_THRESHOLD = 4;

let urlPool = [];
let lastImageByCard = new Map(); // card element -> last image URL shown

async function fetchMemePool() {
  try {
    const response = await fetch(MEME_API, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Meme API ${response.status}`);
    const data = await response.json();
    const memes = Array.isArray(data.memes) ? data.memes : [];
    const urls = memes
      .filter(m => m.url && !m.nsfw)
      .map(m => m.url);
    if (urls.length) {
      urlPool = urls;
      preloadPool(urlPool);
    }
  } catch (err) {
    console.warn('Meme pool fetch failed:', err.message);
  }
}

function preloadPool(urls) {
  for (const url of urls) {
    const img = new Image();
    img.src = url;
  }
}

function pickRandomImage(card) {
  const last = lastImageByCard.get(card);
  let candidates = urlPool.filter(u => u !== last);
  if (!candidates.length) candidates = urlPool.slice();
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  lastImageByCard.set(card, picked);
  return picked;
}

function flipToBack(card) {
  const img = card.querySelector('.card-image');
  if (!img || !urlPool.length) return;
  const url = pickRandomImage(card);
  img.src = url;
  img.alt = 'Funny image';
  card.classList.add('flipped');
}

function flipToFront(card) {
  card.classList.remove('flipped');
}

function initFlipCards() {
  const cards = document.querySelectorAll('.flip-card');
  cards.forEach(card => {
    card.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      // Don't re-flip if already flipped
      if (card.classList.contains('flipped')) return;
      flipToBack(card);
    });
    card.addEventListener('mouseleave', () => {
      flipToFront(card);
    });
  });
}

// Init: fetch pool, then wire up cards
fetchMemePool().then(initFlipCards);

// Background replenishment: refill pool when it runs low
setInterval(() => {
  if (urlPool.length <= REFILL_THRESHOLD) {
    fetchMemePool();
  }
}, 15000);
