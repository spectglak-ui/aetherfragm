// search.js — méta-moteur AetherFragm (web, images, vidéos, actualités + pagination)
const { net } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function get(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await net.fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': UA,
        'accept': accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function getJson(url) { return JSON.parse(await get(url, 'application/json')); }

function clean(s) {
  return (s || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&middot;/g, '·').replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ').trim();
}

function fixHref(h) {
  if (!h) return null;
  h = String(h).replace(/&amp;/g, '&');
  if (h.startsWith('http')) return h;
  if (h.includes('uddg=')) { const m = h.match(/[?&]uddg=([^&]+)/); if (m) return decodeURIComponent(m[1]); }
  if (h.includes('aHR0c')) { const m = h.match(/(aHR0c[A-Za-z0-9+\/=]+)/); if (m) { try { return Buffer.from(m[1], 'base64').toString('utf8'); } catch (e) {} } }
  return null;
}
function fmtDur(s) {
  s = Number(s); if (!isFinite(s) || s <= 0) return '';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

// ---------- MOTEURS WEB (chaîne de repli, chacun avec son offset de page) ----------
async function startpage(q, cat, page) {
  const catParam = cat && cat !== 'web' ? '&cat=' + cat : '';
  const pageParam = '&page=' + Math.max(0, (page || 1) - 1);
  const html = await get('https://www.startpage.com/sp/search?query=' + encodeURIComponent(q) + catParam + pageParam);
  const links = [...html.matchAll(/<a[^>]+class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snaps = [...html.matchAll(/<p[^>]+class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)];
  const out = [];
  links.forEach((m, i) => {
    const url = fixHref(m[1]); if (!url) return;
    out.push({ title: clean(m[2]), url, snippet: snaps[i] ? clean(snaps[i][1]) : '' });
  });
  if (!out.length) throw new Error('parse vide');
  return { engine: 'startpage' + (catParam ? ' (' + cat + ')' : ''), results: out.slice(0, 12) };
}

async function ddgLite(q, page) {
  const html = await get('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q) + '&s=' + ((page - 1) * 10));
  const links = [...html.matchAll(/<a[^>]+rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snaps = [...html.matchAll(/<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)];
  const out = [];
  links.forEach((m, i) => {
    const url = fixHref(m[1]); if (!url || url.includes('duckduckgo.com')) return;
    out.push({ title: clean(m[2]), url, snippet: snaps[i] ? clean(snaps[i][1]) : '' });
  });
  if (!out.length) throw new Error('parse vide');
  return { engine: 'ddg-lite', results: out.slice(0, 12) };
}

async function ddgHtml(q, page) {
  const html = await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&s=' + ((page - 1) * 10));
  const links = [...html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snaps = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
  const out = [];
  links.forEach((m, i) => {
    const url = fixHref(m[1]); if (!url) return;
    out.push({ title: clean(m[2]), url, snippet: snaps[i] ? clean(snaps[i][1]) : '' });
  });
  if (!out.length) throw new Error('parse vide');
  return { engine: 'ddg-html', results: out.slice(0, 12) };
}

async function mojeek(q, page) {
  const html = await get('https://www.mojeek.com/search?q=' + encodeURIComponent(q) + '&start=' + ((page - 1) * 10 + 1));
  const links = [...html.matchAll(/<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi)];
  const snaps = [...html.matchAll(/<p class="s"[^>]*>([\s\S]*?)<\/p>/gi)];
  const out = [];
  links.forEach((m, i) => {
    const url = fixHref(m[1]); if (!url) return;
    out.push({ title: clean(m[2]), url, snippet: snaps[i] ? clean(snaps[i][1]) : '' });
  });
  if (!out.length) throw new Error('parse vide');
  return { engine: 'mojeek', results: out.slice(0, 12) };
}

async function bing(q, page) {
  const html = await get('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=fr&first=' + ((page - 1) * 10 + 1));
  const blocks = [...html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)];
  const out = [];
  for (const b of blocks) {
    const a = b[0].match(/<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
    const p = b[0].match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const url = a ? fixHref(a[1]) : null;
    if (url) out.push({ title: clean(a[2]), url, snippet: p ? clean(p[1]) : '' });
  }
  if (!out.length) throw new Error('parse vide');
  return { engine: 'bing (dernier recours)', results: out.slice(0, 12) };
}

async function newsRss(q, page) {
  const xml = await get('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=fr&gl=FR&ceid=FR:fr&start=' + ((page - 1) * 10));
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map(m => {
    const title = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const link  = m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const date  = m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    const src   = m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '';
    return { title: clean(title), url: fixHref(clean(link)), snippet: (src ? clean(src) + ' — ' : '') + clean(date) };
  }).filter(i => i.url && i.title);
  if (!items.length) throw new Error('flux vide');
  return { engine: 'google-news-rss', results: items };
}

// ---------- IMAGES (Wikimedia Commons, offset gsroffset) ----------
async function images(q, page) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + q)
    + '&gsrnamespace=6&gsrlimit=18&gsroffset=' + ((page - 1) * 18)
    + '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=360&origin=*';
  const j = await getJson(url);
  const pages = j?.query?.pages; if (!pages) throw new Error('commons vide');
  const out = Object.values(pages).map(p => {
    const ii = p.imageinfo?.[0] || {};
    return { thumb: ii.thumburl || ii.url, url: ii.descriptionurl || ii.url, title: (p.title || '').replace(/^File:/, '') };
  }).filter(i => i.thumb && i.url);
  if (!out.length) throw new Error('commons vide');
  return { engine: 'wikimedia commons', images: out };
}

// ---------- VIDÉOS (PeerTube, offset start) ----------
async function videosFrom(origin, q, page) {
  const j = await getJson(origin + '/api/v1/search/videos?search=' + encodeURIComponent(q)
    + '&count=12&start=' + ((page - 1) * 12 + 1));
  const data = j?.data; if (!data || !data.length) throw new Error('vide');
  const out = data.map(v => {
    let videoOrigin = origin;
    try { videoOrigin = new URL(v.url).origin; } catch (e) {}
    let thumb = v.thumbnailUrl || v.thumbnailPath || v.previewUrl || v.previewPath || '';
    if (thumb.startsWith('/')) thumb = videoOrigin + thumb;
    return { title: clean(v.name), url: v.url, thumb, channel: clean(v.channel?.displayName || ''), duration: fmtDur(v.duration) };
  }).filter(v => v.url);
  if (!out.length) throw new Error('vide');
  return { engine: origin.replace('https://', '') + ' · peertube', videos: out };
}

// ---------- WIKIPÉDIA ----------
async function wiki(q) {
  try {
    const res = await net.fetch('https://fr.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q), { headers: { 'user-agent': UA } });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j.extract) return null;
    return { title: j.title, extract: j.extract, img: j.thumbnail?.source || null, url: j.content_urls?.desktop?.page || null };
  } catch (e) { return null; }
}

// ---------- AIGUILLAGE ----------
async function run(q, cat, page) {
  q = String(q || ''); cat = cat || 'web'; page = Math.max(1, parseInt(page, 10) || 1);
  const empty = { error: null, engine: 'aucun', results: [], images: [], videos: [], instant: null, errors: [], page, hasNext: false };
  if (!q) return { ...empty, error: 'requête vide' };
  const errors = [];
  try {
    if (cat === 'images') {
      const r = await images(q, page);
      return { ...empty, ...r, hasNext: r.images.length >= 18 };
    }
    if (cat === 'videos') {
      const chain = [['sepiasearch', () => videosFrom('https://sepiasearch.org', q, page)], ['framatube', () => videosFrom('https://framatube.org', q, page)]];
      for (const [name, fn] of chain) {
        try { const r = await fn(); if (r.videos.length) return { ...empty, ...r, hasNext: r.videos.length >= 12, errors }; }
        catch (e) { errors.push(name + ' : ' + e.message); }
      }
      return { ...empty, error: 'tous les moteurs vidéos sont muets', errors };
    }
    if (cat === 'news') {
      const chain = [['startpage-news', () => startpage(q, 'news', page)], ['google-news-rss', () => newsRss(q, page)]];
      for (const [name, fn] of chain) {
        try { const r = await fn(); if (r.results.length) return { ...empty, ...r, hasNext: r.results.length >= 10, errors }; }
        catch (e) { errors.push(name + ' : ' + e.message); }
      }
      return { ...empty, error: 'tous les moteurs news sont muets', errors };
    }
    const chain = [
      ['startpage', () => startpage(q, 'web', page)],
      ['ddg-lite',  () => ddgLite(q, page)],
      ['ddg-html',  () => ddgHtml(q, page)],
      ['mojeek',    () => mojeek(q, page)],
      ['bing',      () => bing(q, page)]
    ];
    for (const [name, fn] of chain) {
      try {
        const r = await fn();
        if (r.results.length) return { ...empty, ...r, instant: page === 1 ? await wiki(q) : null, hasNext: r.results.length >= 10, errors };
        errors.push(name + ' : parse vide');
      } catch (e) { errors.push(name + ' : ' + e.message); }
    }
    return { ...empty, error: 'tous les moteurs sont muets', errors };
  } catch (e) {
    return { ...empty, error: e.message, errors };
  }
}

module.exports = { run };