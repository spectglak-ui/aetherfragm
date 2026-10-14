const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aetherSearch', {
  query: (q, cat, page) => ipcRenderer.invoke('search:query', q, cat, page),
  go:    url => ipcRenderer.send('nav:go', url),
  diagReport: () => ipcRenderer.invoke('diag:report'),
  readGet:    () => ipcRenderer.invoke('read:get')
});

// ---------- Coffre-fort : capture & remplissage (monde isolé) ----------
(function () {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  const userField = root => root.querySelector(
    'input[type=email], input[autocomplete=username], input[name*=user i], input[name*=email i], input[name*=login i], input[type=text], input[type=tel]');
  document.addEventListener('submit', e => {
    const f = e.target;
    if (!f || !f.querySelector) return;
    const pw = f.querySelector('input[type=password]');
    if (!pw || !pw.value) return;
    const us = userField(f);
    ipcRenderer.send('vault:offer', { origin: location.origin, user: us ? us.value : '', pass: pw.value });
  }, true);
  let hinted = false;
  const probe = () => {
    if (hinted) return;
    if (document.querySelector('input[type=password]')) { hinted = true; ipcRenderer.send('vault:hint', location.origin); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', probe, { once: true });
  else probe();
  ipcRenderer.on('vault:fill-data', (_e, entry) => {
    const setNative = (el, val) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    let done = false;
    for (const f of document.querySelectorAll('form')) {
      const pw = f.querySelector('input[type=password]');
      if (!pw) continue;
      const us = userField(f);
      if (us) setNative(us, entry.user);
      setNative(pw, entry.pass);
      done = true;
    }
    if (!done) {
      const pw = document.querySelector('input[type=password]');
      if (pw) { const us = userField(document); if (us) setNative(us, entry.user); setNative(pw, entry.pass); }
    }
  });
})();

// ---------- Traduction : remplace les textes, second clic = version originale ----------
(function () {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  let tradState = false;
  let tradLog = [];
  ipcRenderer.on('translate:run', async () => {
    if (tradState) {
      for (const rec of tradLog) { try { rec.node.textContent = rec.orig; } catch (e) {} }
      tradLog = []; tradState = false;
      ipcRenderer.send('translate:done', false);
      return;
    }
    const skip = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|BUTTON|SVG|CODE|PRE)$/;
    const nodes = [];
    const walk = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(nd) {
        const t = (nd.textContent || '').trim();
        if (t.length < 3) return NodeFilter.FILTER_REJECT;
        const p = nd.parentElement;
        if (!p || skip.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let cur; while ((cur = walk.nextNode()) && nodes.length < 150) nodes.push(cur);
    if (!nodes.length) { ipcRenderer.send('translate:done', false); return; }
    tradLog = nodes.map(nd => ({ node: nd, orig: nd.textContent }));
    let idx = 0;
    async function worker() {
      while (idx < nodes.length) {
        const node = nodes[idx++];
        const src = (node.textContent || '').trim();
        if (!src) continue;
        try {
          const out = await ipcRenderer.invoke('translate:one', src);
          if (out && out !== src) node.textContent = out;
        } catch (e) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, nodes.length) }, worker));
    tradState = true;
    ipcRenderer.send('translate:done', true);
  });
})();