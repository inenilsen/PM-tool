'use strict';

const $app = document.getElementById('app');
const $role = document.getElementById('role');
const $lights = document.getElementById('lights');

let META = null;
let openId = null;
const filters = { loc: 'Alle', cust: 'Alle' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const role = () => $role.value;
const roleLabel = (r) => (META.roles.find((x) => x.id === r) || {}).label || r || '–';
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' }) : '');

const LABEL = { green: 'OK', yellow: 'Delvis', red: 'Mangler', open: 'Åpen', not_applicable: 'Ikke aktuell' };
const COLOR_LABEL = { green: 'Grønn', yellow: 'Gul', red: 'Rød', open: 'Åpen', not_applicable: 'Ikke aktuell' };
const HOW = { auto: 'Automatisk', auto_plus_manual_qa: 'Auto + manuell QA', manual: 'Manuell', manual_signoff: 'Manuell · signoff', manual_typed: 'Manuelt · typet', manual_typed_auto_judged: 'Typet · vurderes automatisk', derived_plus_signoff: 'Utledet + signoff' };
const IMPL_LABEL = { documented: ['green', 'Dokumentert'], partial: ['yellow', 'Delvis'], missing: ['red', 'Mangler'], not_applicable: ['not_applicable', 'Ikke aktuell'] };

// Farge er aldri eneste bærer av status: pillen har alltid tekst, og «åpen» har stiplet ring.
const pill = (status, label, stage) => `<span class="pill ${stage === 'awaiting_qa' ? 's-yellow' : 's-' + status}"><span class="dot"></span>${esc(label)}</span>`;
const light = (status) => pill(status, COLOR_LABEL[status]);

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Role': role() }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Noe gikk galt');
  return j;
}

function counts(c) {
  const p = [];
  if (c.red) p.push(`${c.red} rød${c.red > 1 ? 'e' : 't'}`);
  if (c.yellow) p.push(`${c.yellow} gul${c.yellow > 1 ? 'e' : 't'}`);
  if (c.awaiting_qa) p.push(`${c.awaiting_qa} venter QA`);
  if (c.open) p.push(`${c.open} åpne`);
  p.push(`${c.green} OK`);
  if (c.not_applicable) p.push(`${c.not_applicable} ikke aktuell`);
  return p.join(' · ');
}

function stepper(r) {
  const cur = r.status === 'not_applicable' ? -1 : r.stage === 'approved' || (!r.qa && r.status !== 'open') ? 3 : r.stage === 'awaiting_qa' ? 2 : r.state.done ? 1 : 0;
  const steps = [['open', 'Åpen', 'Ikke utført'], ['yellow', 'Utført', (roleLabel(r.responsible)) + ' har markert ferdig'], ['yellow', 'Venter QA', r.qa ? roleLabel(r.qa) + ' kontrollerer' : 'Ingen QA-rolle'], ['green', 'OK', 'Godkjent']];
  return `<div class="stepper">${steps.map((s, i) => `${i ? '→' : ''}<span class="${i === cur ? 'step-on' : ''}" title="${esc(s[2])}">${pill(s[0], s[1])}</span>`).join('')}</div>`;
}

function resultText(r) {
  const v = r.state.result;
  if (!v) return '';
  if (r.resultKind === 'mbps') return `${v.measured} Mbps målt`;
  if (r.resultKind === 'bandwidth') return `${v.measured} av ${v.ordered} Mbps`;
  if (r.resultKind === 'network') return `VLAN ${v.vlan} · IP ${v.ip} · DNS ${v.dnsOk ? 'OK' : 'feil'}`;
  return '';
}

