'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const e = require('./engine');

const item = (o) => ({ id: 'LOK-X', level: 'location', phase: 'handover', condition: null, responsible: 'tekniker', qa: null, ...o });
const tek = { role: 'tekniker', name: 'Tekniker' };
const pm = { role: 'pm', name: 'PM' };

test('betingelser: bool, sammenligning og ukjent', () => {
  assert.equal(e.evalCondition(null, {}), true);
  assert.equal(e.evalCondition('has_print', { has_print: true }), true);
  assert.equal(e.evalCondition('has_print', { has_print: false }), false);
  assert.equal(e.evalCondition('has_print', {}), null);
  assert.equal(e.evalCondition('wan_mbps>200', { wan_mbps: 500 }), true);
  assert.equal(e.evalCondition('wan_mbps>200', { wan_mbps: 200 }), false);
  assert.equal(e.evalCondition('wan_mbps>200', { wan_mbps: null }), null);
});

test('punkt med uoppfylt betingelse blir grått, ukjent betingelse forblir åpen', () => {
  const it = item({ condition: 'has_av' });
  assert.equal(e.itemStatus(it, null, { has_av: false }).status, 'not_applicable');
  const unknown = e.itemStatus(it, null, {});
  assert.equal(unknown.status, 'open');
  assert.equal(unknown.conditionUnknown, true);
});

test('punkt uten QA går rett fra utført til grønn', () => {
  const it = item();
  const st = e.markDone(it, null, tek);
  assert.equal(e.itemStatus(it, st, {}).status, 'green');
  assert.equal(st.done.by, 'Tekniker');
  assert.ok(st.done.at);
});

test('QA-flyt: åpen -> venter QA -> grønn, og hvem/når lagres', () => {
  const it = item({ qa: 'pm' });
  assert.equal(e.itemStatus(it, null, {}).stage, 'open');
  const done = e.markDone(it, null, tek);
  const waiting = e.itemStatus(it, done, {});
  assert.equal(waiting.stage, 'awaiting_qa');
  assert.equal(waiting.label, 'Venter QA');
  const ok = e.approve(it, done, pm);
  assert.equal(e.itemStatus(it, ok, {}).status, 'green');
  assert.equal(ok.qa.by, 'PM');
});

test('QA kan avvise, men bare med kommentar', () => {
  const it = item({ qa: 'pm' });
  const done = e.markDone(it, null, tek);
  assert.throws(() => e.reject(it, done, pm, '  '), e.RuleError);
  const back = e.reject(it, done, pm, 'Bildene mangler merking');
  assert.equal(e.itemStatus(it, back, {}).status, 'open');
  assert.equal(back.rejected.comment, 'Bildene mangler merking');
});

test('roller: bare ansvarlig utfører og bare QA godkjenner', () => {
  const it = item({ qa: 'pm' });
  assert.throws(() => e.markDone(it, null, pm), e.RuleError);
  const done = e.markDone(it, null, tek);
  assert.throws(() => e.approve(it, done, tek), e.RuleError);
  assert.throws(() => e.approve(it, e.emptyState(), pm), e.RuleError);
});

test('gult krever ansvarlig, frist og plan', () => {
  const it = item();
  assert.throws(() => e.markDone(it, null, tek, { outcome: 'yellow' }), e.RuleError);
  const st = e.markDone(it, null, tek, { outcome: 'yellow', owner: 'Kari', due: '2026-12-01', plan: 'Bestiller linje' });
  const r = e.itemStatus(it, st, {});
  assert.equal(r.status, 'yellow');
  assert.equal(r.hasPlan, true);
  assert.equal(e.isOkOrPlanned(r), true);
});

test('rødt resultat går ikke til QA', () => {
  const it = item({ qa: 'pm' });
  const st = e.markDone(it, null, tek, { outcome: 'red' });
  assert.equal(e.itemStatus(it, st, {}).status, 'red');
  assert.throws(() => e.approve(it, st, pm), e.RuleError);
});

test('aggregering: dårligste farge, grå ignoreres, åpen er ikke rød', () => {
  assert.equal(e.worst(['green', 'yellow', 'red']), 'red');
  assert.equal(e.worst(['green', 'not_applicable', 'yellow']), 'yellow');
  assert.equal(e.worst(['green', 'open']), 'open');
  assert.equal(e.worst(['open', 'yellow']), 'yellow');
  assert.equal(e.worst(['not_applicable']), 'not_applicable');
  assert.equal(e.worst(['green', 'not_applicable']), 'green');
});

const catalog = [
  item({ id: 'LOK-A' }), item({ id: 'LOK-B', qa: 'pm' }), item({ id: 'LOK-C', condition: 'has_av' }),
  item({ id: 'SAT-A', phase: 'sat' }), item({ id: 'SAT-B', phase: 'sat', condition: 'has_backup_line' })
];

test('lokasjon: Dok- og Test-lys beregnes hver for seg', () => {
  const states = {
    'LOK-A': e.markDone(catalog[0], null, tek),
    'LOK-B': e.markDone(catalog[1], null, tek, { outcome: 'red' }),
    'SAT-A': e.markDone(catalog[3], null, tek)
  };
  const ev = e.evaluateLocation(catalog, states, { has_av: false, has_backup_line: false });
  assert.equal(ev.hap, 'red');
  assert.equal(ev.sat, 'green');
  assert.equal(ev.rows.find((r) => r.item.id === 'LOK-C').status, 'not_applicable');
});

