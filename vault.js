// vault.js — coffre-fort chiffré AES-256-GCM, clé dérivée scrypt de la clé maîtresse
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const VAULT_FILE = path.join(app.getPath('userData'), 'aether-vault.json');
let key = null, salt = null, entries = [];

const exists = () => fs.existsSync(VAULT_FILE);
const isUnlocked = () => !!key;
const host = o => { try { return new URL(o).hostname; } catch (e) { return String(o); } };

function unlock(master) {
  if (!master) throw new Error('clé vide');
  if (!exists()) {
    salt = crypto.randomBytes(16);
    key = crypto.scryptSync(master, salt, 32);
    entries = [];
    persist();
    return { created: true };
  }
  const j = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
  salt = Buffer.from(j.salt, 'base64');
  const k = crypto.scryptSync(master, salt, 32);
  const dec = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(j.iv, 'base64'));
  dec.setAuthTag(Buffer.from(j.tag, 'base64'));
  let plain;
  try { plain = dec.update(Buffer.from(j.data, 'base64'), null, 'utf8') + dec.final('utf8'); }
  catch (e) { throw new Error('clé maîtresse incorrecte'); }
  key = k; entries = JSON.parse(plain || '[]');
  return { created: false };
}
function lock() { key = null; salt = null; entries = []; }
function persist() {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(entries), 'utf8'), c.final()]);
  fs.writeFileSync(VAULT_FILE, JSON.stringify({
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }, null, 2));
}
const list = () => entries.map((e, i) => ({ i, origin: e.origin, user: e.user, pass: e.pass }));
const add = e => { entries.push({ origin: e.origin, user: e.user || '', pass: e.pass || '' }); persist(); };
const update = (i, e) => { if (entries[i]) { entries[i] = { origin: e.origin, user: e.user || '', pass: e.pass || '' }; persist(); } };
const remove = i => { entries.splice(i, 1); persist(); };
const findForOrigin = o => { const h = host(o); return entries.filter(e => host(e.origin) === h); };

module.exports = { exists, isUnlocked, unlock, lock, list, add, update, remove, findForOrigin };