// ---------- Felles panel for ett punkt ----------
function panel(r, base) {
  const s = r.state;
  const isMine = role() === r.responsible;
  const settled = r.stage === 'approved' || r.status === 'green' || r.status === 'red';
  const canDo = isMine && r.status !== 'not_applicable' && r.stage !== 'awaiting_qa' && !settled;
  const canQa = r.stage === 'awaiting_qa' && role() === r.qa;
  const canReopen = (isMine || role() === 'pm') && r.status !== 'open' && r.status !== 'not_applicable' && r.stage !== 'awaiting_qa';
  const attrs = `data-base="${esc(base)}" data-id="${esc(r.id)}" data-kind="${esc(r.resultKind || '')}"`;
  const tol = Math.round(META.config.bandwidthTolerance * 100);
  const res = s.result || {};
  let typed = '';
  if (r.resultKind === 'mbps') typed = `<label>Målt (Mbps)<input name="measured" type="number" min="0" value="${esc(res.measured)}"></label>`;
  if (r.resultKind === 'bandwidth') typed = `<label>Bestilt (Mbps)<input name="ordered" type="number" min="0" value="${esc(res.ordered)}"></label><label>Målt (Mbps)<input name="measured" type="number" min="0" value="${esc(res.measured)}"></label><span class="muted small">Vurderes automatisk mot bestilt, toleranse ${tol} %</span>`;
  if (r.resultKind === 'network') typed = `<label>VLAN<input name="vlan" value="${esc(res.vlan)}" size="6"></label><label>IP<input name="ip" value="${esc(res.ip)}" size="14"></label><label>DNS<select name="dnsOk"><option value="true">OK</option><option value="false" ${res.dnsOk === false ? 'selected' : ''}>Feil</option></select></label>`;
  const outcome = r.resultKind === 'bandwidth' ? '' : `<label>Resultat<select name="outcome"><option value="green">Grønn (OK)</option><option value="yellow">Gul (delvis, med plan)</option><option value="red">Rød (mangler / feilet)</option></select></label>`;

  return `<div class="panel">
    ${stepper(r)}
    <div class="kv">
      <div><b>Ansvarlig → QA</b>${esc(roleLabel(r.responsible))}${r.qa ? ' → ' + esc(roleLabel(r.qa)) : ' (ingen QA)'}</div>
      <div><b>Kilde / vurdering</b>${esc(META.sources[r.source] || r.source)} · ${esc(HOW[r.verification] || r.verification)}</div>
      ${r.condition ? `<div><b>Betingelse</b>${esc(r.condition)}${r.conditionUnknown ? ' (ikke avklart i testprofilen)' : ''}</div>` : ''}
      ${s.done ? `<div><b>Utført av</b>${esc(s.done.by)} · ${esc(fmt(s.done.at))}</div>` : ''}
      ${s.qa ? `<div><b>QA godkjent av</b>${esc(s.qa.by)} · ${esc(fmt(s.qa.at))}</div>` : ''}
      ${s.rejected ? `<div><b>Avvist av ${esc(s.rejected.by)}</b>${esc(s.rejected.comment)}</div>` : ''}
      ${resultText(r) ? `<div><b>Resultat</b>${esc(resultText(r))}</div>` : ''}
      ${s.owner || s.due || s.plan ? `<div><b>Ansvarlig · frist · plan</b>${esc(s.owner || '–')} · ${esc(s.due || '–')} · ${esc(s.plan || '–')}</div>` : ''}
      ${s.comment ? `<div><b>Kommentar</b>${esc(s.comment)}</div>` : ''}
    </div>
    ${r.status !== 'not_applicable' ? `<form data-action="assign" ${attrs}>
      <label>Navngitt ansvarlig<input name="owner" value="${esc(s.owner)}"></label>
      <label>Frist<input name="due" type="date" value="${esc(s.due)}"></label>
      <label>Plan<input name="plan" value="${esc(s.plan)}" size="26"></label>
      <button>Lagre ansvarlig og frist</button></form>` : ''}
    ${canDo ? `<form data-action="done" ${attrs}><fieldset><legend>Marker som utført (${esc(roleLabel(role()))})</legend>
      ${typed}${outcome}<label>Kommentar<input name="comment" size="26" value="${esc(s.comment)}"></label>
      <button class="primary">Utført</button></fieldset>
      <span class="muted small">Gult krever navngitt ansvarlig, frist og plan (fyll ut over først).</span></form>` : ''}
    ${canQa ? `<form data-action="qa" ${attrs}><fieldset><legend>QA (${esc(roleLabel(role()))})</legend>
      <label style="flex:1">Kommentar (påkrevd ved avvisning)<textarea name="comment"></textarea></label>
      <button class="primary" name="act" value="approve">Godkjenn (QA)</button><button class="danger" name="act" value="reject">Avvis med kommentar</button></fieldset></form>` : ''}
    ${r.stage === 'awaiting_qa' && !canQa ? `<span class="muted small">Venter på QA fra ${esc(roleLabel(r.qa))}. Du jobber som ${esc(roleLabel(role()))}.</span>` : ''}
    ${!canDo && !canQa && r.status === 'open' && !isMine ? `<span class="muted small">Ansvarlig rolle er ${esc(roleLabel(r.responsible))}. Bytt rolle øverst for å utføre.</span>` : ''}
    ${canReopen ? `<form data-action="reopen" ${attrs}><button>Åpne på nytt</button></form>` : ''}
    <span class="err" data-msg="${esc(r.id)}"></span>
  </div>`;
}

