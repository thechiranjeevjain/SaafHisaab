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
