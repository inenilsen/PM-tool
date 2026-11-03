'use strict';

// Statusmotor. Rene funksjoner uten I/O, slik at reglene i docs/SPEC.md kan testes og flyttes.
//
// Statuser: open (ikke vurdert), green, yellow, red, not_applicable.
// Et punkt med QA-rolle følger flyten: åpen -> utført -> venter QA -> grønn.
// «Venter QA» er et stadium (stage = awaiting_qa) som teller som gult i aggregeringen.

const STATUS = { OPEN: 'open', GREEN: 'green', YELLOW: 'yellow', RED: 'red', NA: 'not_applicable' };

const LABELS = {
  open: 'Åpen', green: 'OK', yellow: 'Delvis', red: 'Mangler', not_applicable: 'Ikke aktuell', awaiting_qa: 'Venter QA'
};

// Rekkefølge fra dårligst til best. Åpen teller ikke som rød (SPEC), men er dårligere enn grønn.
// Endres her hvis det åpne spørsmålet om åpne punkter avgjøres annerledes.
const SEVERITY = [STATUS.RED, STATUS.YELLOW, STATUS.OPEN, STATUS.GREEN];

const DEFAULTS = { bandwidthTolerance: 0.1 };

class RuleError extends Error {}

function emptyState() {
  return { outcome: STATUS.OPEN, done: null, qa: null, rejected: null, result: null, owner: '', due: '', plan: '', comment: '' };
}

// ---------- Betingelser ----------

// Returnerer true (oppfylt), false (ikke oppfylt) eller null (ukjent: profilfeltet er ikke satt ennå).
function evalCondition(condition, profile) {
  if (!condition) return true;
  const cmp = /^([a-z_]+)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/.exec(condition.trim());
  if (cmp) {
    const v = profile ? profile[cmp[1]] : undefined;
    if (v == null) return null;
    const n = Number(cmp[3]);
    return { '>': v > n, '>=': v >= n, '<': v < n, '<=': v <= n }[cmp[2]];
  }
  const v = profile ? profile[condition.trim()] : undefined;
  return v == null ? null : Boolean(v);
}

// ---------- Punktstatus ----------

function hasPlan(state) {
  return Boolean(state.owner && state.due && state.plan);
}

function itemStatus(item, state, profile) {
  state = state || emptyState();
  const cond = evalCondition(item.condition, profile);
  const base = { id: item.id, hasPlan: hasPlan(state), conditionUnknown: cond === null };
  if (cond === false) return { ...base, status: STATUS.NA, stage: 'not_applicable', label: LABELS.not_applicable };

  if (item.qa) {
    if (state.qa) return { ...base, status: state.outcome === STATUS.OPEN ? STATUS.GREEN : state.outcome, stage: 'approved', label: LABELS[state.outcome === STATUS.OPEN ? 'green' : state.outcome] };
    if (state.done && state.outcome !== STATUS.RED) return { ...base, status: STATUS.YELLOW, stage: 'awaiting_qa', label: LABELS.awaiting_qa };
  }
  const status = state.done && state.outcome === STATUS.OPEN ? STATUS.GREEN : state.outcome;
  return { ...base, status, stage: status === STATUS.OPEN ? 'open' : 'registered', label: LABELS[status] };
}

// ---------- Aggregering ----------

function worst(statuses) {
  const list = statuses.filter((s) => s !== STATUS.NA);
  if (!list.length) return STATUS.NA;
  for (const s of SEVERITY) if (list.includes(s)) return s;
  return STATUS.OPEN;
}

function count(list) {
  const c = { green: 0, yellow: 0, red: 0, open: 0, not_applicable: 0, awaiting_qa: 0 };
  list.forEach((i) => { c[i.status]++; if (i.stage === 'awaiting_qa') c.awaiting_qa++; });
  return c;
}

function isOkOrPlanned(r) {
  return r.status === STATUS.GREEN || r.status === STATUS.NA || (r.status === STATUS.YELLOW && r.stage !== 'awaiting_qa' && r.hasPlan);
}