function itemRow(r, base, cls, cells) {
  const open = openId === r.id;
  return `<div class="row ${cls} click ${r.status === 'not_applicable' ? 'na' : ''} ${open ? 'sel' : ''}" data-open="${esc(r.id)}">${cells}</div>${open ? panel(r, base) : ''}`;
}

function filterBar(key, names) {
  return `<span class="filters">${names.map((n) => `<button class="${filters[key] === n ? 'on' : ''}" data-filter="${esc(key)}|${esc(n)}">${esc(n)}</button>`).join('')}</span>`;
}

function setLights(sum) {
  $lights.innerHTML = sum ? `<span>Dok ${light(sum.hap)}</span><span>Test ${light(sum.sat)}</span>` : '';
}

// ---------- Skjerm 1: lokasjonsside ----------
const WIDGETS = [
  ['General Information', 'Adresse, lokasjonsstatus og kontaktpersoner', ['LOK-04', 'LOK-06', 'LOK-18']],
  ['Images', 'Bilder av skap og patchepanel', ['LOK-05']],
  ['Floor Plans', 'Plantegning med AP-plassering', ['LOK-15']],
  ['WAN Circuits', 'Linjer, backup og lisens', ['LOK-07', 'LOK-12']],
  ['Network Assets', 'Rutere, switcher, AP og brannmurer', ['LOK-01', 'LOK-02', 'LOK-03', 'LOK-08']],
  ['Workplace Assets', 'Printere, møterom og skilt', ['LOK-11']],
  ['SSID', 'Trådløse nett og autentisering', []],
  ['Networks', 'Nett og VLAN', ['LOK-14', 'LOK-16']],
  ['Service Cards', 'Service cards og billing company', ['LOK-09', 'LOK-10']],
  ['Tickets', 'Saker på lokasjonen', []],
  ['Processes', 'Change og sikkerhetspolicy', ['LOK-13', 'LOK-17']]
];

