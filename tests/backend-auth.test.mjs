import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function backend() {
  const context = vm.createContext({ console, Date, JSON, Math, String, Number, Array, Object, RegExp, Error, isFinite });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  return context;
}

test('backend authorizes only accounts linked to the selected pair', () => {
  const code = backend();
  code.findHousehold_ = (pairId) => ({ householdId: pairId, employerUserId: 'owner-1', workerUserId: 'worker-1' });

  assert.equal(code.authorizePair_({ userId: 'owner-1' }, 'pair-1').role, 'employer');
  assert.equal(code.authorizePair_({ userId: 'worker-1' }, 'pair-1').role, 'worker');
  assert.throws(() => code.authorizePair_({ userId: 'outsider' }, 'pair-1'), /do not have access/);
  assert.throws(() => code.authorizePair_({ userId: 'owner-1' }, ''), /Choose a person/);
});

test('snapshot dispatch requires an authenticated account and explicit pair ID', () => {
  const code = backend();
  code.authenticateAccount_ = (token) => {
    assert.equal(token, 'valid-token');
    return { userId: 'owner-1' };
  };
  code.findHousehold_ = (pairId) => ({ householdId: pairId, employerUserId: 'owner-1', workerUserId: 'worker-1' });
  code.snapshot_ = (actor) => actor;

  const actor = code.dispatch_({ action: 'snapshot', token: 'valid-token', payload: { pairId: 'pair-7' } });
  assert.equal(actor.householdId, 'pair-7');
  assert.equal(actor.userId, 'owner-1');
  assert.throws(() => code.dispatch_({ action: 'snapshot', token: 'valid-token', payload: {} }), /Choose a person/);
});

test('worker can log own work but leave stays a homeowner-reviewed request', () => {
  const code = backend();
  let daily, flexible;
  code.ensureMonthOpen_ = () => {};
  code.findRow_ = () => null;
  code.findHousehold_ = () => ({});
  code.policyForMonth_ = () => ({ activities: [{ id: 'work', label: 'Work', cadence: 'daily' }, { id: 'weekly', label: 'Weekly work', cadence: 'flexible', expectedPerMonth: 2 }] });
  code.appendObject_ = (sheet, object) => { if (sheet === 'daily') daily = object; if (sheet === 'toilet') flexible = object; };
  code.audit_ = () => {};
  code.saveDaily_({ role: 'worker', householdId: 'pair-1' }, { id: 'day-1', date: '2026-11-02', dayType: 'not_required', leave: 'full', activityOutcomes: { work: 'not_required' } });
  assert.equal(daily.createdBy, 'worker');
  assert.equal(daily.dayType, 'expected');
  assert.equal(daily.leave, 'none');
  assert.equal(JSON.parse(daily.activityOutcomesJson).work, 'pending');
  code.saveToilet_({ role: 'worker', householdId: 'pair-1' }, { id: 'flex-1', month: '2026-11', activityId: 'weekly', slot: 1, outcome: 'done', completedDate: '2026-11-07' });
  assert.equal(flexible.createdBy, 'worker');
  assert.equal(flexible.outcome, 'done');
  code.findRow_ = () => ({ object: { id: 'owner-day', createdBy: 'employer', createdAt: '2026-11-01' }, rowNumber: 2 });
  assert.throws(() => code.saveDaily_({ role: 'worker', householdId: 'pair-1' }, { id: 'owner-day', date: '2026-11-03', activityOutcomes: { work: 'done' } }), /Only the person who recorded/);
  assert.throws(() => code.submitRequest_({ role: 'employer', householdId: 'pair-1' }, {}), /Only the worker/);
  assert.throws(() => code.reviewRequest_({ role: 'worker', householdId: 'pair-1' }, {}), /Only the homeowner/);
});

test('worker snapshot hides live compensation and reveals only a released payment', () => {
  const code = backend();
  const policy = code.validatePolicy_({ jobProfileName: 'Cook', workingDays: 26, paidLeaveDays: 4, activities: [{ id: 'cook', label: 'Cooking', category: 'Cooking', cadence: 'daily', monthlyAmount: 7000, expectedPerMonth: 26 }] });
  const household = { householdId: 'pair-1', employerName: 'Owner', workerName: 'Worker', policyHistoryJson: JSON.stringify([{ id: 'p1', effectiveMonth: '2026-01', policy, createdAt: '2026-01-01' }]) };
  code.Utilities = { formatDate: () => '2026-11' };
  code.Session = { getScriptTimeZone: () => 'Asia/Calcutta' };
  code.findHousehold_ = () => household;
  code.rows_ = (sheet) => sheet === 'payments' ? [{ householdId: 'pair-1', month: '2026-10', baseSalary: 7000, adjustment: 200, finalPayment: 6800, status: 'locked' }] : [];
  code.isoNow_ = () => '2026-11-01T00:00:00.000Z';
  const snapshot = code.snapshot_({ role: 'worker', householdId: 'pair-1' });
  assert.equal(snapshot.profile.policy.compensationHidden, true);
  assert.equal(snapshot.profile.policy.monthlySalary, undefined);
  assert.equal(snapshot.profile.policy.activities[0].label, 'Cooking');
  assert.equal(snapshot.profile.policy.activities[0].monthlyAmount, undefined);
  assert.deepEqual(Object.keys(snapshot.monthSummaries), []);
  assert.deepEqual(Object.keys(snapshot.monthPositions), []);
  assert.equal(snapshot.audit.length, 0);
  assert.equal(snapshot.payments[0].finalPayment, 6800);
});

