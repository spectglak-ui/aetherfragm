const { app, BrowserWindow, WebContentsView, session, ipcMain, protocol, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');
const filters = require('./filters');
const search = require('./search');
const vault = require('./vault');

// ---------- Réglages persistants ----------
const CONFIG_FILE = path.join(app.getPath('userData'), 'aether-settings.json');
const DEFAULTS = { forceHttps: true, blockTrackers: true, webrtcIsolation: true };
let settings;
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
catch (e) { settings = { ...DEFAULTS }; }
const saveSettings = () => { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2)); } catch (e) {} };

// ---------- Favoris persistants ----------
const BOOKMARKS_FILE = path.join(app.getPath('userData'), 'aether-bookmarks.json');
let bookmarks = [];
try { bookmarks = JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8')); }
catch (e) { bookmarks = []; }
const saveBookmarks = () => { try { fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2)); } catch (e) {} };

// ---------- Purgeur de liens (paramètres de pistage) ----------
const TRACK_PARAMS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','fbclid','gclid','gclsrc','dclid','msclkid','mc_eid','mkt_tok','ref_src','twclid','wbraid','gbraid','igshid','spp','epo','_ga','olid'];
function purgeUrl(u) {
  try {
    const url = new URL(u); let n = 0;
    for (const k of TRACK_PARAMS) if (url.searchParams.has(k)) { url.searchParams.delete(k); n++; }
    return n ? { url: url.href, n } : { url: u, n: 0 };
  } catch (e) { return { url: u, n: 0 }; }
}

// ---------- Fuites & réseau ----------
if (settings.webrtcIsolation) app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable-non-proxied-udp');
app.commandLine.appendSwitch('dns-over-https-mode', 'secure');
app.commandLine.appendSwitch('dns-over-https-templates', 'https://cloudflare-dns.com/dns-query');

