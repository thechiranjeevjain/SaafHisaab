import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../www/app.js', import.meta.url), 'utf8');

test('selecting a relationship opens the calendar-first monthly workflow', () => {
  assert.match(source, /state\.page = 'month';/);
  assert.match(source, /Workday calendar/);
  assert.match(source, /data-action="back-to-calendar"/);
});

test('calendar workflow includes bulk leave and homeowner agreement editing', () => {
  assert.match(source, /id="bulkLeaveForm"/);
  assert.match(source, /id="policyForm"/);
  assert.match(source, /saveBulkLeaves/);
  assert.match(source, /id="bulkCompleteForm"/);
  assert.match(source, /saveBulkCompleted/);
  assert.match(source, /Month readiness/);
  assert.match(source, /name="workWeekdays"/);
  assert.match(source, /dayTypeSelect/);
  assert.match(source, /updatePolicy/);
  assert.match(source, /add-job-function/);
  assert.match(source, /Household expenses/);
  assert.match(source, /outside_food/);
});

test('month places calendar editing before expanded agreement details', () => {
  const monthRenderer = source.slice(source.indexOf('function renderMonth()'), source.indexOf('function monthlySummaryText()'));
  assert.ok(monthRenderer.indexOf('${renderMonthCalendar()}') < monthRenderer.indexOf('jobProfileName'));
  assert.ok(monthRenderer.indexOf('${renderBulkLeave()}') < monthRenderer.indexOf('jobProfileName'));
});