test('bulk leave is homeowner-only and forwards each distinct date through normal validation', () => {
  const code = backend(), saved = [];
  code.saveDaily_ = (_actor, log) => saved.push(log);
  code.findHousehold_ = () => ({});
  code.policyForMonth_ = () => ({ activities: [] });
  assert.throws(() => code.saveBulkLeaves_({ role: 'worker' }, [{ date: '2026-10-02' }]), /Only the homeowner/);
  code.saveBulkLeaves_({ role: 'employer', householdId: 'pair-1' }, [
    { date: '2026-10-02', leave: 'full', leaveNotice: 'planned' },
    { date: '2026-10-02', leave: 'full', leaveNotice: 'planned' },
    { date: '2026-10-09', leave: 'half', leaveNotice: 'last_minute' },
  ]);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].leave, 'full');
  assert.equal(saved[1].leave, 'half');
});

test('bulk completion accepts only scheduled unrecorded dates', () => {
  const code = backend(), saved = [];
  code.findHousehold_ = () => ({});
  code.policyForMonth_ = () => ({ workWeekdays: [1,2,3,4,5], activities: [{ id: 'work', cadence: 'daily' }] });
  code.findRow_ = () => null;
  code.saveDaily_ = (_actor, log) => saved.push(log);
  assert.throws(() => code.saveBulkCompleted_({ role: 'worker' }, ['2026-11-02'], ''), /Only the homeowner/);
  code.saveBulkCompleted_({ role: 'employer', householdId: 'pair-1' }, ['2026-11-02', '2026-11-02'], 'Normal week');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].activityOutcomes.work, 'done');
  assert.equal(saved[0].dayType, 'expected');
  assert.throws(() => code.saveBulkCompleted_({ role: 'employer', householdId: 'pair-1' }, ['2026-11-01'], ''), /outside the expected work schedule/);
  saved.length = 0;
  code.findRow_ = (_key, predicate) => predicate({ householdId: 'pair-1', date: '2026-11-03' }) ? { object: {} } : null;
  assert.throws(() => code.saveBulkCompleted_({ role: 'employer', householdId: 'pair-1' }, ['2026-11-02', '2026-11-03'], ''), /already exists/);
  assert.equal(saved.length, 0, 'the batch must be fully validated before any date is written');
});

test('not-required day forces leave and daily functions to neutral outcomes', () => {
  const code = backend();
  let saved;
  code.ensureMonthOpen_ = () => {};
  code.findRow_ = () => null;
  code.findHousehold_ = () => ({});
  code.policyForMonth_ = () => ({ activities: [{ id: 'cooking', cadence: 'daily' }] });
  code.appendObject_ = (_sheet, object) => { saved = object; };
  code.audit_ = () => {};
  code.saveDaily_({ role: 'employer', householdId: 'pair-1' }, { id: 'day-1', date: '2026-11-02', dayType: 'not_required', leave: 'full', activityOutcomes: { cooking: 'missed' } });
  assert.equal(saved.dayType, 'not_required');
  assert.equal(saved.leave, 'none');
  assert.equal(JSON.parse(saved.activityOutcomesJson).cooking, 'not_required');
});

test('household expenses are homeowner-only and preserve leave linkage', () => {
  const code = backend();
  let saved;
  code.findRow_ = () => null;
  code.appendObject_ = (sheet, object) => { if (sheet === 'expenses') saved = object; };
  code.audit_ = () => {};
  assert.throws(() => code.saveExpense_({ role: 'worker', householdId: 'pair-1' }, {}), /Only the homeowner/);
  code.saveExpense_({ role: 'employer', householdId: 'pair-1' }, { id: 'expense-1', date: '2026-10-09', category: 'outside_food', amount: 425.5, vendor: 'Restaurant', linkedLeaveDate: '2026-10-09' });
  assert.equal(saved.amount, 425.5);
  assert.equal(saved.linkedLeaveDate, '2026-10-09');
  assert.equal(saved.householdId, 'pair-1');
});