test('handover blokkeres av rødt punkt, og av åpne punkter uten ansvarlig og frist når arbeidet er i gang', () => {
  const none = e.evaluateLocation(catalog, {}, { has_av: false });
  assert.equal(none.started, false);
  assert.equal(none.blocksHandover, false);
  assert.equal(e.handoverLabel('Planlagt', none).key, 'not_started');

  const started = { 'LOK-A': e.markDone(catalog[0], null, tek) };
  const open = e.evaluateLocation(catalog, started, { has_av: false });
  assert.equal(open.blockers.openWithoutPlan, 1);
  assert.equal(open.blocksHandover, true);

  const withOwner = { ...started, 'LOK-B': { ...e.emptyState(), owner: 'Kari', due: '2026-12-01' } };
  assert.equal(e.evaluateLocation(catalog, withOwner, { has_av: false }).blocksHandover, false);

  const red = { 'LOK-A': e.markDone(catalog[0], null, tek, { outcome: 'red' }) };
  const evRed = e.evaluateLocation(catalog, red, { has_av: false });
  assert.equal(evRed.blockers.red, 1);
  assert.match(e.handoverLabel('Under utrulling', evRed).label, /Blokkert \(1 rødt punkt\)/);
});

test('handover: godkjent fase, venter QA og klar for godkjenning', () => {
  const doneA = e.markDone(catalog[0], null, tek);
  const doneB = e.markDone(catalog[1], null, tek);
  const waiting = e.evaluateLocation(catalog, { 'LOK-A': doneA, 'LOK-B': doneB }, { has_av: false });
  assert.equal(e.handoverLabel('Operativ støtteperiode', waiting).key, 'awaiting_qa');
  const ready = e.evaluateLocation(catalog, { 'LOK-A': doneA, 'LOK-B': e.approve(catalog[1], doneB, pm) }, { has_av: false });
  assert.equal(e.handoverLabel('Operativ støtteperiode', ready).key, 'ready');
  assert.equal(e.handoverLabel('Drift', waiting).key, 'approved');
});

test('kunde: andel grønne lokasjoner, segmenter og KUN-07-lås', () => {
  const cust = [item({ id: 'KUN-01', level: 'customer', responsible: 'pm' }), item({ id: 'KUN-07', level: 'customer', responsible: 'olm_pm' })];
  const green = e.evaluateLocation(catalog, {
    'LOK-A': e.markDone(catalog[0], null, tek),
    'LOK-B': e.approve(catalog[1], e.markDone(catalog[1], null, tek), pm),
    'SAT-A': e.markDone(catalog[3], null, tek)
  }, { has_av: false, has_backup_line: false });
  const red = e.evaluateLocation(catalog, { 'LOK-A': e.markDone(catalog[0], null, tek, { outcome: 'red' }) }, { has_av: false });
  const ev = e.evaluateCustomer(cust.concat(), {}, {}, [green, red]);
  assert.equal(ev.locationsGreen, 1);
  assert.equal(ev.locationsTotal, 2);
  assert.equal(ev.segments.red, 1);
  assert.equal(ev.blocked, 1);
  assert.equal(ev.canApproveHandover, false);

  const kunDone = { 'KUN-01': e.markDone(cust[0], null, { role: 'pm', name: 'PM' }) };
  assert.equal(e.evaluateCustomer(cust, kunDone, {}, [green]).canApproveHandover, true);
  assert.throws(() => e.markDone(cust[1], null, { role: 'olm_pm', name: 'x' }, {}, { canApproveHandover: false }), e.RuleError);
  assert.doesNotThrow(() => e.markDone(cust[1], null, { role: 'olm_pm', name: 'x' }, {}, { canApproveHandover: true }));
});

test('SAT-bandbredde vurderes mot bestilt hastighet med konfigurerbar toleranse', () => {
  assert.equal(e.judgeBandwidth(100, 96), 'green');
  assert.equal(e.judgeBandwidth(100, 90), 'green');
  assert.equal(e.judgeBandwidth(100, 89), 'red');
  assert.equal(e.judgeBandwidth(100, 80, 0.25), 'green');
  assert.equal(e.judgeBandwidth(100, ''), 'open');
  assert.equal(e.judgeBandwidth(0, 50), 'open');
});

test('automatisk resultat: grønt med QA venter QA, rødt settes uten utført', () => {
  const qaItem = item({ qa: 'pm' });
  const green = e.applyAutoResult(qaItem, null, { outcome: 'green' });
  assert.equal(e.itemStatus(qaItem, green, {}).stage, 'awaiting_qa');
  const red = e.applyAutoResult(item(), null, { outcome: 'red', detail: '2 av 11 mangler' });
  assert.equal(e.itemStatus(item(), red, {}).status, 'red');
  const approved = e.approve(qaItem, green, pm);
  assert.equal(e.applyAutoResult(qaItem, approved, { outcome: 'red' }).outcome, 'green');
});
