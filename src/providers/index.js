'use strict';

// CheckProvider: grensesnitt for kilder som kan sjekke punkter merket «auto» i katalogen.
// I v1 finnes bare mock-implementasjoner. En ekte kilde implementerer samme metode,
// og UI og statuslogikk trenger ikke endres.
//
//   check(item, ctx) -> Promise<null | { outcome: 'green'|'yellow'|'red'|'open', detail?: string, result?: any }>
//
// ctx: { location: { code, name, phase, profile, facts }, customer }

const SOURCES = ['monitoring', 'netbox', 'cmdb', 'rot', 'npc', 'company_service', 'publish'];

class CheckProvider {
  constructor(source) { this.source = source; }
  // eslint-disable-next-line no-unused-vars
  async check(item, ctx) { throw new Error('check() må implementeres'); }
}

// Mock: bruker faste «fakta» per lokasjon (ctx.location.facts[itemId]) hvis de finnes.
// Uten fakta svarer den grønt for lokasjoner som er i gang, og åpent for planlagte. Ingen ekte kall.
class MockProvider extends CheckProvider {
  async check(item, ctx) {
    const fact = ctx.location.facts && ctx.location.facts[item.id];
    if (fact) return { outcome: fact.outcome, detail: fact.detail };
    if (ctx.location.phase === 'Planlagt') return { outcome: 'open', detail: 'Ingen data ennå (mock)' };
    return { outcome: 'green', detail: `Sjekket mot ${this.source} (mock)` };
  }
}

function createMockProviders() {
  return Object.fromEntries(SOURCES.map((s) => [s, new MockProvider(s)]));
}

function isAuto(item) {
  return item.verification === 'auto' || item.verification === 'auto_plus_manual_qa';
}

module.exports = { CheckProvider, MockProvider, createMockProviders, isAuto, SOURCES };
