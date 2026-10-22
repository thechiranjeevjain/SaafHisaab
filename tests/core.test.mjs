import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, calculateMonth, groupPairs, normalizePhone, rates } from '../www/core.js';

test('phone login normalizes common Indian formats to one identity', () => {
  assert.equal(normalizePhone('98765 43210'), '+919876543210');
  assert.equal(normalizePhone('09876543210'), '+919876543210');
  assert.equal(normalizePhone('91-98765-43210'), '+919876543210');
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
  assert.throws(() => normalizePhone('1234'), /10-digit Indian phone number/);
  assert.throws(() => normalizePhone('call-me-9876543210'), /unsupported characters/);
});

test('one account groups homeowner and worker pairings without mixing them', () => {
  const pairs = [
    { pairId: 'p1', role: 'employer', counterpartName: 'A' },
    { pairId: 'p2', role: 'worker', counterpartName: 'B' },
    { pairId: 'p3', role: 'employer', counterpartName: 'C' },
  ];
  const grouped = groupPairs(pairs);
  assert.deepEqual(grouped.workingForMe.map((x) => x.pairId), ['p1', 'p3']);
  assert.deepEqual(grouped.iWorkFor.map((x) => x.pairId), ['p2']);
  assert.equal(grouped.workingForMe[0].counterpartName, 'A');
});

test('agreed category amounts reconcile to 7000', () => {
  assert.equal(POLICY.cookingAmount + POLICY.cleaningAmount + POLICY.utensilsAmount, POLICY.monthlySalary);
  assert.equal(POLICY.floorInternalAmount + POLICY.toiletInternalAmount, POLICY.cleaningAmount);
});

test('internal task rates reconcile to each category', () => {
  const r = rates();
  assert.ok(Math.abs(r.cookingSession * 52 - 5000) < 1e-9);
  assert.ok(Math.abs(r.utensilSession * 52 - 800) < 1e-9);
  assert.ok(Math.abs(r.floor * 26 - 900) < 1e-9);
  assert.ok(Math.abs(r.toilet * 4 - 300) < 1e-9);
});

test('four full-day leaves remain fully protected', () => {
  const dailyLogs = [1,2,3,4].map((day) => ({ date: `2026-11-0${day}`, leave: 'full', approval: 'confirmed', tasks: {} }));
  const calc = calculateMonth({ dailyLogs, toiletLogs: [], policy: POLICY, month: '2026-11' });
  assert.ok(Math.abs(calc.usedValue - calc.allowance) < 1e-9);
  assert.equal(calc.adjustment, 0);
  assert.equal(calc.finalPayment, 7000);
});

test('only the excess beyond four days is adjusted', () => {
  const dailyLogs = [1,2,3,4,5].map((day) => ({ date: `2026-11-0${day}`, leave: 'full', approval: 'confirmed', tasks: {} }));
  const calc = calculateMonth({ dailyLogs, toiletLogs: [], policy: POLICY, month: '2026-11' });
  assert.ok(Math.abs(calc.adjustment - 7000 / 26) < 1e-9);
  assert.ok(Math.abs(calc.finalPayment - (7000 - 7000 / 26)) < 1e-9);
});

test('full-day leave does not double count missed tasks', () => {
  const dailyLogs = [{
    date: '2026-11-05', leave: 'full', approval: 'confirmed',
    tasks: { morningCooking: 'missed', eveningCooking: 'missed', morningUtensils: 'missed', eveningUtensils: 'missed', floorCleaning: 'missed' },
  }];
  const calc = calculateMonth({ dailyLogs, toiletLogs: [], policy: POLICY, month: '2026-11' });
  assert.ok(Math.abs(calc.usedValue - 7000 / 26) < 1e-9);
  assert.equal(calc.audit.length, 1);
  assert.equal(calc.audit[0].label, 'Full-day leave');
});

test('pending and disputed entries never affect payment', () => {
  const dailyLogs = [
    { date: '2026-11-05', leave: 'full', approval: 'pending', tasks: {} },
    { date: '2026-11-06', leave: 'full', approval: 'disputed', tasks: {} },
  ];
  const toiletLogs = [{ month: '2026-11', slot: 1, outcome: 'missed', approval: 'pending' }];
  const calc = calculateMonth({ dailyLogs, toiletLogs, policy: POLICY, month: '2026-11' });
  assert.equal(calc.usedValue, 0);
  assert.equal(calc.adjustment, 0);
});

test('task misses are additive and toilet uses four monthly occurrences', () => {
  const r = rates();
  const dailyLogs = [{ date: '2026-11-05', leave: 'none', approval: 'confirmed', tasks: { morningCooking: 'missed', eveningCooking: 'done', morningUtensils: 'missed', eveningUtensils: 'done', floorCleaning: 'missed' } }];
  const toiletLogs = [{ month: '2026-11', slot: 1, outcome: 'missed', approval: 'confirmed' }];
  const calc = calculateMonth({ dailyLogs, toiletLogs, policy: POLICY, month: '2026-11' });
  assert.ok(Math.abs(calc.usedValue - (r.cookingSession + r.utensilSession + r.floor + r.toilet)) < 1e-9);
});
