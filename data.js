'use strict';

// Eksempeldata fra skissene. Status: g = OK, y = delvis, r = mangler, o = åpen, n = ikke aktuell.
const LABELS = { g: 'OK', y: 'Delvis', r: 'Mangler', o: 'Åpen', n: 'Ikke aktuell', q: 'Venter QA' };

const customer = {
  code: 'EK',
  name: 'Eksempel Kunde AS',
  kun: [
    { id: 'KUN-01', title: 'Kundepublish «Nettverksoppsett | Kundenavn [Kundekode]»', detail: 'Finnes og lenker til implementasjoner', status: 'g' },
    { id: 'KUN-02', title: 'Alle tjenester dokumentert, implementasjon per tjeneste', detail: '2 tjenester uten implementasjon i CMDB', status: 'y' },
    { id: 'KUN-03', title: 'HLD ved komplekse systemer', detail: 'Ingen komplekse systemer registrert', status: 'n' },
    { id: 'KUN-04', title: 'Fakturagrunnlag oppdatert (NPC)', detail: 'QA godkjent av PM', status: 'g' },
    { id: 'KUN-05', title: 'Kontaktmatrise, ansvarsfordeling og kritiske tjenester', detail: 'Manuell bekreftelse av PM', status: 'g' },
    { id: 'KUN-06', title: 'Intern informasjon sendt (e-post / allmøte)', detail: 'Etter go-live, PM ansvarlig', status: 'o' },
    { id: 'KUN-07', title: 'HAP godkjent', detail: 'Låst til alle krav er OK eller gule med plan', status: 'o' }
  ],
  impl: [
    { name: 'Tekniske nett', status: 'g', label: 'Dokumentert' },
    { name: 'Wi-Fi SSID', status: 'g', label: 'Dokumentert' },
    { name: 'Klient VPN', status: 'n' },
    { name: 'VPN-tunnel', status: 'y' },
    { name: 'PAT', status: 'n' },
    { name: 'NAT', status: 'g', label: 'Dokumentert' },
    { name: 'User-ID', status: 'r' },
    { name: 'Managed Local Firewall', status: 'n' },
    { name: 'Azure', status: 'n' },
    { name: 'Shared Network', status: 'y' }
  ]
};

const locations = [
  { code: '0D', name: 'Oslo | Hovedkontor', address: 'Eksempelveien 1, 0000 Oslo', phase: 'Under utrulling', sat: 'y', hap: 'r', handover: 'Blokkert (1 rødt punkt)' },
  { code: '0E', name: 'Bergen | Kontor', phase: 'Operativ støtteperiode', sat: 'g', hap: 'y', handover: 'Venter på QA' },
  { code: '0F', name: 'Trondheim | Kontor', phase: 'Operativ støtteperiode', sat: 'g', hap: 'g', handover: 'Klar for godkjenning' },
  { code: '0G', name: 'Stavanger | Kontor', phase: 'Under utrulling', sat: 'o', hap: 'o', handover: 'Ikke startet' },
  { code: '0H', name: 'Tromsø | Kontor', phase: 'Planlagt', sat: 'o', hap: 'o', handover: 'Ikke startet' },
  { code: '0J', name: 'Kristiansand | Kontor', phase: 'Drift', sat: 'g', hap: 'g', handover: 'Godkjent' },
  { code: '0K', name: 'Drammen | Kontor', phase: 'Handover godkjent', sat: 'g', hap: 'g', handover: 'Godkjent' }
];

// Punkter for Oslo (0D). qa = hvem som må godkjenne før punktet er OK (null = ingen QA).
const items = {
  '0D': [
    { id: 'LOK-02', title: 'Utstyr i overvåkning (Orion/DNAC)', detail: '2 av 11 enheter mangler', status: 'r', who: 'Tekniker', qa: null, src: 'Automatisk' },
    { id: 'LOK-13', title: 'Sec Policy aktiv og fungerer', detail: 'Venter på signoff fra tekniker', status: 'o', who: 'Tekniker', qa: null, src: 'Manuell · signoff' },
    { id: 'LOK-05', title: 'Bilder lastet opp og merket i ROT', detail: 'Utført av tekniker, venter på QA', status: 'q', who: 'Tekniker', qa: 'PM', src: 'Auto + manuell QA', signedBy: 'Tekniker' },
    { id: 'LOK-07', title: 'Linjer dokumentert (inkl. backup)', detail: 'Backup-linknet (VLAN 1301) uten linje', status: 'y', who: 'WAN-ansvarlig', qa: 'PM', src: 'Manuell' },
    { id: 'LOK-16', title: 'Avvik fra standard dokumentert', detail: 'VLAN 5 er ikke standard-VLAN', status: 'y', who: 'Tekniker', qa: 'PM', src: 'Manuell' },
    { id: 'LOK-12', title: 'HSEC-lisens aktivert', detail: 'Gjelder kun WAN > 200 Mbps', status: 'n', who: 'Tekniker', qa: null, src: 'Automatisk · betinget' },
    { id: 'LOK-10', title: 'Service cards og billing company i NPC', detail: '3 aktive service cards', status: 'g', who: 'PM', qa: null, src: 'Automatisk' }
  ]
};

