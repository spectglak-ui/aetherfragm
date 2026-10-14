// apply-correctifs.js — auto-patch idempotent AetherFragm (bouton maximiser + démarrage maximisé)
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const write = (f, c) => fs.writeFileSync(path.join(__dirname, f), c);
const log = m => console.log(m);

// ---------- main.js ----------
let m = read('main.js'); let mc = false;
if (!m.includes('win:maximize')) {
  if (/^\s*fullscreen:\s*true,\s*\n/m.test(m)) {
    m = m.replace(/^\s*fullscreen:\s*true,\s*\n/m, ''); mc = true;
    log('main.js : option fullscreen: true retirée');
  }
  const aSes = 'const ses = session.fromPartition(PARTITION);';
  if (m.includes(aSes)) {
    m = m.replace(aSes, 'win.maximize(); // démarre maximisé, comme tous les navigateurs\n\n  ' + aSes);
    mc = true; log('main.js : win.maximize() ajouté au démarrage');
  }
  const aMin = "ipcMain.on('win:minimize'";
  if (m.includes(aMin)) {
    m = m.replace(aMin,
`ipcMain.on('win:maximize', () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  win.on('maximize',   () => send('win:max', true));
  win.on('unmaximize', () => send('win:max', false));
  ` + aMin);
    mc = true; log('main.js : IPC win:maximize + événements maximize/unmaximize ajoutés');
  }
  const aReady = "const t = activeTab(); if (t && t.url) send('nav:url', t.url);";
  if (m.includes(aReady)) {
    m = m.replace(aReady, "send('win:max', win.isMaximized());\n    " + aReady);
    mc = true; log('main.js : synchronisation ui:ready ajoutée');
  }
} else log('main.js : déjà patché (win:maximize présent) — ignoré');
if (mc) write('main.js', m);

// ---------- preload.js ----------
let p = read('preload.js');
if (!p.includes('win:maximize')) {
  const a = 'onStatus:';
  if (p.includes(a)) {
    p = p.replace(a,
`maximize:   () => ipcRenderer.send('win:maximize'),
  onMaximize: cb => ipcRenderer.on('win:max', (_e, v) => cb(v)),
  ` + a);
    write('preload.js', p); log('preload.js : maximize / onMaximize ajoutés');
  } else log('⚠ preload.js : ancre "onStatus:" introuvable — vérifie le fichier manuellement');
} else log('preload.js : déjà patché — ignoré');

// ---------- index.html ----------
let h = read('index.html'); let hc = false;
if (!h.includes('wb-max')) {
  if (h.includes('wb-fs')) {
    h = h.replace(/<button class="wb fs" id="wb-fs"[^>]*><\/button>/,
      '<button class="wb max" id="wb-max" title="maximiser / restaurer"></button>');
    hc = true; log('index.html : pastille wb-fs remplacée par wb-max');
  } else {
    const a = '<button class="wb min" id="wb-min"></button>';
    if (h.includes(a)) {
      h = h.replace(a, a + '\n      <button class="wb max" id="wb-max" title="maximiser / restaurer"></button>');
      hc = true; log('index.html : pastille wb-max insérée');
    }
  }
  const jsNew = `document.getElementById('wb-max').onclick = () => window.aether.maximize();
window.aether.onMaximize?.(v => document.getElementById('wb-max').classList.toggle('on', v));
`;
  const jsOld = /document\.getElementById\('wb-fs'\)\.onclick[^\n]*\n[^\n]*onFullscreen\?[^\n]*\n?/;
  if (jsOld.test(h)) { h = h.replace(jsOld, jsNew); hc = true; log('index.html : JS wb-fs remplacé par wb-max'); }
  else {
    const a2 = "document.getElementById('wb-close').onclick = () => window.aether.close();";
    if (h.includes(a2)) { h = h.replace(a2, a2 + '\n' + jsNew); hc = true; log('index.html : JS wb-max inséré'); }
  }
} else log('index.html : déjà patché — ignoré');
if (hc) write('index.html', h);

// ---------- styles.css ----------
let c = read('styles.css');
if (!c.includes('.wb.max{')) {
  if (c.includes('.wb.fs{')) {
    c = c.replace(/\.wb\.fs\{[^}]*\}/, '.wb.max{background:var(--green)}');
    c = c.replace(/\.wb\.fs\.on\{[^}]*\}/, '.wb.max.on{box-shadow:0 0 0 2px rgba(46,230,169,.55),0 0 14px var(--green)}');
    log('styles.css : règles .wb.fs converties en .wb.max');
  } else {
    c += '\n.wb.max{background:var(--green)}\n.wb.max.on{box-shadow:0 0 0 2px rgba(46,230,169,.55),0 0 14px var(--green)}\n';
    log('styles.css : règles .wb.max ajoutées en fin de fichier');
  }
  write('styles.css', c);
} else log('styles.css : déjà patché — ignoré');

log('\n✔ Auto-patch terminé. Relance avec : npm start');