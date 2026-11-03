'use strict';

const app = document.getElementById('app');
const roleSel = document.getElementById('role');
roleSel.value = localStorage.getItem('role') || 'Tekniker';
roleSel.onchange = () => { localStorage.setItem('role', roleSel.value); route(); };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABELS = { g: 'OK', y: 'Delvis', r: 'Mangler', o: 'Åpen', n: 'Ikke aktuell', q: 'Venter QA' };
const pill = (s, label) => `<span class="pill ${s}"><span class="dot"></span>${esc(label || LABELS[s] || s)}</span>`;
const COLOR = { g: 'Grønn', y: 'Gul', r: 'Rød', o: 'Åpen', n: 'Ikke aktuell' };

async function call(path, opts) {
  const r = await fetch(path, opts && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Noe gikk galt');
  return j;
}

function summarize(c) {
  const parts = [];
  if (c.r) parts.push(`${c.r} rød${c.r > 1 ? 'e' : ''}`);
  if (c.y) parts.push(`${c.y} gule`);
  if (c.q) parts.push(`${c.q} venter QA`);
  if (c.o) parts.push(`${c.o} åpne`);
  if (c.g) parts.push(`${c.g} OK`);
  if (c.n) parts.push(`${c.n} ikke aktuell`);
  return parts.join(' · ');
}

// ---------- Kundeoversikt ----------
let locFilter = 'Alle';
async function customerView() {
  const d = await call('/api/customer');
  const c = d.customer, locs = d.locations;
  const kunOk = c.kun.filter((k) => k.status === 'g').length;
  const green = locs.filter((l) => l.hap === 'g').length;
  const blocked = locs.filter((l) => l.hap === 'r' || /^Blokkert/.test(l.handover));
  const kunStatus = c.kun.some((k) => k.status === 'r') ? 'r' : c.kun.some((k) => k.status === 'y') ? 'y' : 'g';
  const satDone = locs.filter((l) => l.sat !== 'o');
  const satStatus = satDone.every((l) => l.sat === 'g') ? 'g' : 'y';
  const filters = {
    Alle: () => true, Røde: (l) => l.hap === 'r' || l.sat === 'r',
    'Venter QA': (l) => /QA/.test(l.handover), 'Blokkerer handover': (l) => /^Blokkert/.test(l.handover),
    'Mine lokasjoner': (l) => l.code === '0D'
  };
  const shown = locs.filter(filters[locFilter]);
  app.innerHTML = `
    <div class="crumbs">Home / Dokumentasjon / ${esc(c.code)}</div>
    <div><h1>${esc(c.name)} [${esc(c.code)}]</h1><span class="muted">${locs.length} lokasjoner</span></div>
    <div class="grid">
      <div class="card"><div class="ch">KUNDE · Dok (HAP) ${pill(kunStatus, COLOR[kunStatus])}</div><div class="cb muted">Kundenivå: ${kunOk} av ${c.kun.length} punkter OK</div></div>
      <div class="card"><div class="ch">KUNDE · Test (SAT) ${pill(satStatus, COLOR[satStatus])}</div><div class="cb muted">${satStatus === 'g' ? 'Alle ferdigstilte lokasjoner har bestått' : 'Noen lokasjoner har åpne eller delvise tester'}</div></div>
      <div class="card"><div class="ch">LOKASJONER · Dok-status</div><div class="cb"><span class="big">${green} av ${locs.length} grønne</span></div></div>
      <div class="card"><div class="ch">HANDOVER</div><div class="cb"><span class="big">${blocked.length} blokkert</span><span class="muted">Røde punkter hindrer godkjenning</span></div></div>
    </div>
    <div class="card"><div class="ch"><span>Kundenivå (overordnet) <span class="muted">KUN-01 til KUN-07</span></span></div>
      ${c.kun.map((k) => `<div class="row" style="grid-template-columns:76px 1fr 130px"><b>${esc(k.id)}</b><div class="t">${esc(k.title)}<small>${esc(k.detail)}</small></div>${pill(k.status)}</div>`).join('')}
    </div>
    <div class="card"><div class="ch"><span>Implementasjoner <span class="muted">CMDB + lenke i kundepublish</span></span></div>
      <div class="chips">${c.impl.map((m) => `<span>${esc(m.name)} ${pill(m.status, m.label)}</span>`).join('')}</div>
    </div>
    <div class="card"><div class="ch"><span>Lokasjoner <span class="muted">Viser ${shown.length} av ${locs.length}</span></span>
      <span class="filters">${Object.keys(filters).map((f) => `<button class="${f === locFilter ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</span></div>
      <div class="row head r-locs"><span>Lokasjon</span><span>Fase</span><span>Test (SAT)</span><span>Dok (HAP)</span><span>Handover</span></div>
      ${shown.map((l) => `<div class="row r-locs"><a href="#/loc/${esc(l.code)}">${esc(l.name)}</a><span>${esc(l.phase)}</span>${pill(l.sat, COLOR[l.sat])}${pill(l.hap, COLOR[l.hap])}<span>${esc(l.handover)}</span></div>`).join('') || '<div class="row muted">Ingen lokasjoner</div>'}
    </div>`;
  app.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { locFilter = b.dataset.f; customerView(); }; });
}

// ---------- Lokasjon ----------
async function locationView(code) {
  const d = await call('/api/locations/' + encodeURIComponent(code));
  const l = d.location, role = roleSel.value;
  const hapC = d.itemCounts, satC = d.satCounts;
  const red = hapC.r || 0;
  const open = d.items.filter((i) => i.status !== 'g' && i.status !== 'n');
  app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Locations / ${esc(d.customerCode)}-${esc(l.code)}</div>
    <div><h1>${esc(d.customer)} - ${esc(l.name)}</h1><span class="muted">${esc(l.address || '')}</span></div>
    <div class="grid">
      <div class="card"><div class="ch">DOK · Handover-protokoll (HAP) ${pill(l.hap, COLOR[l.hap])}</div><div class="cb muted">${esc(summarize(hapC))}</div></div>
      <div class="card"><div class="ch">TEST · Site Acceptance Test (SAT) ${pill(l.sat, COLOR[l.sat])}</div><div class="cb muted">${esc(summarize(satC))}</div>
        <div class="cb"><a href="#/loc/${esc(l.code)}/sat">Åpne SAT og signoff →</a></div></div>
      <div class="card"><div class="ch">Fase</div><div class="cb"><span class="big">${esc(l.phase)}</span></div></div>
    </div>
    ${red ? `<div class="alert"><b>Blokkerer handover</b><br>${red} rødt punkt må løses før handover kan godkjennes.</div>` : ''}
    <div class="card"><div class="ch">Dokumentasjonspunkter (${d.items.length}) <span class="muted small">${open.length} åpne</span></div>
      <div class="row head r-items"><span>ID</span><span>Punkt</span><span>Status</span><span>Ansvarlig → QA</span><span>Kilde</span></div>
      ${d.items.map((i) => `<div class="row r-items"><b>${esc(i.id)}</b><div class="t">${esc(i.title)}<small>${esc(i.detail)}</small></div>${pill(i.status)}<span>${esc(i.who)}${i.qa ? ' → ' + esc(i.qa) : ''}</span><span class="muted">${esc(i.src)}</span></div>`).join('')}
    </div>`;
}

// ---------- SAT og signoff ----------
let selItem = null;
async function satView(code) {
  const d = await call('/api/locations/' + encodeURIComponent(code));
  const l = d.location, role = roleSel.value;
  const queue = d.items.filter((i) => i.qa);
  if (!selItem || !queue.find((i) => i.id === selItem)) selItem = (queue.find((i) => i.status === 'q') || queue[0] || {}).id;
  const it = queue.find((i) => i.id === selItem);
  const stepState = (s) => ({ o: 0, y: 0, r: 0, q: 2, g: 3 }[s] ?? 0);
  const step = it ? stepState(it.status) : 0;
  const steps = [['Åpen', 'Ikke utført', 'o'], ['Utført', 'Tekniker har markert ferdig', 'y'], ['Venter QA', it ? it.qa + ' kontrollerer' : '', 'q'], ['OK', 'QA godkjent', 'g']];
  const first = it && ['o', 'y', 'r'].includes(it.status);
  app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / <a href="#/loc/${esc(l.code)}">${esc(d.customerCode)}-${esc(l.code)}</a> / Dokumentasjon / Test (SAT)</div>
    <div class="flow"><h1>Site Acceptance Test · ${esc(l.name)}</h1>${pill(l.sat, COLOR[l.sat])}</div>
    <div class="actions"><button id="pdf">Eksporter PDF</button></div>
    <div class="card"><div class="ch">Testprofil for lokasjonen <span class="muted small">Utledet fra inventar, nett og WAN</span></div>
      <div class="chips">${d.profile.map((p) => `<span title="${esc(p.source)}">${esc(p.name)} ${pill(p.status, p.label)}</span>`).join('')}</div></div>
    <div class="card"><div class="ch">Testpunkter <span class="muted small">${esc(summarize(d.satCounts))}</span></div>
      <div class="row head r-sat"><span>ID</span><span>Test</span><span>Forventet</span><span>Resultat</span><span>Status</span><span>Vurdering</span></div>
      ${d.sat.map((s) => `<div class="row r-sat" ${s.status === 'n' ? 'style="opacity:.5"' : ''}><b>${esc(s.id)}</b><span>${esc(s.test)}</span><span class="muted">${esc(s.expected)}</span><span>${esc(s.result) || '<span class="muted">Ikke utført</span>'}</span>${pill(s.status)}<span class="muted">${esc(s.how)}</span></div>`).join('')}
    </div>
    <div class="card"><div class="ch">Signoff-flyt per punkt</div><div class="cb">
      ${it ? `
      <label class="muted">Punkt <select id="pick">${queue.map((i) => `<option value="${esc(i.id)}" ${i.id === selItem ? 'selected' : ''}>${esc(i.id)} · ${esc(i.title)}</option>`).join('')}</select></label>
      <div class="flow">${steps.map((s, n) => `${n ? '→' : ''} <span title="${esc(s[1])}">${pill(s[2], s[0])}</span>`).join('')}</div>
      <div><b>${esc(it.id)}</b> · ${esc(it.title)}<br><span class="muted">Ansvarlig: ${esc(it.who)} · QA: ${esc(it.qa)}</span><br><span class="muted">${esc(it.detail)}</span></div>
      ${first ? `<div class="actions"><button class="primary" id="done">Marker som utført (${esc(role)})</button></div>` : ''}
      ${step === 2 ? `<label class="muted">Kommentar (påkrevd ved avvisning)<textarea id="comment"></textarea></label>
        <div class="actions"><button class="primary" id="approve">Godkjenn (QA)</button><button class="danger" id="reject">Avvis med kommentar</button></div>
        ${role !== it.qa ? `<span class="muted small">Du jobber som ${esc(role)}. QA-rollen for dette punktet er ${esc(it.qa)}.</span>` : ''}` : ''}
      ${step === 3 ? `<span class="muted">Signert av ${esc(it.signedBy || '')}, QA ${esc(it.qaBy || '')}.</span>` : ''}
      <span id="msg" class="err"></span>` : '<span class="muted">Ingen punkter med QA-rolle.</span>'}
      <span class="muted small">Punkter uten QA-rolle går rett fra Utført til OK. Hvem som signerte og når lagres på punktet.</span>
    </div></div>
    <div class="card"><div class="ch">Oppfølgingspunkter <span class="muted small">Samme liste som «utestående punkter» i HAP</span></div>
      <div class="row head" style="grid-template-columns:1fr 140px 120px"><span>Punkt</span><span>Ansvarlig</span><span>Frist</span></div>
      ${d.followups.map((f) => `<div class="row" style="grid-template-columns:1fr 140px 120px"><span>${esc(f.text)}</span><span>${esc(f.owner)}</span><span>${esc(f.due) || '<span class="muted">–</span>'}</span></div>`).join('')}
      <form id="fu" class="row" style="grid-template-columns:1fr 140px 140px auto"><input name="text" placeholder="Nytt punkt" required><input name="owner" placeholder="Ansvarlig"><input name="due" type="date"><button class="primary">+ Legg til punkt</button></form>
    </div>`;
  const msg = (t) => { const m = document.getElementById('msg'); if (m) m.textContent = t; };
  const act = (a) => async () => {
    try {
      await call(`/api/locations/${l.code}/items/${it.id}/${a}`, { user: roleSel.value, comment: (document.getElementById('comment') || {}).value });
      satView(code);
    } catch (e) { msg(e.message); }
  };
  const bind = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  bind('done', act('done')); bind('approve', act('approve')); bind('reject', act('reject')); bind('pdf', () => window.print());
  const pick = document.getElementById('pick'); if (pick) pick.onchange = () => { selItem = pick.value; satView(code); };
  document.getElementById('fu').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    await call(`/api/locations/${l.code}/followups`, { text: f.get('text'), owner: f.get('owner'), due: f.get('due') });
    satView(code);
  };
}

function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const run = h[0] === 'loc' && h[1] ? (h[2] === 'sat' ? satView(h[1]) : locationView(h[1])) : customerView();
  run.catch((e) => { app.innerHTML = `<div class="alert">${esc(e.message)}</div>`; });
}
window.addEventListener('hashchange', route);
route();
