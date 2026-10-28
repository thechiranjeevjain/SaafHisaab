import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, activityDefinitions, calculateMonth, categoryTotals, groupPairs, normalizePhone, policyForMonth, rates, salaryPosition, sanitizePolicy } from '../www/core.js';

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

test('live salary separates confirmed pay from pending possible impact', () => {
  const dailyLogs = [
    ...[1,2,3,4].map((day) => ({ date: `2026-11-0${day}`, leave: 'full', approval: 'confirmed', tasks: {} })),
    { date: '2026-11-05', leave: 'half', approval: 'pending', tasks: {} },
    { date: '2026-11-06', leave: 'full', approval: 'disputed', tasks: {} },
  ];
  const position = salaryPosition({ dailyLogs, toiletLogs: [], policy: POLICY, month: '2026-11' });
  assert.equal(position.confirmed.adjustment, 0);
  assert.equal(position.confirmed.finalPayment, 7000);
  assert.ok(Math.abs(position.pendingPossibleAdjustment - 7000 / 26 / 2) < 1e-9);
  assert.ok(Math.abs(position.projected.finalPayment - (7000 - 7000 / 26 / 2)) < 1e-9);
  assert.equal(position.confirmedEquivalentDays, 4);
  assert.ok(Math.abs(position.pendingEquivalentDays - 0.5) < 1e-9);
  assert.equal(position.remainingAllowanceDays, 0);
});

test('pending misses first consume remaining allowance without showing premature loss', () => {
  const dailyLogs = [
    { date: '2026-11-01', leave: 'full', approval: 'confirmed', tasks: {} },
    { date: '2026-11-02', leave: 'half', approval: 'pending', tasks: {} },
  ];
  const position = salaryPosition({ dailyLogs, toiletLogs: [], policy: POLICY, month: '2026-11' });
  assert.equal(position.pendingPossibleAdjustment, 0);
  assert.equal(position.projected.finalPayment, 7000);
  assert.equal(position.remainingAllowanceDays, 3);
});

test('task misses are additive and toilet uses four monthly occurrences', () => {
  const r = rates();
  const dailyLogs = [{ date: '2026-11-05', leave: 'none', approval: 'confirmed', tasks: { morningCooking: 'missed', eveningCooking: 'done', morningUtensils: 'missed', eveningUtensils: 'done', floorCleaning: 'missed' } }];
  const toiletLogs = [{ month: '2026-11', slot: 1, outcome: 'missed', approval: 'confirmed' }];
  const calc = calculateMonth({ dailyLogs, toiletLogs, policy: POLICY, month: '2026-11' });
  assert.ok(Math.abs(calc.usedValue - (r.cookingSession + r.utensilSession + r.floor + r.toilet)) < 1e-9);
});

test('leave notice classification is informational and does not change agreed payroll maths', () => {
  const planned = calculateMonth({ dailyLogs: [{ date: '2026-11-05', leave: 'full', leaveNotice: 'planned', approval: 'confirmed', tasks: {} }], toiletLogs: [], policy: POLICY, month: '2026-11' });
  const noContact = calculateMonth({ dailyLogs: [{ date: '2026-11-05', leave: 'full', leaveNotice: 'no_contact', approval: 'confirmed', tasks: {} }], toiletLogs: [], policy: POLICY, month: '2026-11' });
  assert.equal(planned.usedValue, noContact.usedValue);
  assert.equal(planned.adjustment, noContact.adjustment);
});

test('agreement policy versions apply only from their effective month', () => {
  const profile = {
    policy: POLICY,
    policyHistory: [
      { effectiveMonth: '2026-01', policy: { ...POLICY, cookingAmount: 5000 } },
      { effectiveMonth: '2026-11', policy: { ...POLICY, monthlySalary: 7600, cookingAmount: 5600 } },
    ],
  };
  assert.equal(policyForMonth(profile, '2026-10').monthlySalary, 7000);
  assert.equal(policyForMonth(profile, '2026-11').monthlySalary, 7600);
  assert.equal(policyForMonth(profile, '2027-01').cookingAmount, 5600);
});

test('pluggable job functions drive categories and missed-function calculation', () => {
  const policy = sanitizePolicy({ jobProfileName: 'Driver', workingDays: 20, paidLeaveDays: 0, activities: [
    { id: 'drive', label: 'Driving', category: 'Driving', cadence: 'daily', monthlyAmount: 8000, expectedPerMonth: 20 },
    { id: 'wash', label: 'Car wash', category: 'Vehicle', cadence: 'flexible', monthlyAmount: 400, expectedPerMonth: 4 },
  ] });
  assert.equal(activityDefinitions(policy).length, 2);
  assert.deepEqual(categoryTotals(policy), { Driving: 8000, Vehicle: 400 });
  const calc = calculateMonth({ month: '2026-10', policy, dailyLogs: [{ date: '2026-10-02', leave: 'none', approval: 'confirmed', activityOutcomes: { drive: 'missed' } }], toiletLogs: [{ month: '2026-10', activityId: 'wash', slot: 1, outcome: 'missed', approval: 'confirmed' }] });
  assert.equal(calc.usedValue, 500);
  assert.equal(calc.finalPayment, 7900);
});