async function locationView(code) {
  const d = await api('/api/locations/' + encodeURIComponent(code));
  const s = d.summary;
  setLights(s);
  const hap = d.items.filter((i) => i.phase !== 'sat');
  const f = filters.loc;
  const shown = hap.filter((i) => f === 'Alle' || (f === 'Mine punkter' && i.mine) || (f === 'QA-kø' && i.inQaQueue));
  const byId = Object.fromEntries(d.items.map((i) => [i.id, i]));
  const base = '/api/locations/' + code;
  const b = d.blockers;
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Locations / ${esc(d.customer.code)}-${esc(d.location.code)}</div>
    <div class="flow"><h1>${esc(d.customer.name)} - ${esc(d.location.name)}</h1><span class="muted">Fase: ${esc(d.location.phase)}</span></div>
    <div class="card new"><div class="ch">Dokumentasjonsstatus <span class="tag">NY</span></div>
      <div class="grid" style="padding:14px">
        <div class="card"><div class="ch">DOK · Handover-protokoll (HAP) ${light(s.hap)}</div><div class="cb muted">${esc(counts({ ...s.hapCounts }))}</div></div>
        <div class="card"><div class="ch">TEST · Site Acceptance Test (SAT) ${light(s.sat)}</div><div class="cb muted">${esc(counts(s.satCounts))}</div><div class="cb"><a href="#/loc/${esc(code)}/sat">Åpne SAT og signoff →</a></div></div>
        <div class="card"><div class="ch">Handover</div><div class="cb"><span class="big">${esc(s.handover.label)}</span></div></div>
      </div>
      ${s.blocksHandover ? `<div class="alert" style="margin:0 14px 14px"><b>Blokkerer handover</b><br>${b.red ? `${b.red} rødt punkt må løses. ` : ''}${b.openWithoutPlan ? `${b.openWithoutPlan} åpne punkter mangler ansvarlig og frist. ` : ''}</div>` : ''}
      <div class="ch" style="border-top:1px solid #1d2f4d">Punkter (${shown.length} av ${hap.length}) ${filterBar('loc', ['Alle', 'Mine punkter', 'QA-kø'])}</div>
      <div class="row head r-items"><span>ID</span><span>Punkt</span><span>Status</span><span>Ansvarlig → QA</span><span>Kilde</span></div>
      ${shown.map((r) => itemRow(r, base, 'r-items', `<b>${esc(r.id)}</b><div class="t">${esc(r.title)}<small>${esc(r.state.comment || '')}</small></div>${pill(r.status, r.label, r.stage)}<span>${esc(roleLabel(r.responsible))}${r.qa ? ' → ' + esc(roleLabel(r.qa)) : ''}</span><span class="muted">${esc(META.sources[r.source] || r.source)}</span>`)).join('') || '<div class="row muted">Ingen punkter i dette filteret</div>'}
      <div class="cf"><span class="actions"><button data-act="auto">Kjør automatiske sjekker (mock)</button><span class="muted">Mock-kilder: ingen ekte kall.</span></span><span class="err" data-msg="auto"></span></div>
    </div>
    <div class="widgets">${WIDGETS.map(([name, desc, ids]) => `<div class="card"><div class="ch">${esc(name)}</div><div class="cb muted">${esc(desc)}</div>
      <div class="cf">${ids.length ? ids.map((id) => byId[id]).filter(Boolean).map((r) => `<div class="sl">${pill(r.status, r.label, r.stage)}<span><b>${esc(r.id)}</b> <span class="muted">${esc(r.title)}</span></span></div>`).join('') : '<span class="muted">Ingen sjekkpunkter</span>'}</div></div>`).join('')}</div>`;
}

// ---------- Skjerm 2: kundeoversikt ----------
const CUST_FILTERS = {
  Alle: () => true,
  Røde: (l) => l.hap === 'red' || l.sat === 'red',
  'Venter QA': (l) => l.awaitingQa > 0,
  'Blokkerer handover': (l) => l.blocksHandover,
  'Mine lokasjoner': (l) => l.mine > 0 || l.qaQueue > 0
};

async function customerView() {
  const d = await api('/api/customer');
  setLights(null);
  const sm = d.summary;
  const kunOk = sm.kunCounts.green;
  const kunTotal = sm.kunCounts.green + sm.kunCounts.yellow + sm.kunCounts.red + sm.kunCounts.open;
  const shown = d.locations.filter(CUST_FILTERS[filters.cust]);
  const total = sm.locationsTotal;
  const seg = ['green', 'yellow', 'red', 'open'].filter((k) => sm.segments[k]);
  $app.innerHTML = `
    <div class="crumbs">Home / Dokumentasjon / ${esc(d.customer.code)}</div>
    <div><h1>${esc(d.customer.name)} [${esc(d.customer.code)}]</h1><span class="muted">${total} lokasjoner</span></div>
    <div class="grid">
      <div class="card"><div class="ch">KUNDE · Dok (HAP) ${light(sm.kun)}</div><div class="cb muted">Kundenivå: ${kunOk} av ${kunTotal} punkter OK</div></div>
      <div class="card"><div class="ch">KUNDE · Test (SAT) ${light(sm.sat)}</div><div class="cb muted">Dårligste Test-lys blant lokasjoner som har startet</div></div>
      <div class="card"><div class="ch">LOKASJONER · Dok-status</div><div class="cb"><span class="big">${sm.locationsGreen} av ${total} grønne</span>
        <div class="seg">${seg.map((k) => `<span class="s-${k}" style="width:${(sm.segments[k] / total) * 100}%" title="${LABEL[k]}"></span>`).join('')}</div>
        <div class="legend">${seg.map((k) => `<span>${pill(k, LABEL[k])} ${sm.segments[k]}</span>`).join('')}</div></div></div>
      <div class="card"><div class="ch">HANDOVER</div><div class="cb"><span class="big">${sm.blocked} blokkert</span><span class="muted">Røde punkter og åpne punkter uten ansvarlig hindrer godkjenning</span></div></div>
    </div>
    <div class="card new"><div class="ch">Kundenivå (overordnet) <span class="muted small">KUN-01 til KUN-07</span><span class="tag">NY</span></div>
      <div class="row head r-kun"><span>ID</span><span>Punkt</span><span>Status</span><span>Ansvarlig → QA</span></div>
      ${d.kunItems.map((r) => itemRow(r, '/api/customer', 'r-kun', `<b>${esc(r.id)}</b><div class="t">${esc(r.title)}<small>${esc(r.state.comment || (r.id === 'KUN-07' && !sm.canApproveHandover ? 'Låst til alle krav er OK eller gule med plan' : ''))}</small></div>${pill(r.status, r.label, r.stage)}<span>${esc(roleLabel(r.responsible))}${r.qa ? ' → ' + esc(roleLabel(r.qa)) : ''}</span>`)).join('')}
    </div>
    <div class="card new"><div class="ch">Implementasjoner <span class="muted small">CMDB + lenke i kundepublish</span><span class="tag">NY</span></div>
      <div class="chips">${d.implementations.map((m) => { const [k, l] = IMPL_LABEL[m.status]; return `<span class="chip">${esc(m.type)} ${pill(k, l)}</span>`; }).join('')}</div></div>
    <div class="card"><div class="ch"><span>Lokasjoner <span class="muted small">Viser ${shown.length} av ${total}</span></span>${filterBar('cust', Object.keys(CUST_FILTERS))}</div>
      <div class="row head r-locs"><span>Lokasjon</span><span>Fase</span><span>Test (SAT)</span><span>Dok (HAP)</span><span>Handover</span></div>
      ${shown.map((l) => `<div class="row r-locs"><a href="#/loc/${esc(l.code)}">${esc(l.name)}</a><span>${esc(l.phase)}</span>${light(l.sat)}${light(l.hap)}<span>${esc(l.handover.label)}${l.qaQueue ? ` <span class="tag">${l.qaQueue} i din QA-kø</span>` : ''}</span></div>`).join('') || '<div class="row muted">Ingen lokasjoner i dette filteret</div>'}
    </div>`;
}

// ---------- Skjerm 3: SAT og signoff ----------
async function satView(code) {
  const d = await api('/api/locations/' + encodeURIComponent(code));
  const s = d.summary;
  setLights(s);
  const base = '/api/locations/' + code;
  const sat = d.items.filter((i) => i.phase === 'sat');
  const qaItems = d.items.filter((i) => i.qa && i.status !== 'not_applicable');
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / <a href="#/loc/${esc(code)}">${esc(d.customer.code)}-${esc(code)}</a> / Dokumentasjon / Test (SAT)</div>
    <div class="flow"><h1>Site Acceptance Test · ${esc(d.location.name)}</h1>${light(s.sat)}</div>
    <div class="card new"><div class="ch">Testprofil for lokasjonen <span class="tag">NY</span><span class="muted small">Settes manuelt i v1 (kan overstyres). «Uavklart» holder punktene åpne.</span></div>
      <form class="profile" data-action="profile" data-base="${esc(base)}">
        ${d.profileFields.map((f) => {
          const v = d.location.profile[f.key];
          return f.type === 'number'
            ? `<label>${esc(f.label)}<input name="${f.key}" type="number" min="0" value="${v == null ? '' : esc(v)}"></label>`
            : `<label>${esc(f.label)}<select name="${f.key}"><option value="" ${v == null ? 'selected' : ''}>Uavklart</option><option value="true" ${v === true ? 'selected' : ''}>Ja</option><option value="false" ${v === false ? 'selected' : ''}>Nei</option></select></label>`;
        }).join('')}
        <div style="grid-column:1/-1"><button class="primary">Lagre testprofil</button> <span class="err" data-msg="profile"></span></div>
      </form></div>
    <div class="card"><div class="ch">Testpunkter <span class="tag">NY</span><span class="muted small">${esc(counts(s.satCounts))}</span></div>
      <div class="row head r-sat"><span>ID</span><span>Test</span><span>Forventet</span><span>Resultat</span><span>Status</span><span>Vurdering</span></div>
      ${sat.map((r) => itemRow(r, base, 'r-sat', `<b>${esc(r.id)}</b><span>${esc(r.title)}</span><span class="muted">${esc(r.expected || '')}</span><span>${esc(resultText(r) || r.state.comment || '') || '<span class="muted">Ikke utført</span>'}</span>${pill(r.status, r.label, r.stage)}<span class="muted">${esc(HOW[r.verification] || '')}</span>`)).join('')}
      <div class="cf"><label class="muted">Toleranse for SAT-bandbredde (%) <input id="tol" type="number" min="0" max="50" value="${Math.round(META.config.bandwidthTolerance * 100)}" style="width:70px"></label><button data-act="tol">Lagre toleranse</button><span class="err" data-msg="tol"></span></div>
    </div>
    <div class="card new"><div class="ch">Signoff-flyt per punkt <span class="tag">NY</span></div><div class="cb">
      <span class="muted small">Punkter uten QA-rolle går rett fra Utført til OK. Hvem som signerte og når lagres på punktet. Velg et punkt i tabellene for å utføre eller godkjenne.</span>
      ${qaItems.map((r) => `<div class="flow"><b>${esc(r.id)}</b><span>${esc(r.title)}</span>${pill(r.status, r.label, r.stage)}</div>`).join('')}
    </div></div>
    <div class="card new"><div class="ch">Oppfølgingspunkter <span class="tag">NY</span><span class="muted small">Samme liste som «utestående punkter» i HAP (LOK-17)</span></div>
      <div class="row head r-fu"><span>Punkt</span><span>Ansvarlig</span><span>Frist</span><span></span></div>
      ${d.followups.map((f) => `<div class="row r-fu"><span>${esc(f.text)}</span><span>${esc(f.owner) || '–'}</span><span>${esc(f.due) || '–'}</span><button data-act="del-fu" data-id="${f.id}" title="Fjern" aria-label="Fjern punkt">×</button></div>`).join('')}
      <form class="row" data-action="followup" data-base="${esc(base)}" style="grid-template-columns:minmax(200px,1fr) 150px 150px auto"><input name="text" placeholder="Nytt punkt" required><input name="owner" placeholder="Ansvarlig"><input name="due" type="date"><button class="primary">+ Legg til punkt</button></form>
    </div>`;
}