// catalog: katalogpunkter. states: { [itemId]: state }. profile: testprofil.
function evaluateLocation(catalog, states, profile) {
  const rows = catalog.filter((i) => i.level === 'location').map((item) => {
    const state = states[item.id] || emptyState();
    return { item, state, ...itemStatus(item, state, profile) };
  });
  const hapRows = rows.filter((r) => r.item.phase !== 'sat');
  const satRows = rows.filter((r) => r.item.phase === 'sat');
  const hapCounts = count(hapRows), satCounts = count(satRows);
  const started = rows.some((r) => r.status !== STATUS.OPEN && r.status !== STATUS.NA);
  const reds = rows.filter((r) => r.status === STATUS.RED);
  const openNoOwner = started ? hapRows.filter((r) => r.status === STATUS.OPEN && !r.state.owner && !r.state.due) : [];
  const blockers = { red: reds.length, openWithoutPlan: openNoOwner.length };
  return {
    rows,
    hap: worst(hapRows.map((r) => r.status)),
    sat: worst(satRows.map((r) => r.status)),
    hapCounts, satCounts, started, blockers,
    blocksHandover: blockers.red + blockers.openWithoutPlan > 0,
    allReady: hapRows.every(isOkOrPlanned),
    awaitingQa: rows.filter((r) => r.stage === 'awaiting_qa').length
  };
}

const FINAL_PHASES = ['Handover godkjent', 'Drift'];

// Teksten i kolonnen «Handover» i lokasjonstabellen. Fase påvirker tolkningen: rødt under utrulling
// er forventet, rødt ved handover er en blokkering.
function handoverLabel(phase, ev) {
  if (FINAL_PHASES.includes(phase)) return { key: 'approved', label: 'Godkjent' };
  if (!ev.started) return { key: 'not_started', label: 'Ikke startet' };
  if (ev.blocksHandover) {
    const n = ev.blockers.red + ev.blockers.openWithoutPlan;
    const why = ev.blockers.red ? (ev.blockers.red > 1 ? `${ev.blockers.red} røde punkter` : '1 rødt punkt') : `${ev.blockers.openWithoutPlan} åpne uten ansvarlig/frist`;
    return { key: 'blocked', label: `Blokkert (${why})`, count: n };
  }
  if (ev.awaitingQa) return { key: 'awaiting_qa', label: 'Venter på QA' };
  if (ev.allReady) return { key: 'ready', label: 'Klar for godkjenning' };
  return { key: 'in_progress', label: 'Pågår' };
}

// customer: { catalog, states, profile }. locations: [{ phase, evaluation }].
function evaluateCustomer(catalog, states, profile, locEvals) {
  const rows = catalog.filter((i) => i.level === 'customer').map((item) => {
    const state = states[item.id] || emptyState();
    return { item, state, ...itemStatus(item, state, profile) };
  });
  const kun = worst(rows.map((r) => r.status));
  const segments = { green: 0, yellow: 0, red: 0, open: 0, not_applicable: 0 };
  locEvals.forEach((e) => { segments[e.hap]++; });
  const others = rows.filter((r) => r.item.id !== 'KUN-07');
  const kunReady = others.every(isOkOrPlanned);
  const locsReady = locEvals.every((e) => e.allReady);
  return {
    rows, kun, kunCounts: count(rows),
    locationsGreen: segments.green, locationsTotal: locEvals.length, segments,
    blocked: locEvals.filter((e) => e.blocksHandover).length,
    // KUN-07 kan bare settes når alle andre krav er grønne eller gule med plan.
    canApproveHandover: kunReady && locsReady
  };
}

// ---------- SAT-bandbredde ----------

function judgeBandwidth(ordered, measured, tolerance = DEFAULTS.bandwidthTolerance) {
  if (measured === '' || measured == null) return STATUS.OPEN;
  const o = Number(ordered), m = Number(measured);
  if (!(o > 0) || !Number.isFinite(m)) return STATUS.OPEN;
  return m >= o * (1 - tolerance) ? STATUS.GREEN : STATUS.RED;
}

