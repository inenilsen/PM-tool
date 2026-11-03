'use strict';

// Sjekkpunktkatalogen. docs/checklist.seed.json er fasit for innholdet.
const seed = require('../../docs/checklist.seed.json');

const ROLE_LABELS = {
  tekniker: 'Tekniker', pm: 'PM', wan_ansvarlig: 'WAN-ansvarlig', tech_lead: 'Tech lead', olm_pm: 'OLM PM', prosjektteam: 'Prosjektteam'
};

const SOURCE_LABELS = {
  monitoring: 'Overvåking', netbox: 'Netbox', company_service: 'Company Service', rot: 'ROT', cmdb: 'CMDB',
  npc: 'NPC', publish: 'Publish', router: 'Ruter', app: 'Manuelt'
};

// Typede resultatfelt for SAT-punkter (SPEC: «typede resultatfelt»).
//  mbps: målt hastighet. bandwidth: bestilt og målt, vurderes automatisk. network: IP, VLAN og DNS.
const RESULT_KINDS = {
  'SAT-02': 'mbps', 'SAT-05': 'bandwidth', 'SAT-06': 'bandwidth',
  'SAT-08': 'network', 'SAT-09': 'network', 'SAT-10': 'network'
};

// Forventet verdi per SAT-punkt (visningstekst).
const SAT_EXPECTED = {
  'SAT-01': 'Minst 1 bilde merket «før»', 'SAT-02': 'Målt mot ISP-modem', 'SAT-03': 'Alle enheter online',
  'SAT-04': 'Liste fra kunde', 'SAT-05': 'Bestilt hastighet', 'SAT-06': 'Gjelder hvis backuplinje',
  'SAT-07': 'Trafikk over backup', 'SAT-08': 'VLAN 2', 'SAT-09': 'VLAN 2 og 3', 'SAT-10': 'VLAN 6',
  'SAT-11': 'Klient i VLAN 3', 'SAT-12': 'IP i VLAN 8', 'SAT-13': 'IP i VLAN 7',
  'SAT-14': 'Etter kundens liste', 'SAT-15': 'Ryddet'
};

// Rekkefølgen i testprofilen. «null» betyr at feltet ikke er avklart ennå (punktene forblir åpne).
const PROFILE_FIELDS = [
  { key: 'has_xwlan', label: 'Wi-Fi / XWLAN', type: 'bool' },
  { key: 'has_dot1x', label: 'dot1x', type: 'bool' },
  { key: 'has_print', label: 'Print', type: 'bool' },
  { key: 'has_av', label: 'AV-teknisk', type: 'bool' },
  { key: 'has_backup_line', label: 'Backuplinje', type: 'bool' },
  { key: 'wan_mbps', label: 'WAN (Mbps)', type: 'number' },
  { key: 'uses_meraki', label: 'Meraki', type: 'bool' },
  { key: 'is_shared_location', label: 'Shared location', type: 'bool' },
  { key: 'has_non_standard_equipment', label: 'Utstyr utover standard', type: 'bool' },
  { key: 'customer_specific', label: 'Kundespesifikke tester', type: 'bool' }
];

const CUSTOMER_PROFILE_FIELDS = [
  { key: 'is_complex_system', label: 'Komplekst system (HLD)', type: 'bool' },
  { key: 'large_project', label: 'Større prosjekt', type: 'bool' }
];

const items = seed.items.map((i) => ({ ...i, resultKind: RESULT_KINDS[i.id] || null, expected: SAT_EXPECTED[i.id] || null }));

const byId = Object.fromEntries(items.map((i) => [i.id, i]));

module.exports = {
  items, byId, roles: seed.roles, phases: seed.phases, implementationTypes: seed.implementation_types,
  ROLE_LABELS, SOURCE_LABELS, PROFILE_FIELDS, CUSTOMER_PROFILE_FIELDS
};
