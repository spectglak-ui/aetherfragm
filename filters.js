// filters.js — moteur de filtrage AetherFragm avec whitelist
const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE_DIR  = path.join(__dirname, 'assets');
const CACHE_FILE = path.join(CACHE_DIR, 'easyprivacy.txt');
const SOURCE     = 'https://easylist.to/easylist/easyprivacy.txt';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const blocked    = new Set();
const exceptions = new Set();
const whitelist  = new Set([
  // Google / YouTube
  'youtube.com', 'www.youtube.com', 'google.com', 'accounts.google.com',
  'apis.google.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'googlevideo.com', 'googleusercontent.com',
  
  // Facebook / Meta
  'facebook.com', 'www.facebook.com', 'fbcdn.net', 'static.xx.fbcdn.net',
  'fbsbx.com', 'fb.com',
  
  // Amazon (essentiel pour le e-commerce)
  'amazon.com', 'www.amazon.com', 'amazon.fr', 'www.amazon.fr',
  'amazon-adsystem.com', 'assoc-amazon.com', 'assoc-amazon.fr',
  'images-amazon.com', 'ssl-images-amazon.com', 'media-amazon.com',
  'amazonpay.com', 'payments-amazon.com',
  
  // CDNs et services courants nécessaires
  'cloudflare.com', 'cdnjs.cloudflare.com',
  'jquery.com', 'code.jquery.com',
  'bootstrapcdn.com',
  'unpkg.com', 'jsdelivr.net',
  
  // Services de paiement courants
  'stripe.com', 'js.stripe.com',
  'paypal.com', 'www.paypal.com'
]);

const FALLBACK = [/doubleclick\.net/, /google-analytics\.com/, /googletagmanager\.com/,
                  /facebook\.net/, /hotjar\.com/, /criteo\./, /taboola\.com/];

function parse(text) {
  blocked.clear(); exceptions.clear();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.startsWith('@@')) {
      const m = line.match(/^@@\|\|([a-z0-9][a-z0-9.-]*)/i);
      if (m) exceptions.add(m[1].toLowerCase());
      continue;
    }
    if (line.startsWith('||')) {
      const m = line.match(/^\|\|([a-z0-9][a-z0-9.-]*)/i);
      if (m) blocked.add(m[1].toLowerCase());
      continue;
    }
    const hm = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9][a-z0-9.-]*)/i);
    if (hm && hm[1] !== 'localhost') blocked.add(hm[1].toLowerCase());
  }
  return blocked.size;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function init() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
  let text = null;
  try {
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < MAX_AGE_MS) text = fs.readFileSync(CACHE_FILE, 'utf8');
  } catch (e) {}
  if (!text) {
    try {
      text = await download(SOURCE);
      fs.writeFileSync(CACHE_FILE, text);
    } catch (e) {
      try { text = fs.readFileSync(CACHE_FILE, 'utf8'); }
      catch (e2) { return 0; }
    }
  }
  return parse(text);
}

function suffixHit(set, hostname) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

function isTracker(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { return false; }
  if (!host) return false;
  
  // Whitelist : ces domaines ne sont JAMAIS bloqués
  if (suffixHit(whitelist, host)) return false;
  
  if (suffixHit(exceptions, host)) return false;
  if (blocked.size) return suffixHit(blocked, host);
  return FALLBACK.some(re => re.test(url));
}

module.exports = { init, isTracker, size: () => blocked.size };