'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createStore, HttpError } = require('./src/store');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const store = createStore();

function send(res, code, body) {
  const json = typeof body !== 'string';
  res.writeHead(code, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
  res.end(json ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

// Ingen ekte innlogging i v1: rollen kommer fra rollevelgeren i UI-et (header X-Role).
async function api(req, res, url) {
  const p = url.pathname.split('/').filter(Boolean).slice(1);
  const role = req.headers['x-role'] || 'tekniker';
  const m = req.method;
  const body = m === 'GET' ? {} : await readBody(req);

  if (m === 'GET' && p[0] === 'health') return send(res, 200, { ok: true });
  if (m === 'GET' && p[0] === 'meta') return send(res, 200, store.meta());
  if (m === 'PUT' && p[0] === 'config') return send(res, 200, store.setConfig(body));

  if (p[0] === 'customer') {
    if (m === 'GET' && !p[1]) return send(res, 200, store.customerView(role));
    if (m === 'PUT' && p[1] === 'profile') return send(res, 200, store.setProfile('customer', null, body, role));
    if (m === 'POST' && p[1] === 'items' && p[2] && p[3]) return send(res, 200, store.itemAction('customer', null, p[2], p[3], role, body));
  }
  if (p[0] === 'locations' && p[1]) {
    const code = p[1];
    if (m === 'GET' && !p[2]) return send(res, 200, store.locationView(code, role));
    if (m === 'PUT' && p[2] === 'profile') return send(res, 200, store.setProfile('location', code, body, role));
    if (m === 'POST' && p[2] === 'items' && p[3] && p[4]) return send(res, 200, store.itemAction('location', code, p[3], p[4], role, body));
    if (m === 'POST' && p[2] === 'auto-check') return send(res, 200, (await store.runAutoChecks(code, role)).view);
    if (m === 'POST' && p[2] === 'followups') return send(res, 201, store.addFollowup(code, body, role));
    if (m === 'DELETE' && p[2] === 'followups' && p[3]) return send(res, 200, store.removeFollowup(code, p[3], role));
  }
  return send(res, 404, { error: 'Ukjent adresse' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbudt');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Ikke funnet');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Noe gikk galt' });
  }
}).listen(PORT, () => console.log('Lytter på port ' + PORT));