// ---------- Router og hendelser ----------
async function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (h[0] === 'loc' && h[1]) await (h[2] === 'sat' ? satView(h[1]) : locationView(h[1]));
    else await customerView();
  } catch (e) { $app.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
}

const msg = (id, t) => { const el = $app.querySelector(`[data-msg="${CSS.escape(id)}"]`); if (el) el.textContent = t; };
const locCode = () => location.hash.replace(/^#\/?/, '').split('/')[1];

$app.addEventListener('click', async (e) => {
  const t = e.target;
  const fb = t.closest('[data-filter]');
  if (fb) { const [k, n] = fb.dataset.filter.split('|'); filters[k] = n; return route(); }
  const act = t.closest('[data-act]');
  if (act) {
    try {
      if (act.dataset.act === 'auto') { await api(`/api/locations/${locCode()}/auto-check`, 'POST'); return route(); }
      if (act.dataset.act === 'del-fu') { await api(`/api/locations/${locCode()}/followups/${act.dataset.id}`, 'DELETE'); return route(); }
      if (act.dataset.act === 'tol') { await api('/api/config', 'PUT', { bandwidthTolerance: Number(document.getElementById('tol').value) / 100 }); META = await api('/api/meta'); return route(); }
    } catch (err) { msg(act.dataset.act === 'tol' ? 'tol' : 'auto', err.message); }
    return;
  }
  if (t.closest('.panel')) return;
  const row = t.closest('[data-open]');
  if (row && !t.closest('a,button')) { openId = openId === row.dataset.open ? null : row.dataset.open; route(); }
});

$app.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-action]');
  if (!form) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  const { base, id, kind } = form.dataset;
  const key = id || form.dataset.action;
  try {
    let action = form.dataset.action;
    if (action === 'profile') {
      await api(base + '/profile', 'PUT', fd);
    } else if (action === 'followup') {
      await api(base + '/followups', 'POST', fd);
    } else {
      if (action === 'qa') action = e.submitter && e.submitter.value;
      const body = { ...fd };
      if (action === 'done') {
        if (kind === 'mbps') body.result = { measured: Number(fd.measured) };
        if (kind === 'bandwidth') body.result = { ordered: Number(fd.ordered), measured: fd.measured === '' ? '' : Number(fd.measured) };
        if (kind === 'network') body.result = { vlan: fd.vlan, ip: fd.ip, dnsOk: fd.dnsOk === 'true' };
      }
      await api(`${base}/items/${id}/${action}`, 'POST', body);
    }
    route();
  } catch (err) { msg(key, err.message); }
});

$role.addEventListener('change', () => { localStorage.setItem('role', role()); route(); });
window.addEventListener('hashchange', () => { openId = null; route(); });

(async () => {
  META = await api('/api/meta');
  $role.innerHTML = META.roles.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join('');
  $role.value = localStorage.getItem('role') || 'tekniker';
  route();
})();
