import { POLICY, TASKS, OUTCOMES, calculateMonth, dateKey, missedActivityRows, money, monthKey, sanitizePolicy, uid } from './core.js';

const STORE_KEY = 'saafhisaab.shared-ledger.v1';
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');

const state = {
  page: 'today',
  authTab: 'employer',
  selectedDate: dateKey(),
  selectedMonth: monthKey(),
  busy: false,
  auth: null,
  connection: null,
  snapshot: null,
  draft: null,
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    state.auth = saved.auth || null;
    state.connection = saved.connection || null;
    state.snapshot = saved.snapshot || null;
  } catch (_) {}
}

function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ auth: state.auth, connection: state.connection, snapshot: state.snapshot }));
}

function toast(message, error = false) {
  toastEl.textContent = message;
  toastEl.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.className = 'toast'; }, 3100);
}

function roleName(role = state.auth?.role) {
  return role === 'employer' ? 'Homeowner' : 'Worker';
}

function defaultSnapshot() {
  return {
    profile: {
      householdId: 'demo-home',
      employerName: 'Homeowner',
      workerName: 'Worker',
      policy: { ...POLICY },
    },
    dailyLogs: [],
    toiletLogs: [],
    payments: [],
    audit: [],
    monthSummaries: {},
    syncedAt: new Date().toISOString(),
  };
}

function makeDraft(date = state.selectedDate) {
  const existing = state.snapshot?.dailyLogs?.find((x) => x.date === date);
  return existing ? structuredClone(existing) : {
    id: uid('day'), date, arrivalTime: '', departureTime: '', calls: 0, messages: 0,
    leave: 'none', tasks: Object.fromEntries(TASKS.map(([key]) => [key, 'pending'])), note: '',
  };
}

function syncDraftFromDailyForm() {
  const form = document.querySelector('#dailyForm');
  if (!form || !state.draft) return;
  const data = new FormData(form);
  state.draft.arrivalTime = data.get('arrivalTime') || '';
  state.draft.departureTime = data.get('departureTime') || '';
  state.draft.calls = Number(data.get('calls') || 0);
  state.draft.messages = Number(data.get('messages') || 0);
  state.draft.leave = data.get('leave') || 'none';
  state.draft.note = data.get('note') || '';
}

function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return value || '';
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(`${value}-01T12:00:00`));
}

function prettyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function approvalPill(status = 'pending') {
  return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(status.replace('_', ' '))}</span>`;
}

function inviteEncode(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `SH1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