const PARTITION = 'persist:aetherfragm';
const CHROME_H = 97;
const STATUSBAR_H = 30;
const SEARCH_PAGE = path.join(__dirname, 'search.html');
const DIAG_PAGE = path.join(__dirname, 'diag.html');
const READ_PAGE = path.join(__dirname, 'read.html');
let blockedTotal = 0;
let lastArticle = null;
let lastFindTerm = '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'aether', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#060609', resizable: true,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });

  const ses = session.fromPartition(PARTITION);
  ses.clearStorageData();

  // ---------- Protocole interne aether:// ----------
  protocol.handle('aether', (req) => {
    const u = new URL(req.url);
    const key = (u.hostname + u.pathname).replace(/^\/+|\/+$/g, '');
    let file = null;
    if (key === 'search' || key === '') file = SEARCH_PAGE;
    else if (key === 'diag') file = DIAG_PAGE;
    else if (key === 'read') file = READ_PAGE;
    else if (key === 'logo.png') file = path.join(__dirname, 'assets', 'logo.png');
    if (!file) return new Response('404 introuvé', { status: 404 });
    let data;
    try { data = fs.readFileSync(file); }
    catch (e) {
      return new Response('<pre style="background:#060609;color:#e0447c;padding:24px;font-family:monospace">✗ fichier manquant : ' + file + '</pre>',
        { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const type = file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
    return new Response(data, { headers: { 'content-type': type } });
  });

  ipcMain.handle('search:query', async (e, query, cat, page) => {
    const from = e.senderFrame?.url || e.sender.getURL();
    const ok = from.startsWith('aether://') || /search\.html(\?|$)/.test(from);
    if (!ok) return { error: 'source non autorisée', results: [], images: [], videos: [], instant: null };
    return search.run(query, cat, page);
  });
  ipcMain.handle('diag:report', (e) => {
    const from = e.senderFrame?.url || e.sender.getURL();
    if (!(from.startsWith('aether://') || from.includes('diag.html'))) return { error: 'non autorisé' };
    return {
      doh: true, webrtc: settings.webrtcIsolation, forceHttps: settings.forceHttps,
      shield: settings.blockTrackers, blockedTotal, vaultLocked: !vault.isUnlocked(),
      filters: filters.size(), version: app.getVersion() || '1.3'
    };
  });
  ipcMain.handle('read:get', (e) => {
    const from = e.senderFrame?.url || e.sender.getURL();
    if (!(from.startsWith('aether://') || from.includes('read.html'))) return null;
    return lastArticle;
  });

  const send = (ch, ...args) => { if (!win.isDestroyed()) win.webContents.send(ch, ...args); };
  const status = (txt, cls) => send('nav:status', txt, cls || '');

  // ---------- Surfaces de la coque : on masque la vue web quand un panneau est ouvert ----------
  let shellOverlay = false;
  ipcMain.on('ui:overlay', (e, on) => {
    shellOverlay = !!on;
    const t = activeTab();
    if (t) t.view.setVisible(!shellOverlay && !!t.url);
  });

  // ---------- Fenêtre : zone de travail + F11 ----------
  let fitted = false, savedBounds = null;
  const workArea = () => screen.getPrimaryDisplay().workArea;
  function fitWindow() { if (!fitted) { savedBounds = win.getBounds(); fitted = true; } win.setBounds(workArea()); send('win:max', true); }
  function unfitWindow() { if (savedBounds) win.setBounds(savedBounds); fitted = false; send('win:max', false); }
  ipcMain.on('win:maximize', () => { fitted ? unfitWindow() : fitWindow(); });
  screen.on('display-metrics-changed', () => { if (fitted && !win.isFullScreen()) win.setBounds(workArea()); });
  win.on('enter-full-screen', () => send('win:fs', true));
  win.on('leave-full-screen', () => send('win:fs', false));

  // ---------- Durcissement d'une session (bouclier + purgeur + téléchargements) ----------
  function hardenSession(s) {
    s.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url;
      if (details.resourceType === 'mainFrame') {
        const p = purgeUrl(url);
        if (p.n) { send('aether:purged', p.n); return callback({ redirectURL: p.url }); }
        return callback({});
      }
      if (settings.blockTrackers && filters.isTracker(url)) { blockedTotal++; send('aether:blocked', url); return callback({ cancel: true }); }
      const prive = /^http:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url);
      if (settings.forceHttps && url.startsWith('http://') && !prive) return callback({ redirectURL: url.replace(/^http:/, 'https:') });
      callback({});
    });
    s.setPermissionRequestHandler((wc, p, cb) => cb(false));
    s.on('will-download', (e, item) => {
      item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
      const tick = () => send('dl:state', { name: item.getFilename(), received: item.getReceivedBytes(), total: item.getTotalBytes(), state: 'progress' });
      item.on('updated', tick);
      item.on('done', (ev, state) => send('dl:state', { name: item.getFilename(), received: item.getReceivedBytes(), total: item.getTotalBytes(), state }));
    });
  }
  hardenSession(ses);

  // ---------- Raccourcis clavier globaux (coque + onglets) ----------
  function hookKeys(wc) {
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); return; }
      const ctrl = input.control || input.meta;
      if (ctrl && input.shift && input.key.toLowerCase() === 'x') { e.preventDefault(); doPanic(); return; }
      if (!ctrl) return;
      const k = input.key.toLowerCase();
      if (k === 'l') { e.preventDefault(); send('ui:focus-url'); }
      else if (k === 't') { e.preventDefault(); createTab(); }
      else if (k === 'w') { e.preventDefault(); closeTab(activeId); }
      else if (k === 'k') { e.preventDefault(); send('ui:palette'); }
      else if (k === 'f') { e.preventDefault(); send('ui:find'); }
      else if (k === 'tab') { e.preventDefault(); cycleTab(input.shift ? -1 : 1); }
      else if (k === '=' || k === '+') { e.preventDefault(); zoomActive(1); }
      else if (k === '-') { e.preventDefault(); zoomActive(-1); }
      else if (k === '0') { e.preventDefault(); zoomActive(0); }
    });
  }
  hookKeys(win.webContents);

  // ---------- Pages internes ----------
  function loadInternal(view, kind, query) {
    const map = { search: SEARCH_PAGE, diag: DIAG_PAGE, read: READ_PAGE };
    const file = map[kind];
    if (!file || !fs.existsSync(file)) { view.webContents.loadURL('about:blank'); send('nav:status', '✗ ' + kind + '.html manquant', 'err'); return; }
    view.webContents.loadFile(file, { query: query || {} });
  }
  function displayUrl(u) {
    try {
      if (u.includes('search.html')) {
        const uu = new URL(u);
        return 'aether://search?q=' + encodeURIComponent(uu.searchParams.get('q') || '') + '&cat=' + encodeURIComponent(uu.searchParams.get('cat') || 'web');
      }
      if (u.includes('diag.html')) return 'aether://diag';
      if (u.includes('read.html')) return 'aether://read';
    } catch (e) {}
    return u;
  }

  // ---------- Canaux (onglets) + canaux fantômes ----------
  const tabs = [];
  let activeId = null, nextId = 1;
  const activeTab = () => tabs.find(t => t.id === activeId);
  const syncTabs = () => send('tabs:update', tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === activeId, ghost: t.ephemeral })));
  const layout = () => {
    const b = win.getContentBounds();
    for (const t of tabs) {
      t.view.setBounds({ x: 0, y: CHROME_H, width: b.width, height: Math.max(0, b.height - CHROME_H - STATUSBAR_H) });
    }
  };
  win.on('resize', layout);
  function cycleTab(dir) {
    if (!tabs.length) return;
    const i = tabs.findIndex(t => t.id === activeId);
    switchTab(tabs[(i + dir + tabs.length) % tabs.length].id);
  }
  function applyZoom(t, pct) {
    t.zoomF = pct / 100;
    t.view.webContents.setZoomFactor(t.zoomF);
    send('zoom:state', pct);
  }
  function zoomActive(d) {
    const t = activeTab(); if (!t) return;
    const cur = Math.round((t.zoomF || 1) * 100);
    applyZoom(t, d === 0 ? 100 : Math.max(50, Math.min(200, cur + d * 10)));
  }
  ipcMain.on('zoom:set', (e, pct) => {
    const t = activeTab(); if (t) applyZoom(t, Math.max(50, Math.min(200, pct | 0)));
  });
  function switchTab(id) {
    const tab = tabs.find(t => t.id === id); if (!tab) return;
    activeId = id;
    for (const t of tabs) t.view.setVisible(t.id === id && !!t.url && !shellOverlay);
    layout();
    tab.view.webContents.setZoomFactor(tab.zoomF || 1);
    send('zoom:state', Math.round((tab.zoomF || 1) * 100));
    if (tab.url) { send('nav:url', tab.url); send('nav:home-hide'); status('✓ ' + (tab.title || tab.url), 'ok'); }
    else { send('nav:home-show'); status('▲ accueil'); }
    syncTabs();
  }
  function createTab(url, ephemeral) {
    const id = nextId++;
    const tses = ephemeral ? session.fromPartition('temp:aether-' + id) : ses;
    if (ephemeral) hardenSession(tses);
    const view = new WebContentsView({ webPreferences: { session: tses, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload-search.js') } });
    win.contentView.addChildView(view);
    view.setVisible(false);
    const tab = { id, view, title: ephemeral ? '👻 nouveau canal' : 'nouveau canal', url: '', ephemeral: !!ephemeral, tses, zoomF: 1 };
    tabs.push(tab);
    hookKeys(view.webContents);

    view.webContents.on('page-title-updated', (e, title) => { tab.title = title; syncTabs(); });
    view.webContents.on('did-navigate', (e, u) => { tab.url = displayUrl(u); if (id === activeId) send('nav:url', tab.url); syncTabs(); });
    view.webContents.on('did-navigate-in-page', (e, u) => { tab.url = displayUrl(u); if (id === activeId) send('nav:url', tab.url); syncTabs(); });
    view.webContents.on('did-start-loading', () => { if (id === activeId) status('⇢ chargement…'); });
    view.webContents.on('did-stop-loading',  () => { if (id === activeId) status('✓ chargé', 'ok'); });
    view.webContents.on('did-fail-load', (e, code, desc, u, isMain) => {
      if (!isMain || code === -3) return;
      tab.title = '✗ erreur'; syncTabs();
      if (id === activeId) { status('✗ ' + code + ' ' + desc, 'err'); tab.view.setVisible(false); send('nav:home-show'); }
    });
    view.webContents.setWindowOpenHandler(({ url: u }) => { createTab(u); return { action: 'deny' }; });

    if (url) {
      tab.url = url;
      if (url.startsWith('aether://search')) {
        const uu = new URL(url);
        loadInternal(view, 'search', { q: uu.searchParams.get('q') || '', cat: uu.searchParams.get('cat') || 'web' });
      } else if (url === 'aether://diag') loadInternal(view, 'diag');
      else if (url === 'aether://read') loadInternal(view, 'read');
      else view.webContents.loadURL(url).catch(err => status('✗ ' + err.message, 'err'));
    }
    switchTab(id);
    return tab;
  }
  function closeTab(id) {
    const i = tabs.findIndex(t => t.id === id); if (i === -1) return;
    const [tab] = tabs.splice(i, 1);
    try { win.contentView.removeChildView(tab.view); tab.view.webContents.close(); } catch (e) {}
    if (tab.ephemeral) { try { tab.tses.clearStorageData(); } catch (e) {} }
    if (tabs.length === 0) { createTab(); return; }
    if (activeId === id) switchTab(tabs[Math.min(i, tabs.length - 1)].id);
    else { syncTabs(); layout(); }
  }

  // ---------- Mode panique ----------
  function doPanic() {
    vault.lock();
    ses.clearStorageData(); ses.clearCache();
    for (const t of [...tabs]) { try { win.contentView.removeChildView(t.view); t.view.webContents.close(); } catch (e) {} }
    tabs.length = 0; activeId = null;
    createTab();
    send('nav:home-show'); send('ui:panic');
    vaultState();
    status('☠ mode panique : traces anéanties, coffre verrouillé', 'err');
  }
  ipcMain.on('cmd:panic', doPanic);

  // ---------- Mode lecture ----------
  const EXTRACTOR = `(() => {
    const pick = document.querySelector('article') || document.querySelector('main') || document.body;
    const paras = [...pick.querySelectorAll('p')].filter(p => (p.textContent || '').trim().length > 60);
    const text = paras.map(p => p.textContent.trim()).join('\\n\\n');
    return { title: document.title, text: text || (pick.innerText || '').slice(0, 8000) };
  })()`;
  ipcMain.on('cmd:read', async () => {
    const t = activeTab(); if (!t) return;
    try {
      const art = await t.view.webContents.executeJavaScript(EXTRACTOR);
      if (art && art.text && art.text.length > 200) { lastArticle = art; createTab('aether://read'); }
      else status('✗ texte principal introuvable sur cette page', 'err');
    } catch (e) { status('✗ extraction impossible', 'err'); }
  });

  // ---------- Souvenir CRT ----------
  ipcMain.handle('shot:take', async () => {
    const t = activeTab(); if (!t) return null;
    try { const img = await t.view.webContents.capturePage(); return img.isEmpty() ? null : img.toDataURL(); }
    catch (e) { return null; }
  });
  ipcMain.on('shot:save', (e, dataUrl) => {
    try {
      const dir = path.join(app.getPath('downloads'), 'aether-souvenirs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'souvenir-' + Date.now() + '.png'), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
      send('nav:status', '📸 souvenir CRT enregistré dans Téléchargements/aether-souvenirs', 'ok');
    } catch (err) { send('nav:status', '✗ enregistrement impossible', 'err'); }
  });

  // ---------- Recherche dans la page ----------
  ipcMain.on('find:start', (e, term) => { lastFindTerm = term; const t = activeTab(); if (t) t.view.webContents.findInPage(term); });
  ipcMain.on('find:next', () => { const t = activeTab(); if (t && lastFindTerm) t.view.webContents.findInPage(lastFindTerm, { forward: true }); });
  ipcMain.on('find:stop', () => { const t = activeTab(); if (t) t.view.webContents.stopFindInPage('clearSelection'); });

  // ---------- Traduction de page (sans clé API, via le processus principal) ----------
  ipcMain.handle('translate:one', async (e, text) => {
    const from = e.senderFrame?.url || e.sender.getURL();
    if (!/^https?:/.test(from)) return null;
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=' + encodeURIComponent(text);
    try {
      const res = await net.fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!res.ok) return null;
      const j = await res.json();
      let out = '';
      if (Array.isArray(j) && Array.isArray(j[0])) for (const seg of j[0]) if (seg && typeof seg[0] === 'string') out += seg[0];
      return out || null;
    } catch (e2) { return null; }
  });
  ipcMain.on('translate:done', (e, on) => send('nav:status', on ? '✓ page traduite en français' : '✓ version originale restaurée', 'ok'));
  ipcMain.on('cmd:translate', () => {
    const t = activeTab(); if (!t) return;
    status('⇢ traduction…');
    t.view.webContents.send('translate:run');
  });

  // ---------- Console du canal (debug) ----------
  ipcMain.on('cmd:guestdev', () => { const t = activeTab(); if (t) t.view.webContents.openDevTools({ mode: 'detach' }); });

  // ---------- COFFRE-FORT ----------
  let pendingOffer = null, lastHintSender = null;
  const vaultState = () => send('vault:state', { unlocked: vault.isUnlocked(), hasVault: vault.exists() });
  ipcMain.handle('vault:unlock', (e, master) => {
    try { const r = vault.unlock(String(master)); vaultState(); return { ok: true, ...r }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('vault:list',   () => vault.isUnlocked() ? vault.list() : []);
  ipcMain.handle('vault:add',    (e, entry) => { if (!vault.isUnlocked()) return { ok: false }; vault.add(entry); return { ok: true }; });
  ipcMain.handle('vault:update', (e, i, entry) => { if (!vault.isUnlocked()) return { ok: false }; vault.update(i, entry); return { ok: true }; });
  ipcMain.handle('vault:remove', (e, i) => { if (!vault.isUnlocked()) return { ok: false }; vault.remove(i); return { ok: true }; });
  ipcMain.on('vault:lock', () => { vault.lock(); vaultState(); });
  ipcMain.on('vault:offer', (e, data) => {
    if (!vault.isUnlocked()) return;
    try { if (!/^https?:$/.test(new URL(data.origin).protocol)) return; } catch (err) { return; }
    pendingOffer = data;
    send('vault:prompt-save', { origin: data.origin, user: data.user });
  });
  ipcMain.on('vault:save-accept', () => {
    if (pendingOffer && vault.isUnlocked()) {
      vault.add({ origin: pendingOffer.origin, user: pendingOffer.user, pass: pendingOffer.pass });
      send('nav:status', '🔐 identifiant enregistré dans le coffre', 'ok');
    }
    pendingOffer = null;
  });
  ipcMain.on('vault:save-decline', () => { pendingOffer = null; });
  ipcMain.on('vault:hint', (e, origin) => {
    if (!vault.isUnlocked()) return;
    if (vault.findForOrigin(origin).length) { lastHintSender = e.sender; send('vault:prompt-fill', { origin }); }
  });
  ipcMain.on('vault:fill', () => {
    if (!vault.isUnlocked() || !lastHintSender || lastHintSender.isDestroyed()) return;
    const found = vault.findForOrigin(new URL(lastHintSender.getURL()).origin);
    if (found.length) lastHintSender.send('vault:fill-data', found[0]);
  });

  // ---------- IPC Navigation ----------
  ipcMain.on('nav:go', (e, url) => {
    const from = e.senderFrame?.url || e.sender.getURL();
    const allowed = from.includes('index.html') || from.includes('search.html') || from.startsWith('aether://');
    if (!allowed) return;
    const tab = activeTab(); if (!tab) return;
    tab.url = url; tab.view.setVisible(true); send('nav:home-hide');
    if (url.startsWith('aether://search')) {
      const uu = new URL(url);
      status('⇢ recherche aether → ' + (uu.searchParams.get('q') || ''));
      loadInternal(tab.view, 'search', { q: uu.searchParams.get('q') || '', cat: uu.searchParams.get('cat') || 'web' });
    } else if (url === 'aether://diag') loadInternal(tab.view, 'diag');
    else if (url === 'aether://read') loadInternal(tab.view, 'read');
    else {
      status('⇢ syntonisation → ' + url);
      tab.view.webContents.loadURL(url).catch(err => status('✗ ' + err.message, 'err'));
    }
    syncTabs();
  });
  ipcMain.on('nav:back', () => { const t = activeTab(); if (t && t.view.webContents.canGoBack()) t.view.webContents.goBack(); });
  ipcMain.on('nav:reload', () => { const t = activeTab(); if (t) t.view.webContents.reload(); });
  ipcMain.on('nav:home', () => { const t = activeTab(); if (t) t.view.setVisible(false); send('nav:home-show'); status('▲ accueil'); });
  ipcMain.on('tab:new',    () => createTab());
  ipcMain.on('tab:ghost',  () => createTab(null, true));
  ipcMain.on('tab:switch', (e, id) => switchTab(id));
  ipcMain.on('tab:close',  (e, id) => closeTab(id));

  // ---------- IPC Settings / Purge / Bookmarks ----------
  ipcMain.on('set:change', (e, key, value) => {
    if (!(key in settings)) return;
    settings[key] = value; saveSettings(); send('set:state', settings);
    if (key === 'webrtcIsolation') status('▲ redémarrage requis pour appliquer WebRTC', 'ok');
  });
  ipcMain.on('cmd:purge', async () => {
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'cachestorage'] });
    await ses.clearCache();
    send('nav:status', '⚡ mémoire purgée', 'err');
  });
  ipcMain.handle('bookmarks:get', () => bookmarks);
  ipcMain.on('bookmarks:add', (e, bm) => {
    if (!bookmarks.find(b => b.url === bm.url)) { bookmarks.push({ ...bm, addedAt: Date.now() }); saveBookmarks(); }
    send('bookmarks:update', bookmarks);
  });
  ipcMain.on('bookmarks:remove', (e, url) => {
    bookmarks = bookmarks.filter(b => b.url !== url); saveBookmarks(); send('bookmarks:update', bookmarks);
  });

  ipcMain.on('ui:ready', () => {
    syncTabs(); send('set:state', settings); send('bookmarks:update', bookmarks);
    send('win:max', fitted); send('win:fs', win.isFullScreen());
    vaultState();
    const t = activeTab(); if (t && t.url) send('nav:url', t.url);
  });
  ipcMain.on('win:minimize', () => win.minimize());
  ipcMain.on('win:close',    () => win.close());

  filters.init().then(n => send('aether:stats', n));

  win.loadFile('index.html');
  createTab();
  fitWindow();
});
app.on('window-all-closed', () => app.quit());