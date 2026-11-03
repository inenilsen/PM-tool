'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./data');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

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

// Per-punkt-signoff: Åpen/Delvis/Mangler -> Utført (Venter QA) -> OK. Uten QA-rolle går punktet rett til OK.
function applyAction(item, action, body) {
  const who = String(body.user || 'ukjent').slice(0, 60);
  const now = new Date().toISOString();
  if (action === 'done') {
    if (item.status === 'g' || item.status === 'n') return 'Punktet er allerede ferdig';
    item.signedBy = who; item.signedAt = now;
    if (item.qa) { item.status = 'q'; item.detail = 'Utført av ' + who + ', venter på QA'; }
    else { item.status = 'g'; item.detail = 'Signert av ' + who; }
    return null;
  }
  if (action === 'approve') {
    if (item.status !== 'q') return 'Punktet venter ikke på QA';
    item.status = 'g'; item.qaBy = who; item.qaAt = now; item.detail = 'QA godkjent av ' + who;
    return null;
  }
  if (action === 'reject') {
    if (item.status !== 'q') return 'Punktet venter ikke på QA';
    const comment = String(body.comment || '').trim();
    if (!comment) return 'Kommentar er påkrevd ved avvisning';
    item.status = 'o'; item.detail = 'Avvist av ' + who + ': ' + comment.slice(0, 300);
    return null;
  }
  return 'Ukjent handling';
}

function rollup(list) {
  const relevant = list.filter((i) => i.status !== 'n');
  if (relevant.some((i) => i.status === 'r')) return 'r';
  if (relevant.some((i) => ['y', 'q'].includes(i.status))) return 'y';
  if (relevant.some((i) => i.status === 'o')) return 'o';
  return 'g';
}

function counts(list) {
  const c = {};
  list.forEach((i) => { c[i.status] = (c[i.status] || 0) + 1; });
  return c;
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // etter "api"
  if (req.method === 'GET' && parts[0] === 'health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && parts[0] === 'customer') {
    const locs = db.locations.map((l) => {
      const o = { ...l };
      if (db.items[l.code]) o.hap = rollup(db.items[l.code]);
      if (db.sat[l.code]) o.sat = rollup(db.sat[l.code]);
      return o;
    });
    return send(res, 200, { labels: db.LABELS, customer: db.customer, locations: locs });
  }
  if (parts[0] === 'locations' && parts[1]) {
    const code = parts[1];
    const loc = db.locations.find((l) => l.code === code);
    if (!loc) return send(res, 404, { error: 'Fant ikke lokasjonen' });
    const items = db.items[code] || [];
    const sat = db.sat[code] || [];
    if (req.method === 'GET' && !parts[2]) {
      return send(res, 200, {
        labels: db.LABELS, customer: db.customer.name, customerCode: db.customer.code,
        location: { ...loc, hap: items.length ? rollup(items) : loc.hap, sat: sat.length ? rollup(sat) : loc.sat },
        items, itemCounts: counts(items), sat, satCounts: counts(sat),
        profile: db.profiles[code] || [], followups: db.followups[code] || []
      });
    }
    if (req.method === 'POST' && parts[2] === 'items' && parts[3] && parts[4]) {
      const item = items.find((i) => i.id === parts[3]);
      if (!item) return send(res, 404, { error: 'Fant ikke punktet' });
      const err = applyAction(item, parts[4], await readBody(req));
      return err ? send(res, 400, { error: err }) : send(res, 200, item);
    }
    if (req.method === 'POST' && parts[2] === 'followups') {
      const b = await readBody(req);
      const text = String(b.text || '').trim();
      if (!text) return send(res, 400, { error: 'Tekst mangler' });
      const list = (db.followups[code] = db.followups[code] || []);
      const fu = { id: Date.now(), text: text.slice(0, 300), owner: String(b.owner || '').slice(0, 60), due: String(b.due || '').slice(0, 20) };
      list.push(fu);
      return send(res, 201, fu);
    }
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
    send(res, 500, { error: 'Noe gikk galt' });
  }
}).listen(PORT, () => console.log('Lytter på port ' + PORT));
