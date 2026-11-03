'use strict';

// Anonymisert eksempeldata: kunde «Eksempel Kunde AS» med 14 lokasjoner i ulike faser og statuser.
// Ingen ekte kundedata, IP-adresser eller hemmeligheter. Genereres deterministisk.

const catalog = require('./catalog');
const { evalCondition, emptyState } = require('../status/engine');

const NOW = '2026-10-20T09:00:00.000Z';
const roleName = (r) => catalog.ROLE_LABELS[r] || r;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOCATIONS = [
  ['0D', 'Oslo | Hovedkontor', 'Under utrulling'], ['0E', 'Bergen | Kontor', 'Operativ støtteperiode'],
  ['0F', 'Trondheim | Kontor', 'Operativ støtteperiode'], ['0G', 'Stavanger | Kontor', 'Under utrulling'],
  ['0H', 'Tromsø | Kontor', 'Planlagt'], ['0J', 'Kristiansand | Kontor', 'Drift'],
  ['0K', 'Drammen | Kontor', 'Handover godkjent'], ['0L', 'Fredrikstad | Kontor', 'Planlagt'],
  ['0M', 'Bodø | Kontor', 'Under utrulling'], ['0N', 'Ålesund | Kontor', 'Operativ støtteperiode'],
  ['0P', 'Tønsberg | Kontor', 'Drift'], ['0Q', 'Hamar | Kontor', 'Planlagt'],
  ['0R', 'Sandnes | Kontor', 'Under utrulling'], ['0S', 'Molde | Kontor', 'Handover godkjent']
];

const PROGRESS = { Planlagt: 0, 'Under utrulling': 0.5, 'Operativ støtteperiode': 0.85, 'Handover godkjent': 1, Drift: 1 };

function profileFor(i) {
  return {
    has_xwlan: true, has_dot1x: i % 2 === 0, has_print: i % 3 !== 0, has_av: i % 4 === 0,
    has_backup_line: i % 3 === 1, wan_mbps: [100, 250, 500][i % 3], uses_meraki: i % 5 === 0,
    is_shared_location: i % 7 === 6, has_non_standard_equipment: i % 4 === 1, customer_specific: i % 6 === 2
  };
}

function signed(role) { return { by: roleName(role), role, at: NOW }; }

function mk(item, { outcome = 'green', done = true, approved = false, owner = '', due = '', plan = '', result = null, comment = '' } = {}) {
  const st = emptyState();
  st.outcome = outcome; st.owner = owner; st.due = due; st.plan = plan; st.result = result; st.comment = comment;
  if (done) st.done = signed(item.responsible);
  if (approved && item.qa) st.qa = signed(item.qa);
  return st;
}

function resultFor(item, r) {
  if (item.resultKind === 'mbps') return { measured: 90 + Math.round(r() * 10) };
  if (item.resultKind === 'bandwidth') return { ordered: 100, measured: 95 + Math.round(r() * 5) };
  if (item.resultKind === 'network') return { vlan: item.id === 'SAT-10' ? '6' : '2', ip: '10.0.' + Math.round(r() * 200) + '.20', dnsOk: true };
  return null;
}

function generateStates(idx, phase, profile, forceAll) {
  const r = mulberry32(1000 + idx);
  const p = forceAll ? 1 : PROGRESS[phase];
  const states = {};
  catalog.items.filter((i) => i.level === 'location').forEach((item) => {
    if (evalCondition(item.condition, profile) === false) return;
    const owner = roleName(item.responsible);
    if (r() < p) {
      const final = p === 1;
      const x = r();
      if (!final && phase === 'Under utrulling' && x < 0.1) {
        states[item.id] = mk(item, { outcome: 'red', done: false, comment: 'Mangler ved første kontroll' });
      } else if (!final && x < 0.2) {
        const yellow = mk(item, { outcome: 'yellow', owner, due: '2026-12-15', plan: 'Rettes opp i neste driftsvindu', approved: x < 0.15 });
        states[item.id] = yellow;
      } else {
        states[item.id] = mk(item, { approved: final || r() < (phase === 'Under utrulling' ? 0.5 : 0.6), result: resultFor(item, r) });
      }
    } else {
      const assigned = phase === 'Operativ støtteperiode' || r() < 0.7;
      states[item.id] = mk(item, { outcome: 'open', done: false, owner: assigned ? owner : '', due: assigned ? '2026-12-15' : '' });
    }
  });
  return states;
}