const profiles = {
  '0D': [
    { name: 'Wi-Fi / XWLAN', status: 'g', label: 'Aktiv', source: 'SSID-widget: EK-XWLAN finnes' },
    { name: 'dot1x', status: 'g', label: 'Aktiv', source: 'SSID med Client Authentication' },
    { name: 'Print', status: 'g', label: 'Aktiv', source: 'Workplace Assets: 2 printere' },
    { name: 'AV-teknisk', status: 'n', label: 'Ikke aktiv', source: 'Ingen AV-enheter i inventar' },
    { name: 'Backuplinje', status: 'y', label: 'Uavklart', source: 'Backup-linknet finnes, 1 WAN-linje' },
    { name: 'WAN over 200 Mbps (HSEC)', status: 'n', label: 'Nei', source: 'WAN Circuits og SAT-05' },
    { name: 'Meraki', status: 'o', label: 'Åpen', source: 'Må bekreftes av tekniker' },
    { name: 'Shared location', status: 'n', label: 'Nei', source: 'Lokasjonsnavn uten «Shared location»' }
  ]
};

const sat = {
  '0D': [
    { id: 'SAT-01', test: 'Bilde av skap før nedrigg', expected: 'Minst 1 bilde merket «før»', result: '2 bilder, ingen merket «før»', status: 'y', how: 'Automatisk' },
    { id: 'SAT-03', test: 'Ruter, switcher og AP på nett', expected: '11 enheter', result: '11 av 11 online', status: 'g', how: 'Automatisk' },
    { id: 'SAT-04', test: 'Kjernesystemer og kritiske SaaS-apper testet', expected: 'Liste fra kunde', result: 'Alle testet', status: 'g', how: 'Tekniker' },
    { id: 'SAT-05', test: 'WAN primær, bandbredde', expected: 'Bestilt hastighet [Mbps]', result: '[Mbps] målt', status: 'g', how: 'Automatisk mot bestilt' },
    { id: 'SAT-06', test: 'WAN sekundær, bandbredde', expected: 'Gjelder hvis backuplinje', result: '', status: 'o', how: 'Avventer avklaring' },
    { id: 'SAT-07', test: 'Failover (trekk primærlinje)', expected: 'Trafikk over backup', result: '', status: 'o', how: 'Avventer avklaring' },
    { id: 'SAT-08', test: 'LAN via kabel: IP, DNS og VLAN', expected: 'VLAN 2', result: 'IP i prod-nettet, VLAN 2, DNS OK', status: 'g', how: 'Tekniker' },
    { id: 'SAT-09', test: 'Wi-Fi produksjon: IP, DNS og VLAN', expected: 'VLAN 2 og 3', result: 'VLAN 2 OK · VLAN 3 OK', status: 'g', how: 'Tekniker' },
    { id: 'SAT-10', test: 'XWLAN-enhet i VLAN 6', expected: 'VLAN 6', result: '', status: 'o', how: 'Tekniker' },
    { id: 'SAT-11', test: 'dot1x negativ test', expected: 'Klient i VLAN 3', result: '', status: 'o', how: 'Tekniker' },
    { id: 'SAT-12', test: 'Printere online, IP i VLAN 8', expected: '2 printere', result: '2 av 2 online', status: 'g', how: 'Tekniker' },
    { id: 'SAT-13', test: 'AV-utstyr online', expected: 'Gjelder hvis AV-teknisk', result: 'Ikke aktuell', status: 'n', how: 'Fra testprofil' }
  ]
};

const followups = {
  '0D': [
    { id: 1, text: 'Avklar og dokumenter backuplinje', owner: 'PM', due: '' },
    { id: 2, text: 'Test dot1x og XWLAN etter fredag kveld', owner: 'Tekniker', due: '' },
    { id: 3, text: 'Dokumenter VLAN 5 som avvik fra standard', owner: 'Tekniker', due: '' }
  ]
};

module.exports = { LABELS, customer, locations, items, profiles, sat, followups };