// ---------- Overganger (signoff) ----------

function copy(state) { return { ...emptyState(), ...state }; }

// actor: { role, name }. Bare ansvarlig rolle kan markere utført.
function markDone(item, state, actor, input = {}, ctx = {}) {
  const st = copy(state);
  if (ctx.applicable === false) throw new RuleError('Punktet er ikke aktuelt for denne lokasjonen');
  if (actor.role !== item.responsible) throw new RuleError(`Bare rollen ${item.responsible} kan markere dette punktet som utført`);
  if (item.id === 'KUN-07' && !ctx.canApproveHandover) throw new RuleError('KUN-07 kan bare settes når alle andre krav er grønne eller gule med plan');
  const outcome = input.outcome || STATUS.GREEN;
  if (![STATUS.GREEN, STATUS.YELLOW, STATUS.RED].includes(outcome)) throw new RuleError('Ugyldig resultat');
  if (outcome === STATUS.YELLOW) {
    const owner = input.owner || st.owner, due = input.due || st.due, plan = input.plan || st.plan;
    if (!owner || !due || !plan) throw new RuleError('Gult krever ansvarlig, frist og plan');
    Object.assign(st, { owner, due, plan });
  }
  st.outcome = outcome;
  st.done = { by: actor.name || actor.role, role: actor.role, at: ctx.now || new Date().toISOString() };
  st.qa = null; st.rejected = null;
  if (input.result !== undefined) st.result = input.result;
  if (input.comment !== undefined) st.comment = String(input.comment).slice(0, 500);
  return st;
}

function approve(item, state, actor, ctx = {}) {
  const st = copy(state);
  if (!item.qa) throw new RuleError('Punktet har ingen QA-rolle');
  if (!st.done || st.outcome === STATUS.RED) throw new RuleError('Punktet venter ikke på QA');
  if (st.qa) throw new RuleError('Punktet er allerede godkjent');
  if (actor.role !== item.qa) throw new RuleError(`Bare rollen ${item.qa} kan godkjenne (QA)`);
  st.qa = { by: actor.name || actor.role, role: actor.role, at: ctx.now || new Date().toISOString() };
  return st;
}

function reject(item, state, actor, comment, ctx = {}) {
  const st = copy(state);
  if (!item.qa) throw new RuleError('Punktet har ingen QA-rolle');
  if (!st.done || st.qa) throw new RuleError('Punktet venter ikke på QA');
  if (actor.role !== item.qa) throw new RuleError(`Bare rollen ${item.qa} kan avvise (QA)`);
  const text = String(comment || '').trim();
  if (!text) throw new RuleError('Kommentar er påkrevd ved avvisning');
  st.rejected = { by: actor.name || actor.role, at: ctx.now || new Date().toISOString(), comment: text.slice(0, 500) };
  st.done = null; st.outcome = STATUS.OPEN; st.comment = text.slice(0, 500);
  return st;
}

// Resultat fra en automatisk sjekk. Grønt på et punkt med QA går til «venter QA» (utført av systemet).
function applyAutoResult(item, state, res, ctx = {}) {
  const st = copy(state);
  if (st.qa) return st; // allerede godkjent: ikke overstyr
  if (!res || res.outcome === STATUS.OPEN) return st;
  st.outcome = res.outcome;
  if (res.result !== undefined) st.result = res.result;
  if (res.detail) st.comment = res.detail;
  if (res.outcome === STATUS.GREEN) st.done = { by: 'system', role: 'system', at: ctx.now || new Date().toISOString() };
  else st.done = null;
  return st;
}

module.exports = {
  STATUS, LABELS, SEVERITY, DEFAULTS, FINAL_PHASES, RuleError,
  emptyState, evalCondition, itemStatus, worst, evaluateLocation, evaluateCustomer, handoverLabel,
  judgeBandwidth, markDone, approve, reject, applyAutoResult, isOkOrPlanned
};