function inviteDecode(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('SH1.')) throw new Error('This is not a valid SaafHisaab invitation.');
  const base = raw.slice(4).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base.padEnd(Math.ceil(base.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function api(action, payload = {}, useAuth = true) {
  if (state.auth?.mode === 'demo') return demoApi(action, payload);
  const endpoint = payload.endpoint || state.connection?.endpoint || state.auth?.endpoint;
  const body = { action, payload };
  if (useAuth && state.auth?.token) body.token = state.auth.token;
  if (window.google?.script?.run) {
    return new Promise((resolve, reject) => {
      window.google.script.run
        .withSuccessHandler((result) => result?.ok ? resolve(result.data) : reject(new Error(result?.error || 'Request failed.')))
        .withFailureHandler((error) => reject(new Error(error?.message || 'Google Apps Script request failed.')))
        .apiRequest(JSON.stringify(body));
    });
  }
  if (!endpoint) throw new Error('Google Apps Script URL is missing.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch (_) { throw new Error('The Google service returned an unreadable response. Check the deployment URL.'); }
  if (!result.ok) throw new Error(result.error || 'Request failed.');
  return result.data;
}

function addAudit(action, detail) {
  state.snapshot.audit.unshift({ id: uid('audit'), at: new Date().toISOString(), role: state.auth.role, action, detail });
}

async function demoApi(action, payload) {
  const snap = state.snapshot || defaultSnapshot();
  if (action === 'snapshot') return snap;
  if (action === 'saveDaily') {
    const log = { ...payload.log, createdBy: state.auth.role, approval: 'pending', updatedAt: new Date().toISOString() };
    const index = snap.dailyLogs.findIndex((x) => x.id === log.id || x.date === log.date);
    if (index >= 0) snap.dailyLogs[index] = log; else snap.dailyLogs.push(log);
    addAudit('Saved daily log', log.date);
  }
  if (action === 'saveToilet') {
    const log = { ...payload.log, createdBy: state.auth.role, approval: 'pending', updatedAt: new Date().toISOString() };
    const index = snap.toiletLogs.findIndex((x) => x.id === log.id || (x.month === log.month && Number(x.slot) === Number(log.slot)));
    if (index >= 0) snap.toiletLogs[index] = log; else snap.toiletLogs.push(log);
    addAudit('Saved toilet log', `${log.month} window ${log.slot}`);
  }
  if (action === 'reviewEntry') {
    const list = payload.entity === 'toilet' ? snap.toiletLogs : snap.dailyLogs;
    const item = list.find((x) => x.id === payload.id);
    if (!item) throw new Error('Entry was not found.');
    if (item.createdBy === state.auth.role) throw new Error('The other person must review this entry.');
    item.approval = payload.decision;
    item.confirmedBy = state.auth.role;
    item.updatedAt = new Date().toISOString();
    addAudit(`${payload.decision} entry`, item.date || `${item.month} toilet ${item.slot}`);
  }
  if (action === 'lockMonth') {
    if (state.auth.role !== 'employer') throw new Error('Only the homeowner can lock a month.');
    const open = [...snap.dailyLogs.filter((x) => x.date?.startsWith(payload.month)), ...snap.toiletLogs.filter((x) => x.month === payload.month)].filter((x) => x.approval !== 'confirmed');
    if (open.length) throw new Error('Resolve all pending or disputed entries before locking the month.');
    const calc = calculateMonth({ ...snap, policy: sanitizePolicy(snap.profile), month: payload.month });
    const payment = { month: payload.month, baseSalary: POLICY.monthlySalary, adjustment: calc.adjustment, finalPayment: calc.finalPayment, status: 'locked', lockedAt: new Date().toISOString() };
    const index = snap.payments.findIndex((x) => x.month === payload.month);
    if (index >= 0) snap.payments[index] = payment; else snap.payments.push(payment);
    addAudit('Locked month', payload.month);
  }
  if (action === 'acknowledgePayment') {
    if (state.auth.role !== 'worker') throw new Error('Only the worker can acknowledge the payment.');
    const payment = snap.payments.find((x) => x.month === payload.month);
    if (!payment) throw new Error('The homeowner has not locked this month yet.');
    payment.status = 'acknowledged';
    payment.acknowledgedAt = new Date().toISOString();
    addAudit('Acknowledged payment', payload.month);
  }
  snap.syncedAt = new Date().toISOString();
  saveStore();
  return snap;
}

async function refresh(showToast = false) {
  if (!state.auth) return;
  state.busy = true;
  render();
  try {
    state.snapshot = await api('snapshot');
    state.snapshot.syncedAt = new Date().toISOString();
    saveStore();
    state.draft = makeDraft();
    if (showToast) toast('Ledger updated.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

function policy() { return sanitizePolicy(state.snapshot?.profile || {}); }

function calcForMonth(month = state.selectedMonth) {
  const remote = state.snapshot?.monthSummaries?.[month];
  if (remote) return remote;
  return calculateMonth({ dailyLogs: state.snapshot?.dailyLogs || [], toiletLogs: state.snapshot?.toiletLogs || [], policy: policy(), month });
}

function renderAuth() {
  const unlock = state.connection;
  const tabs = `<div class="tabs">
    <button class="tab ${state.authTab === 'employer' ? 'active' : ''}" data-auth-tab="employer">Homeowner</button>
    <button class="tab ${state.authTab === 'worker' ? 'active' : ''}" data-auth-tab="worker">Worker</button>
    <button class="tab ${state.authTab === 'demo' ? 'active' : ''}" data-auth-tab="demo">Demo</button>
  </div>`;
  let body = '';
  if (unlock) {
    body = `<form id="unlockForm" class="card">
      <h2>Unlock ${escapeHtml(unlock.displayName || roleName(unlock.role))}</h2>
      <p class="card-sub">Connected as ${roleName(unlock.role)}. Enter your PIN.</p>
      <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" autocomplete="current-password" required /></label>
      <button class="primary" ${state.busy ? 'disabled' : ''}>Unlock</button>
      <button type="button" class="link-button" data-action="forget-connection">Use a different connection</button>
    </form>`;
  } else if (state.authTab === 'employer') {
    const hostedEndpoint = window.SAAF_HISAAB_WEB_APP_URL || '';
    body = `<form id="employerSetupForm" class="card">
      <h2>Create the shared household</h2>
      <p class="card-sub">Run <strong>setupSaafHisaab()</strong> in the supplied Apps Script first.</p>
      <label class="field"><span>Apps Script web app URL</span><input name="endpoint" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(hostedEndpoint)}" ${hostedEndpoint ? 'readonly' : ''} required /></label>
      <label class="field"><span>Owner setup code</span><input name="setupCode" autocomplete="off" required /></label>
      <div class="grid-2"><label class="field"><span>Homeowner name</span><input name="employerName" required /></label><label class="field"><span>Worker name</span><input name="workerName" required /></label></div>
      <label class="field"><span>Create homeowner PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label>
      <button class="primary" ${state.busy ? 'disabled' : ''}>Create household</button>
    </form>`;
  } else if (state.authTab === 'worker') {
    body = `<form id="workerJoinForm" class="card">
      <h2>Join the homeowner’s ledger</h2>
      <p class="card-sub">Paste the invitation shared by the homeowner.</p>
      <label class="field"><span>Invitation</span><textarea name="invite" rows="4" placeholder="SH1.…" required></textarea></label>
      <label class="field"><span>Create worker PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label>
      <button class="primary" ${state.busy ? 'disabled' : ''}>Join household</button>
    </form>`;
  } else {
    body = `<div class="card"><h2>Try without Google Sheets</h2><p class="card-sub">Demo data stays on this phone. You can switch between homeowner and worker to test confirmations.</p><button class="primary" data-action="start-demo">Open demo</button></div>`;
  }
  app.innerHTML = `<main class="auth-shell"><div class="auth-wrap"><div class="auth-brand"><div class="brand-mark">S</div><h1>SaafHisaab</h1><p>Update leaves. Calculate salary clearly.</p></div>${unlock ? '' : tabs}${body}<p class="helper-text right">The Google Sheet remains private in the homeowner’s account.</p></div></main>`;
}

function header() {
  const profile = state.snapshot.profile;
  const display = state.auth.role === 'employer' ? profile.employerName : profile.workerName;
  return `<header class="topbar"><div class="identity"><div class="brand-mark">H</div><div><strong>${escapeHtml(display)}</strong><small>${roleName()} · ${state.auth.mode === 'demo' ? 'Demo on this phone' : 'Google Sheet connected'}</small></div></div><button class="icon-button" data-action="sync" aria-label="Sync">${state.busy ? '…' : '↻'}</button></header>`;
}

function nav() {
  return `<nav class="bottom-nav">
    ${[['today','✓','Today'],['month','₹','Month'],['activity','≡','Activity'],['account','⚙','Account']].map(([id, icon, label]) => `<button class="nav-item ${state.page === id ? 'active' : ''}" data-page="${id}"><span>${icon}</span>${label}</button>`).join('')}
  </nav>`;
}

function renderToday() {
  const draft = state.draft || makeDraft();
  const locked = state.snapshot.payments?.some((x) => x.month === draft.date.slice(0, 7) && x.status);
  return `<div class="page-head"><div><h1>Daily work</h1><p>Record the day. The other person reviews it.</p></div><input class="date-input" id="selectedDate" type="date" value="${escapeHtml(state.selectedDate)}" /></div>
    ${locked ? '<div class="notice">This month is locked. Existing records cannot be changed.</div>' : ''}
    <form id="dailyForm">
      <section class="card"><h2>Attendance</h2><p class="card-sub">Times and contact attempts are evidence only. They do not directly change salary.</p>
        <div class="grid-2"><label class="field"><span>Arrived</span><input name="arrivalTime" type="time" value="${escapeHtml(draft.arrivalTime)}" /></label><label class="field"><span>Left</span><input name="departureTime" type="time" value="${escapeHtml(draft.departureTime)}" /></label></div>
        <div class="grid-2"><label class="field"><span>Calls made</span><input name="calls" type="number" min="0" max="99" value="${Number(draft.calls || 0)}" /></label><label class="field"><span>Messages sent</span><input name="messages" type="number" min="0" max="99" value="${Number(draft.messages || 0)}" /></label></div>
      </section>
      <section class="card"><h2>Leave</h2><p class="card-sub">A leave entry covers the related tasks. The system will not count the same absence twice.</p>
        <label class="field"><span>Leave for this day</span><select name="leave" id="leaveSelect"><option value="none" ${draft.leave === 'none' ? 'selected' : ''}>No leave</option><option value="half" ${draft.leave === 'half' ? 'selected' : ''}>Half-day leave</option><option value="full" ${draft.leave === 'full' ? 'selected' : ''}>Full-day leave</option></select></label>
      </section>
      <section class="card"><h2>Activities</h2><p class="card-sub">Floor cleaning is required once during the day, morning or evening.</p><div class="task-list">
        ${TASKS.map(([key, label]) => taskControl(key, label, draft.tasks?.[key] || 'pending', draft.leave !== 'none')).join('')}
      </div></section>
      <section class="card"><label class="field"><span>Note</span><textarea name="note" rows="3" placeholder="Optional clarification">${escapeHtml(draft.note || '')}</textarea></label><button class="primary" ${locked || state.busy ? 'disabled' : ''}>Save for review</button></section>
    </form>`;
}

function taskControl(key, label, value, disabled) {
  return `<div class="task-row" data-task-row="${key}"><strong>${escapeHtml(label)}</strong><div class="segments">
    <button type="button" class="segment done ${value === 'done' ? 'active' : ''}" data-task="${key}" data-outcome="done" ${disabled ? 'disabled' : ''}>Done</button>
    <button type="button" class="segment missed ${value === 'missed' ? 'active' : ''}" data-task="${key}" data-outcome="missed" ${disabled ? 'disabled' : ''}>Missed</button>
    <button type="button" class="segment skip ${['not_required','cancelled'].includes(value) ? 'active' : ''}" data-task="${key}" data-outcome="not_required" ${disabled ? 'disabled' : ''}>Not required</button>
  </div></div>`;
}

function renderMonth() {
  const p = policy();
  const calc = calcForMonth();
  const missed = missedActivityRows(state.snapshot.dailyLogs, state.snapshot.toiletLogs, state.selectedMonth);
  const payment = state.snapshot.payments?.find((x) => x.month === state.selectedMonth);
  const openCount = [...state.snapshot.dailyLogs.filter((x) => x.date?.startsWith(state.selectedMonth)), ...state.snapshot.toiletLogs.filter((x) => x.month === state.selectedMonth)].filter((x) => x.approval !== 'confirmed').length;
  return `<div class="page-head"><div><h1>${escapeHtml(monthLabel(state.selectedMonth))}</h1><p>Agreement, missed activities and final payment.</p></div><input class="month-input" id="selectedMonth" type="month" value="${escapeHtml(state.selectedMonth)}" /></div>
    <section class="card"><h2>Monthly agreement</h2><p class="card-sub">These category amounts are visible to both people. Individual task rates are not shown to the worker.</p><div class="agreement">
      <div class="agreement-row"><div><strong>Cooking</strong><small>26 days × morning and evening</small></div><span class="amount">${money(p.cookingAmount)}</span></div>
      <div class="agreement-row"><div><strong>Cleaning</strong><small>26 floor cleanings + 4 toilet cleanings</small></div><span class="amount">${money(p.cleaningAmount)}</span></div>
      <div class="agreement-row"><div><strong>Utensils</strong><small>26 days × morning and evening</small></div><span class="amount">${money(p.utensilsAmount)}</span></div>
      <div class="agreement-row total"><div><strong>Monthly salary</strong><small>Four paid leave-equivalent days allowed</small></div><span class="amount">${money(p.monthlySalary)}</span></div>
    </div></section>
    <section class="card"><h2>Leave and missed activities</h2><p class="card-sub">${openCount ? `${openCount} item${openCount === 1 ? '' : 's'} still need review.` : 'All recorded items have been reviewed.'}</p><div class="missed-list">
      ${missed.length ? missed.map((row) => `<div class="list-row"><div><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(prettyDate(row.date))}</small></div>${approvalPill(row.approval)}</div>`).join('') : '<div class="empty">No leave or missed activities recorded for this month.</div>'}
    </div></section>
    ${renderToiletSlots()}
    <section class="card payment"><h2>Payment</h2><p class="card-sub" style="color:#cfe4dd">Individual task amounts are combined into one adjustment.</p>
      <div class="payment-line"><span>Monthly salary</span><strong>${money(p.monthlySalary)}</strong></div>
      <div class="payment-line"><span>Adjustment after allowed leaves</span><strong>${calc.adjustment ? `− ${money(calc.adjustment)}` : money(0)}</strong></div>
      <div class="payment-line final"><span>Final payment</span><strong>${money(payment?.finalPayment ?? calc.finalPayment)}</strong></div>
      <div class="sync-note" style="color:#bcd7cf">Status: ${escapeHtml(payment?.status || 'Open month')}</div>
      ${state.auth.role === 'employer' && !payment ? `<button class="primary" data-action="lock-month" ${openCount || state.busy ? 'disabled' : ''}>Lock final payment</button>` : ''}
      ${state.auth.role === 'worker' && payment?.status === 'locked' ? `<button class="primary" data-action="ack-payment">Confirm payment amount</button>` : ''}
    </section>
    ${state.auth.role === 'employer' ? renderEmployerAudit(calc) : ''}`;
}

function toiletWindow(slot) {
  return ['1–7', '8–14', '15–21', '22–month end'][slot - 1];
}

function renderToiletSlots() {
  const logs = state.snapshot.toiletLogs.filter((x) => x.month === state.selectedMonth);
  const payment = state.snapshot.payments?.find((x) => x.month === state.selectedMonth);
  return `<section class="card"><h2>Toilet cleaning</h2><p class="card-sub">Four flexible monthly windows. A planned date can move within its window.</p><div class="toilet-grid">
    ${[1,2,3,4].map((slot) => {
      const log = logs.find((x) => Number(x.slot) === slot) || { id: uid('toilet'), month: state.selectedMonth, slot, outcome: 'pending', completedDate: '' };
      return `<div class="toilet-slot"><strong>Cleaning ${slot}</strong><small>${toiletWindow(slot)}</small><select data-toilet-outcome="${slot}" ${payment ? 'disabled' : ''}><option value="pending" ${log.outcome === 'pending' ? 'selected' : ''}>Not logged</option><option value="done" ${log.outcome === 'done' ? 'selected' : ''}>Completed</option><option value="missed" ${log.outcome === 'missed' ? 'selected' : ''}>Missed</option><option value="not_required" ${log.outcome === 'not_required' ? 'selected' : ''}>Not required</option><option value="cancelled" ${log.outcome === 'cancelled' ? 'selected' : ''}>Household cancelled</option></select><label class="field"><span>Completed date</span><input data-toilet-date="${slot}" type="date" value="${escapeHtml(log.completedDate || '')}" ${payment ? 'disabled' : ''}/></label><button class="secondary" style="width:100%" data-action="save-toilet" data-slot="${slot}" data-id="${escapeHtml(log.id)}" ${payment ? 'disabled' : ''}>Save</button>${log.approval ? `<div style="margin-top:9px">${approvalPill(log.approval)}</div>` : ''}</div>`;
    }).join('')}
  </div></section>`;
}

function renderEmployerAudit(calc) {
  const r = calc.rates || {};
  return `<section class="card"><h2>Homeowner calculation audit</h2><p class="card-sub">This panel is hidden from the worker. The worker sees the activity history and one combined adjustment.</p><details class="audit"><summary>Show internal rates and calculation</summary>
    <table class="audit-table"><thead><tr><th>Internal rate</th><th>Amount</th></tr></thead><tbody>
      <tr><td>Full day</td><td>${money(r.daily)}</td></tr><tr><td>Cooking session</td><td>${money(r.cookingSession)}</td></tr><tr><td>Utensil session</td><td>${money(r.utensilSession)}</td></tr><tr><td>Floor cleaning</td><td>${money(r.floor)}</td></tr><tr><td>Toilet cleaning</td><td>${money(r.toilet)}</td></tr>
    </tbody></table>
    <table class="audit-table"><thead><tr><th>Confirmed item</th><th>Internal value</th></tr></thead><tbody>${(calc.audit || []).map((x) => `<tr><td>${escapeHtml(x.date)} · ${escapeHtml(x.label)}</td><td>${money(x.value)}</td></tr>`).join('') || '<tr><td colspan="2">No confirmed absence value.</td></tr>'}</tbody></table>
    <div class="payment-line" style="color:var(--ink)"><span>Allowance</span><strong>${money(calc.allowance)}</strong></div><div class="payment-line" style="color:var(--ink)"><span>Used value</span><strong>${money(calc.usedValue)}</strong></div>
  </details></section>`;
}

function renderActivity() {
  const daily = [...state.snapshot.dailyLogs].sort((a, b) => b.date.localeCompare(a.date));
  const toilet = [...state.snapshot.toiletLogs].sort((a, b) => `${b.month}-${b.slot}`.localeCompare(`${a.month}-${a.slot}`));
  const rows = [
    ...daily.map((x) => ({ entity: 'daily', id: x.id, title: prettyDate(x.date), detail: dailyDetail(x), ...x })),
    ...toilet.map((x) => ({ entity: 'toilet', id: x.id, title: `${monthLabel(x.month)} · Toilet ${x.slot}`, detail: OUTCOMES[x.outcome] || x.outcome, ...x })),
  ].sort((a, b) => String(b.updatedAt || b.date || b.month).localeCompare(String(a.updatedAt || a.date || a.month)));
  return `<div class="page-head"><div><h1>Activity ledger</h1><p>Both people see the same records and review status.</p></div></div><section class="card"><div class="ledger-list">
    ${rows.length ? rows.map((x) => `<div class="list-row"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.detail)}</small><small>Recorded by ${escapeHtml(roleName(x.createdBy))}</small>${x.approval === 'pending' && x.createdBy !== state.auth.role ? `<div class="inline-actions" style="margin-top:10px"><button class="secondary" data-action="review" data-entity="${x.entity}" data-id="${x.id}" data-decision="confirmed">Confirm</button><button class="danger" data-action="review" data-entity="${x.entity}" data-id="${x.id}" data-decision="disputed">Dispute</button></div>` : ''}</div>${approvalPill(x.approval)}</div>`).join('') : '<div class="empty">No records yet.</div>'}
  </div></section>`;
}

function dailyDetail(log) {
  if (log.leave === 'full') return 'Full-day leave';
  if (log.leave === 'half') return 'Half-day leave';
  const done = TASKS.filter(([key]) => log.tasks?.[key] === 'done').length;
  const missed = TASKS.filter(([key]) => log.tasks?.[key] === 'missed').length;
  return `${done} completed · ${missed} missed${log.arrivalTime ? ` · arrived ${log.arrivalTime}` : ''}${log.departureTime ? ` · left ${log.departureTime}` : ''}`;
}

function renderAccount() {
  const profile = state.snapshot.profile;
  const invite = state.auth.role === 'employer' && state.auth.mode !== 'demo' && profile.joinCode ? inviteEncode({ endpoint: state.auth.endpoint, householdId: profile.householdId, joinCode: profile.joinCode }) : '';
  return `<div class="page-head"><div><h1>Account</h1><p>Connection, access and device controls.</p></div></div>
    <section class="card"><h2>${escapeHtml(profile.employerName)} and ${escapeHtml(profile.workerName)}</h2><p class="card-sub">Household ID: ${escapeHtml(profile.householdId)}</p><div class="notice good">${state.auth.mode === 'demo' ? 'Demo data is stored only on this phone.' : 'The shared ledger is stored in the homeowner’s private Google Sheet.'}</div></section>
    ${invite ? `<section class="card"><h2>Worker invitation</h2><p class="card-sub">Share this once with the worker. It contains the service address and one-time joining code, not your PIN.</p><label class="field"><span>Invitation</span><textarea id="inviteText" rows="5" readonly>${escapeHtml(invite)}</textarea></label><div class="inline-actions"><button class="secondary" data-action="copy-invite">Copy</button><button class="primary" data-action="share-invite">Share</button></div></section>` : ''}
    ${state.auth.mode === 'demo' ? `<section class="card"><h2>Test both roles</h2><p class="card-sub">Switch roles to confirm or dispute entries created by the other person.</p><button class="secondary" style="width:100%" data-action="switch-demo-role">Switch to ${state.auth.role === 'employer' ? 'Worker' : 'Homeowner'}</button></section>` : ''}
    <section class="card"><h2>Device access</h2><p class="card-sub">Lock removes the active session from the screen but remembers this connection. Forget removes the connection from this phone.</p><div class="inline-actions"><button class="secondary" data-action="lock-app">Lock app</button><button class="danger" data-action="forget-all">Forget this device</button></div></section>
    <p class="sync-note">Last updated ${state.snapshot.syncedAt ? new Date(state.snapshot.syncedAt).toLocaleString('en-IN') : 'not yet'}</p>`;
}

function render() {
  if (!state.auth || !state.snapshot) return renderAuth();
  let content = state.page === 'today' ? renderToday() : state.page === 'month' ? renderMonth() : state.page === 'activity' ? renderActivity() : renderAccount();
  app.innerHTML = `<div class="shell">${header()}<main class="main">${content}</main>${nav()}</div>`;
}

async function withBusy(work) {
  if (state.busy) return;
  state.busy = true;
  render();
  try { await work(); } catch (error) { toast(error.message, true); }
  finally { state.busy = false; render(); }
}

app.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-auth-tab]');
  if (tab) { state.authTab = tab.dataset.authTab; render(); return; }
  const page = event.target.closest('[data-page]');
  if (page) { state.page = page.dataset.page; render(); return; }
  const task = event.target.closest('[data-task]');
  if (task) {
    state.draft ||= makeDraft();
    syncDraftFromDailyForm();
    state.draft.tasks[task.dataset.task] = task.dataset.outcome;
    render();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'start-demo') {
    state.auth = { mode: 'demo', role: 'employer', token: 'demo' };
    state.snapshot = defaultSnapshot(); state.draft = makeDraft(); saveStore(); render();
  }
  if (name === 'sync') await refresh(true);
  if (name === 'forget-connection' || name === 'forget-all') {
    localStorage.removeItem(STORE_KEY); state.auth = null; state.connection = null; state.snapshot = null; render();
  }
  if (name === 'lock-app') { state.connection = { ...state.connection, mode: state.auth.mode, endpoint: state.auth.endpoint, householdId: state.auth.householdId, role: state.auth.role, displayName: state.auth.displayName }; state.auth = null; saveStore(); render(); }
  if (name === 'switch-demo-role') { state.auth.role = state.auth.role === 'employer' ? 'worker' : 'employer'; saveStore(); render(); }
  if (name === 'copy-invite') { await navigator.clipboard.writeText(document.querySelector('#inviteText').value); toast('Invitation copied.'); }
  if (name === 'share-invite') {
    const text = document.querySelector('#inviteText').value;
    if (navigator.share) await navigator.share({ title: 'SaafHisaab worker invitation', text }); else { await navigator.clipboard.writeText(text); toast('Invitation copied.'); }
  }
  if (name === 'save-toilet') await withBusy(async () => {
    const slot = Number(action.dataset.slot);
    const outcome = document.querySelector(`[data-toilet-outcome="${slot}"]`).value;
    const completedDate = document.querySelector(`[data-toilet-date="${slot}"]`).value;
    state.snapshot = await api('saveToilet', { log: { id: action.dataset.id, month: state.selectedMonth, slot, outcome, completedDate } });
    saveStore(); toast('Toilet-cleaning record saved for review.');
  });
  if (name === 'review') await withBusy(async () => {
    state.snapshot = await api('reviewEntry', { entity: action.dataset.entity, id: action.dataset.id, decision: action.dataset.decision });
    saveStore(); toast(`Entry ${action.dataset.decision}.`);
  });
  if (name === 'lock-month') await withBusy(async () => { state.snapshot = await api('lockMonth', { month: state.selectedMonth }); saveStore(); toast('Final payment locked.'); });
  if (name === 'ack-payment') await withBusy(async () => { state.snapshot = await api('acknowledgePayment', { month: state.selectedMonth }); saveStore(); toast('Payment amount acknowledged.'); });
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'selectedDate') { state.selectedDate = event.target.value; state.draft = makeDraft(); render(); }
  if (event.target.id === 'selectedMonth') { state.selectedMonth = event.target.value; render(); }
  if (event.target.id === 'leaveSelect') { state.draft ||= makeDraft(); state.draft.leave = event.target.value; render(); }
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'dailyForm') await withBusy(async () => {
    const form = new FormData(event.target);
    state.draft ||= makeDraft();
    const log = { ...state.draft, date: state.selectedDate, arrivalTime: form.get('arrivalTime'), departureTime: form.get('departureTime'), calls: Number(form.get('calls') || 0), messages: Number(form.get('messages') || 0), leave: form.get('leave'), note: form.get('note') || '' };
    state.snapshot = await api('saveDaily', { log }); saveStore(); state.draft = makeDraft(); toast('Daily record saved for review.');
  });
  if (event.target.id === 'employerSetupForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    const data = await api('createHousehold', form, false);
    state.auth = { mode: 'remote', endpoint: form.endpoint, householdId: data.householdId, role: 'employer', token: data.token, displayName: form.employerName };
    state.connection = { endpoint: form.endpoint, householdId: data.householdId, role: 'employer', displayName: form.employerName };
    state.snapshot = data.snapshot; state.draft = makeDraft(); saveStore(); toast('Household created.');
  });
  if (event.target.id === 'workerJoinForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    const invite = inviteDecode(form.invite);
    const data = await api('joinHousehold', { ...invite, endpoint: invite.endpoint, pin: form.pin }, false);
    state.auth = { mode: 'remote', endpoint: invite.endpoint, householdId: invite.householdId, role: 'worker', token: data.token, displayName: data.displayName };
    state.connection = { endpoint: invite.endpoint, householdId: invite.householdId, role: 'worker', displayName: data.displayName };
    state.snapshot = data.snapshot; state.draft = makeDraft(); saveStore(); toast('Worker device connected.');
  });
  if (event.target.id === 'unlockForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    if (state.connection.mode === 'demo') {
      state.auth = { mode: 'demo', role: state.connection.role, token: 'demo' };
    } else {
      const data = await api('login', { endpoint: state.connection.endpoint, householdId: state.connection.householdId, role: state.connection.role, pin: form.pin }, false);
      state.auth = { mode: 'remote', ...state.connection, token: data.token };
      state.snapshot = data.snapshot;
    }
    state.draft = makeDraft(); saveStore();
  });
});

loadStore();
if (state.auth?.mode === 'demo' && !state.snapshot) state.snapshot = defaultSnapshot();
if (state.auth && state.snapshot) {
  state.draft = makeDraft();
  render();
  if (state.auth.mode === 'remote') refresh(false);
} else render();
