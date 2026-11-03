'use strict';

// Minnebasert lager og visninger. Statusreglene ligger i status/engine.js.

const catalog = require('./model/catalog');
const seed = require('./model/seed');
const engine = require('./status/engine');
const providers = require('./providers');

class HttpError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

function createStore() {
  const data = seed.build();
  const config = { bandwidthTolerance: engine.DEFAULTS.bandwidthTolerance };
  const prov = providers.createMockProviders();
  let nextId = 100;

  const getLoc = (code) => {
    const l = data.locations.find((x) => x.code === code);
    if (!l) throw new HttpError(404, 'Fant ikke lokasjonen');
    return l;
  };
  const locEval = (l) => engine.evaluateLocation(catalog.items, l.states, l.profile);
  const actorOf = (role) => {
    if (!catalog.roles.includes(role)) throw new HttpError(400, 'Ukjent rolle');
    return { role, name: catalog.ROLE_LABELS[role] };
  };

  function rowJson(r) {
    const { item, state } = r;
    return {
      id: item.id, title: item.title, level: item.level, phase: item.phase, condition: item.condition,
      responsible: item.responsible, qa: item.qa, source: item.source, verification: item.verification,
      resultKind: item.resultKind, expected: item.expected,
      status: r.status, stage: r.stage, label: r.label, hasPlan: r.hasPlan, conditionUnknown: r.conditionUnknown,
      state
    };
  }

  function needsAction(r, role) {
    return r.item.responsible === role && (r.status === 'open' || r.status === 'red' || (r.status === 'yellow' && r.stage !== 'awaiting_qa' && !r.hasPlan));
  }
  const inQaQueue = (r, role) => r.stage === 'awaiting_qa' && r.item.qa === role;

  function locationSummary(l, role) {
    const ev = locEval(l);
    const ho = engine.handoverLabel(l.phase, ev);
    return {
      code: l.code, name: l.name, phase: l.phase, hap: ev.hap, sat: ev.sat, handover: ho,
      blocksHandover: ev.blocksHandover, awaitingQa: ev.awaitingQa,
      mine: role ? ev.rows.filter((r) => needsAction(r, role)).length : 0,
      qaQueue: role ? ev.rows.filter((r) => inQaQueue(r, role)).length : 0,
      hapCounts: ev.hapCounts, satCounts: ev.satCounts
    };
  }

  function customerView(role) {
    const evs = data.locations.map(locEval);
    const cev = engine.evaluateCustomer(catalog.items, data.customer.states, data.customer.profile, evs);
    const rows = cev.rows.map(rowJson);
    return {
      customer: { code: data.customer.code, name: data.customer.name, profile: data.customer.profile },
      summary: {
        kun: cev.kun, kunCounts: cev.kunCounts, locationsGreen: cev.locationsGreen, locationsTotal: cev.locationsTotal,
        segments: cev.segments, blocked: cev.blocked, canApproveHandover: cev.canApproveHandover,
        // Test-lys for kunden: dårligste lys blant lokasjoner som har startet SAT
        sat: engine.worst(evs.filter((e) => e.satCounts.green + e.satCounts.yellow + e.satCounts.red > 0).map((e) => e.sat))
      },
      kunItems: rows.map((r) => ({ ...r, mine: role && r.responsible === role && ['open', 'red'].includes(r.status), inQaQueue: role && r.stage === 'awaiting_qa' && r.qa === role })),
      implementations: data.customer.impl,
      locations: data.locations.map((l) => locationSummary(l, role)),
      profileFields: catalog.CUSTOMER_PROFILE_FIELDS
    };
  }

  function locationView(code, role) {
    const l = getLoc(code);
    const ev = locEval(l);
    const sum = locationSummary(l, role);
    return {
      location: { code: l.code, name: l.name, phase: l.phase, profile: l.profile },
      summary: sum, blockers: ev.blockers,
      items: ev.rows.map((r) => ({ ...rowJson(r), mine: role ? needsAction(r, role) : false, inQaQueue: role ? inQaQueue(r, role) : false })),
      followups: l.followups,
      profileFields: catalog.PROFILE_FIELDS,
      customer: { code: data.customer.code, name: data.customer.name }
    };
  }

  function meta() {
    return {
      roles: catalog.roles.map((r) => ({ id: r, label: catalog.ROLE_LABELS[r] })),
      sources: catalog.SOURCE_LABELS, phases: ['Planlagt', 'Under utrulling', 'Operativ støtteperiode', 'Handover godkjent', 'Drift'],
      config
    };
  }

  function holder(level, code) {
    return level === 'customer' ? data.customer : getLoc(code);
  }

  function itemAction(level, code, itemId, action, role, body) {
    const item = catalog.byId[itemId];
    if (!item || item.level !== level) throw new HttpError(404, 'Fant ikke punktet');
    const h = holder(level, code);
    const actor = actorOf(role);
    const state = h.states[itemId] || engine.emptyState();
    let ctx = {};
    let applicable = true, canApproveHandover = true;
    if (level === 'location') applicable = engine.evalCondition(item.condition, h.profile) !== false;
    else {
      applicable = engine.evalCondition(item.condition, h.profile) !== false;
      canApproveHandover = engine.evaluateCustomer(catalog.items, h.states, h.profile, data.locations.map(locEval)).canApproveHandover;
    }
    ctx = { applicable, canApproveHandover };
    try {
      let next;
      if (action === 'done') {
        const input = { ...pick(body, ['outcome', 'owner', 'due', 'plan', 'comment', 'result']) };
        if (item.resultKind === 'bandwidth') {
          const r = input.result || {};
          const judged = engine.judgeBandwidth(r.ordered, r.measured, config.bandwidthTolerance);
          if (judged === 'open') throw new engine.RuleError('Fyll inn bestilt og målt hastighet (Mbps)');
          input.outcome = judged;
        }
        next = engine.markDone(item, state, actor, input, ctx);
      } else if (action === 'approve') next = engine.approve(item, state, actor, ctx);
      else if (action === 'reject') next = engine.reject(item, state, actor, body.comment, ctx);
      else if (action === 'assign') {
        next = { ...state, ...pick(body, ['owner', 'due', 'plan']) };
        ['owner', 'due', 'plan'].forEach((k) => { next[k] = String(next[k] || '').slice(0, 200); });
      } else if (action === 'reopen') {
        if (role !== item.responsible && role !== 'pm') throw new engine.RuleError('Bare ansvarlig eller PM kan åpne punktet på nytt');
        next = engine.emptyState();
      } else throw new HttpError(400, 'Ukjent handling');
      h.states[itemId] = next;
    } catch (e) {
      if (e instanceof engine.RuleError) throw new HttpError(400, e.message);
      throw e;
    }
    return level === 'customer' ? customerView(role) : locationView(code, role);
  }

  async function runAutoChecks(code, role) {
    const l = getLoc(code);
    const ctx = { location: { code: l.code, name: l.name, phase: l.phase, profile: l.profile, facts: l.facts }, customer: data.customer };
    let updated = 0;
    for (const item of catalog.items) {
      if (item.level !== 'location' || !providers.isAuto(item)) continue;
      if (engine.evalCondition(item.condition, l.profile) === false) continue;
      const p = prov[item.source];
      if (!p) continue;
      const res = await p.check(item, ctx);
      const prev = l.states[item.id];
      const next = engine.applyAutoResult(item, prev, res);
      if (next !== prev && JSON.stringify(next) !== JSON.stringify(prev)) { l.states[item.id] = next; updated++; }
    }
    return { updated, view: locationView(code, role) };
  }

  function setProfile(level, code, body, role) {
    const h = holder(level, code);
    const fields = level === 'customer' ? catalog.CUSTOMER_PROFILE_FIELDS : catalog.PROFILE_FIELDS;
    for (const f of fields) {
      if (!(f.key in body)) continue;
      const v = body[f.key];
      if (v === null || v === '') h.profile[f.key] = null;
      else if (f.type === 'bool') h.profile[f.key] = v === true || v === 'true';
      else { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Ugyldig tall'); h.profile[f.key] = n; }
    }
    return level === 'customer' ? customerView(role) : locationView(code, role);
  }

  function addFollowup(code, body, role) {
    const l = getLoc(code);
    const text = String(body.text || '').trim();
    if (!text) throw new HttpError(400, 'Tekst mangler');
    l.followups.push({ id: ++nextId, text: text.slice(0, 300), owner: String(body.owner || '').slice(0, 60), due: String(body.due || '').slice(0, 20) });
    return locationView(code, role);
  }

  function removeFollowup(code, id, role) {
    const l = getLoc(code);
    l.followups = l.followups.filter((f) => f.id !== Number(id));
    return locationView(code, role);
  }

  function setConfig(body) {
    const t = Number(body.bandwidthTolerance);
    if (!(t >= 0 && t <= 0.5)) throw new HttpError(400, 'Toleranse må være mellom 0 og 0,5');
    config.bandwidthTolerance = t;
    return config;
  }

  return { meta, customerView, locationView, itemAction, runAutoChecks, setProfile, addFollowup, removeFollowup, setConfig, HttpError };
}

function pick(o, keys) {
  const out = {};
  keys.forEach((k) => { if (o && o[k] !== undefined) out[k] = o[k]; });
  return out;
}

module.exports = { createStore, HttpError };