// Oslo følger skissene: ett rødt punkt, gule punkter, SAT delvis ferdig.
function osloStates(profile) {
  const c = catalog.byId;
  const s = {};
  const g = (id, o) => { s[id] = mk(c[id], o); };
  g('LOK-01', { approved: true }); g('LOK-02', { outcome: 'red', done: false, comment: '2 av 11 enheter mangler overvåking' });
  g('LOK-03', { approved: true }); g('LOK-04', {}); g('LOK-05', { approved: false });
  g('LOK-06', {}); g('LOK-07', { outcome: 'yellow', approved: true, owner: 'WAN-ansvarlig', due: '2026-11-20', plan: 'Bestille backuplinje', comment: 'Backup-linknet (VLAN 1301) uten linje' });
  g('LOK-08', { approved: true }); g('LOK-09', {}); g('LOK-10', { approved: true });
  g('LOK-13', { outcome: 'open', done: false, owner: 'Tekniker', due: '2026-11-15' });
  g('LOK-14', {}); g('LOK-15', { outcome: 'open', done: false });
  g('LOK-16', { outcome: 'yellow', approved: true, owner: 'Tekniker', due: '2026-11-15', plan: 'Dokumenterer VLAN 5 som avvik' });
  g('LOK-17', { outcome: 'yellow', owner: 'PM', due: '2026-11-15', plan: 'Se oppfølgingspunkter' });
  g('SAT-01', { outcome: 'yellow', owner: 'Tekniker', due: '2026-11-10', plan: 'Merke bildene «før»', comment: '2 bilder, ingen merket «før»' });
  g('SAT-02', { result: { measured: 98 } }); g('SAT-03', {}); g('SAT-04', {});
  g('SAT-05', { result: { ordered: 100, measured: 96 } });
  g('SAT-06', { outcome: 'open', done: false }); g('SAT-07', { outcome: 'open', done: false });
  g('SAT-08', { result: { vlan: '2', ip: '10.10.65.41', dnsOk: true } });
  g('SAT-09', { result: { vlan: '2 og 3', ip: '10.10.65.77', dnsOk: true } });
  g('SAT-10', { outcome: 'open', done: false, owner: 'Tekniker', due: '2026-11-07', comment: 'Kan testes fredag kveld' });
  g('SAT-11', { outcome: 'open', done: false, owner: 'Tekniker', due: '2026-11-07', comment: 'Kan testes fredag kveld' });
  g('SAT-12', { result: null }); g('SAT-15', { outcome: 'open', done: false });
  // fjern punkter som ikke gjelder med profilen
  Object.keys(s).forEach((id) => { if (evalCondition(c[id].condition, profile) === false) delete s[id]; });
  return s;
}

const FOLLOWUPS = {
  '0D': [
    { id: 1, text: 'Avklar og dokumenter backuplinje', owner: 'PM', due: '2026-11-20' },
    { id: 2, text: 'Test dot1x og XWLAN etter fredag kveld', owner: 'Tekniker', due: '2026-11-07' },
    { id: 3, text: 'Dokumenter VLAN 5 som avvik fra standard', owner: 'Tekniker', due: '2026-11-15' }
  ]
};

function build() {
  const locations = LOCATIONS.map(([code, name, phase], idx) => {
    const profile = profileFor(idx);
    let states, facts = {};
    if (code === '0D') {
      Object.assign(profile, { has_xwlan: true, has_dot1x: true, has_print: true, has_av: false, has_backup_line: null, wan_mbps: 100, uses_meraki: null, is_shared_location: false, has_non_standard_equipment: false, customer_specific: false });
      states = osloStates(profile);
      facts['LOK-02'] = { outcome: 'red', detail: '2 av 11 enheter mangler overvåking' };
    } else {
      states = generateStates(idx, phase, profile, code === '0F');
    }
    return { code, name, phase, profile, states, facts, followups: FOLLOWUPS[code] ? FOLLOWUPS[code].map((f) => ({ ...f })) : [] };
  });

  const k = catalog.byId;
  const customerStates = {
    'KUN-01': mk(k['KUN-01']),
    'KUN-02': mk(k['KUN-02'], { outcome: 'yellow', approved: true, owner: 'Prosjektteam', due: '2026-12-01', plan: 'Opprette implementasjon for 2 tjenester', comment: '2 tjenester uten implementasjon i CMDB' }),
    'KUN-04': mk(k['KUN-04'], { approved: true }),
    'KUN-05': mk(k['KUN-05']),
    'KUN-06': mk(k['KUN-06'], { outcome: 'open', done: false }),
    'KUN-07': mk(k['KUN-07'], { outcome: 'open', done: false })
  };

  const impl = [
    ['Tekniske nett', 'documented'], ['Wi-Fi SSID', 'documented'], ['Klient VPN', 'not_applicable'], ['VPN-tunnel', 'partial'],
    ['PAT', 'not_applicable'], ['NAT', 'documented'], ['User-ID', 'missing'], ['Managed Local Firewall', 'not_applicable'],
    ['Azure', 'not_applicable'], ['Shared Network', 'partial']
  ].map(([type, status]) => ({ type, status }));

  return {
    customer: {
      code: 'EK', name: 'Eksempel Kunde AS',
      profile: { is_complex_system: false, large_project: LOCATIONS.length > 8 },
      states: customerStates, impl
    },
    locations
  };
}

module.exports = { build, LOCATIONS };