test('pluggable job profile validates arbitrary daily and flexible functions', () => {
  const code = backend();
  const policy = code.validatePolicy_({ jobProfileName: 'Driver', workingDays: 24, paidLeaveDays: 2, activities: [
    { id: 'driving', label: 'Daily driving', category: 'Driving', cadence: 'daily', monthlyAmount: 9000, expectedPerMonth: 1 },
    { id: 'carWash', label: 'Car wash', category: 'Vehicle care', cadence: 'flexible', monthlyAmount: 600, expectedPerMonth: 4 },
  ] });
  assert.equal(policy.jobProfileName, 'Driver');
  assert.equal(policy.activities[0].expectedPerMonth, 24);
  assert.equal(policy.activities[1].expectedPerMonth, 4);
  assert.equal(policy.monthlySalary, 9600);
  assert.equal(policy.categoryAmounts['Vehicle care'], 600);
  assert.deepEqual(Array.from(policy.workWeekdays), [1,2,3,4,5,6]);
});

test('editable agreement derives category and monthly totals from activity allocations', () => {
  const code = backend();
  const policy = code.validatePolicy_({ workingDays: 25, paidLeaveDays: 3, cookingAmount: 5200, utensilsAmount: 900, floorInternalAmount: 1000, toiletInternalAmount: 400, toiletPerMonth: 2 });
  assert.equal(policy.cleaningAmount, 1400);
  assert.equal(policy.monthlySalary, 7500);
  assert.throws(() => code.validatePolicy_({ workingDays: 2, paidLeaveDays: 3, cookingAmount: 1, utensilsAmount: 1, floorInternalAmount: 1, toiletInternalAmount: 1, toiletPerMonth: 1 }), /cannot exceed working days/);
});

test('backend agreement history preserves older month calculations', () => {
  const code = backend();
  const household = {
    policyHistoryJson: JSON.stringify([
      { id: 'old', effectiveMonth: '2026-01', policy: { monthlySalary: 7000, workingDays: 26, paidLeaveDays: 4, cookingAmount: 5000, utensilsAmount: 800, floorInternalAmount: 900, toiletInternalAmount: 300, toiletPerMonth: 4 } },
      { id: 'new', effectiveMonth: '2026-11', policy: { monthlySalary: 7500, workingDays: 25, paidLeaveDays: 3, cookingAmount: 5200, utensilsAmount: 900, floorInternalAmount: 1000, toiletInternalAmount: 400, toiletPerMonth: 2 } },
    ]),
  };
  assert.equal(code.policyForMonth_(household, '2026-10').monthlySalary, 7000);
  assert.equal(code.policyForMonth_(household, '2026-11').monthlySalary, 7500);
});

test('locking a month stores the effective versioned base salary', () => {
  const code = backend();
  const household = {
    householdId: 'pair-1',
    policyHistoryJson: JSON.stringify([
      { id: 'old', effectiveMonth: '2026-01', policy: { monthlySalary: 7000, workingDays: 26, paidLeaveDays: 4, cookingAmount: 5000, utensilsAmount: 800, floorInternalAmount: 900, toiletInternalAmount: 300, toiletPerMonth: 4 } },
      { id: 'new', effectiveMonth: '2026-11', policy: { monthlySalary: 7500, workingDays: 25, paidLeaveDays: 3, cookingAmount: 5200, utensilsAmount: 900, floorInternalAmount: 1000, toiletInternalAmount: 400, toiletPerMonth: 2 } },
    ]),
  };
  let payment;
  code.ensureMonthOpen_ = () => {};
  code.rows_ = (sheet) => sheet === 'daily' || sheet === 'toilet' || sheet === 'requests' ? [] : [];
  code.findHousehold_ = () => household;
  code.appendObject_ = (sheet, object) => { if (sheet === 'payments') payment = object; };
  code.audit_ = () => {};
  code.monthReadiness_ = () => ({ missingCount: 0 });

  code.lockMonth_({ role: 'employer', householdId: 'pair-1' }, '2026-11');
  assert.equal(payment.baseSalary, 7500);
  assert.equal(payment.finalPayment, 7500);
});

test('locking a month fails while an expected workday has no record', () => {
  const code = backend();
  const household = { householdId: 'pair-1', policyHistoryJson: JSON.stringify([{ id: 'p', effectiveMonth: '2026-01', policy: { monthlySalary: 7000, workingDays: 26, paidLeaveDays: 4, workWeekdays: [1], employmentStartDate: '2026-11-01', employmentEndDate: '2026-11-03', cookingAmount: 5000, utensilsAmount: 800, floorInternalAmount: 900, toiletInternalAmount: 300, toiletPerMonth: 4 } }]) };
  code.ensureMonthOpen_ = () => {};
  code.rows_ = () => [];
  code.findHousehold_ = () => household;
  assert.throws(() => code.lockMonth_({ role: 'employer', householdId: 'pair-1' }, '2026-11'), /1 date is still missing/);
});
