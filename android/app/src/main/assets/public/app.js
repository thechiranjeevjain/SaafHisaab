import { POLICY, OUTCOMES, activityDefinitions, calculateMonth, categoryTotals, dateKey, groupPairs, missedActivityRows, money, monthKey, normalizePhone, policyForMonth, salaryPosition, sanitizePolicy, uid } from './core.js';

const STORE_KEY = 'saafhisaab.shared-ledger.v2';
const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');

const state = {
  page: 'today',
  authTab: 'login',
  selectedDate: dateKey(),
  selectedMonth: monthKey(),
  busy: false,
  auth: null,
  connection: null,
  pairs: [],
  pair: null,
  snapshot: null,
  draft: null,
  draftDirty: false,
  openedFromCalendar: false,
  policyDraft: null,
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    state.auth = saved.auth || null;
    state.connection = saved.connection || null;
    state.pairs = saved.pairs || [];
    state.pair = saved.auth?.mode === 'demo' ? saved.pair || null : null;
    state.snapshot = saved.auth?.mode === 'demo' ? saved.snapshot || null : null;
  } catch (_) {}
}

function saveStore() {
  const saved = { auth: state.auth, connection: state.connection, pairs: state.pairs };
  if (state.auth?.mode === 'demo') { saved.pair = state.pair; saved.snapshot = state.snapshot; }
  localStorage.setItem(STORE_KEY, JSON.stringify(saved));
}

function configuredServiceEndpoint() {
  return String(
    window.SAAF_HISAAB_WEB_APP_URL
    || window.SAAF_HISAAB_API_URL
    || state.connection?.endpoint
    || state.auth?.endpoint
    || ''
  ).trim();
}

function serviceIsReady() {
  return Boolean(window.google?.script?.run || configuredServiceEndpoint());
}

function requireServiceEndpoint() {
  const endpoint = configuredServiceEndpoint();
  if (!window.google?.script?.run && !endpoint) {
    throw new Error('This installation is not connected to the SaafHisaab service. Ask the app administrator for an updated build.');
  }
  return endpoint;
}

function toast(message, error = false) {
  toastEl.textContent = message;
  toastEl.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.className = 'toast'; }, 3100);
}

function roleName(role = state.pair?.role || state.auth?.role) {
  return role === 'employer' ? 'Homeowner' : 'Worker';
}

function defaultSnapshot(pairId = 'demo-home') {
  return {
    profile: {
      householdId: pairId,
      employerName: 'Homeowner',
      workerName: 'Worker',
      policy: { ...POLICY },
    },
    dailyLogs: [],
    toiletLogs: [],
    expenses: [],
    requests: [],
    payments: [],
    audit: [],
    monthSummaries: {},
    syncedAt: new Date().toISOString(),
  };
}

function makeDraft(date = state.selectedDate) {
  const existing = state.snapshot?.dailyLogs?.find((x) => x.date === date);
  const activities = activityDefinitions(policy(date.slice(0, 7))).filter((item) => item.cadence === 'daily');
  if (existing) {
    const copy = structuredClone(existing);
    copy.activityOutcomes = { ...Object.fromEntries(activities.map((item) => [item.id, 'done'])), ...(copy.tasks || {}), ...(copy.activityOutcomes || {}) };
    return copy;
  }
  return {
    id: uid('day'), date, arrivalTime: '', departureTime: '', calls: 0, messages: 0,
    leave: 'none', leaveNotice: '', activityOutcomes: Object.fromEntries(activities.map((item) => [item.id, 'done'])), note: '',
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
  state.draft.leaveNotice = data.get('leaveNotice') || '';
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
  const pairActions = ['snapshot', 'saveDaily', 'saveBulkLeaves', 'saveToilet', 'saveExpense', 'updatePolicy', 'submitRequest', 'reviewRequest', 'reviewEntry', 'lockMonth', 'acknowledgePayment'];
  if (pairActions.includes(action) && state.pair?.pairId && !payload.pairId) payload = { ...payload, pairId: state.pair.pairId };
  const endpoint = payload.endpoint || configuredServiceEndpoint();
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
  state.snapshot.audit.unshift({ id: uid('audit'), at: new Date().toISOString(), role: state.pair?.role || state.auth.role, action, detail });
}

async function demoApi(action, payload) {
  const snap = state.snapshot || defaultSnapshot();
  if (action === 'snapshot') return snap;
  if (action === 'saveDaily') {
    if (state.pair.role !== 'employer') throw new Error('Workers submit requests instead of changing payroll records.');
    const log = { ...payload.log, createdBy: state.pair.role, approval: 'pending', updatedAt: new Date().toISOString() };
    const index = snap.dailyLogs.findIndex((x) => x.id === log.id || x.date === log.date);
    if (index >= 0) snap.dailyLogs[index] = log; else snap.dailyLogs.push(log);
    addAudit('Saved daily log', log.date);
  }
  if (action === 'saveToilet') {
    if (state.pair.role !== 'employer') throw new Error('Workers submit requests instead of changing payroll records.');
    const log = { ...payload.log, createdBy: state.pair.role, approval: 'pending', updatedAt: new Date().toISOString() };
    const index = snap.toiletLogs.findIndex((x) => x.id === log.id || (x.month === log.month && (x.activityId || 'toiletCleaning') === (log.activityId || 'toiletCleaning') && Number(x.slot) === Number(log.slot)));
    if (index >= 0) snap.toiletLogs[index] = log; else snap.toiletLogs.push(log);
    addAudit('Saved toilet log', `${log.month} window ${log.slot}`);
  }
  if (action === 'saveExpense') {
    if (state.pair.role !== 'employer') throw new Error('Only the homeowner can manage household expenses.');
    const expense = { ...payload.expense, id: payload.expense.id || uid('expense'), createdBy: 'employer', updatedAt: new Date().toISOString() };
    const index = (snap.expenses ||= []).findIndex((item) => item.id === expense.id);
    if (index >= 0) snap.expenses[index] = expense; else snap.expenses.push(expense);
    addAudit('Saved household expense', `${expense.date} ${expense.category} ${expense.amount}`);
  }
  if (action === 'saveBulkLeaves') {
    if (state.pair.role !== 'employer') throw new Error('Only the homeowner can record payroll entries.');
    for (const leave of payload.leaves || []) {
      const existing = snap.dailyLogs.find((item) => item.date === leave.date);
      if (existing && existing.createdBy && existing.createdBy !== 'employer') throw new Error(`A worker-created record already exists for ${leave.date}.`);
      const activities = activityDefinitions(policy(leave.date.slice(0, 7))).filter((item) => item.cadence === 'daily');
      const log = existing || { id: uid('day'), date: leave.date, activityOutcomes: Object.fromEntries(activities.map((item) => [item.id, 'done'])), createdAt: new Date().toISOString() };
      Object.assign(log, { leave: leave.leave, leaveNotice: leave.leaveNotice, note: leave.note || '', createdBy: 'employer', approval: 'pending', confirmedBy: '', updatedAt: new Date().toISOString() });
      if (!existing) snap.dailyLogs.push(log);
      addAudit('Saved bulk leave', leave.date);
    }
  }
  if (action === 'updatePolicy') {
    if (state.pair.role !== 'employer') throw new Error('Only the homeowner can change agreement rates.');
    const version = { id: uid('policy'), effectiveMonth: payload.effectiveMonth, policy: sanitizePolicy(payload.policy), createdAt: new Date().toISOString() };
    const history = (snap.profile.policyHistory || []).filter((item) => item.effectiveMonth !== version.effectiveMonth);
    history.push(version);
    snap.profile.policyHistory = history.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
    snap.profile.policy = policyForMonth(snap.profile, monthKey());
    snap.monthSummaries = {};
    snap.monthPositions = {};
    addAudit('Updated agreement rates', version.effectiveMonth);
  }
  if (action === 'submitRequest') {
    if (state.pair.role !== 'worker') throw new Error('Only the worker can submit this request.');
    snap.requests ||= [];
    snap.requests.push({ ...payload.request, id: payload.request.id || uid('request'), type: 'leave', createdBy: 'worker', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    addAudit('Submitted leave request', payload.request.date);
  }
  if (action === 'reviewRequest') {
    if (state.pair.role !== 'employer') throw new Error('Only the homeowner can review requests.');
    const request = (snap.requests || []).find((item) => item.id === payload.id);
    if (!request || request.status !== 'pending') throw new Error('Pending request was not found.');
    request.status = payload.decision;
    request.reviewedBy = 'employer';
    request.updatedAt = new Date().toISOString();
    if (payload.decision === 'accepted') {
      const activities = activityDefinitions(policy(request.date.slice(0, 7))).filter((item) => item.cadence === 'daily');
      const log = snap.dailyLogs.find((item) => item.date === request.date) || { id: uid('day'), date: request.date, activityOutcomes: Object.fromEntries(activities.map((item) => [item.id, 'done'])), createdAt: new Date().toISOString() };
      Object.assign(log, { leave: request.leave, leaveNotice: request.leaveNotice, note: request.note || '', createdBy: 'worker', approval: 'confirmed', confirmedBy: 'employer', updatedAt: new Date().toISOString() });
      if (!snap.dailyLogs.some((item) => item.id === log.id)) snap.dailyLogs.push(log);
    }
    addAudit(`${payload.decision} worker request`, request.date);
  }
  if (action === 'reviewEntry') {
    const list = payload.entity === 'toilet' ? snap.toiletLogs : snap.dailyLogs;
    const item = list.find((x) => x.id === payload.id);
    if (!item) throw new Error('Entry was not found.');
    if (item.createdBy === state.pair.role) throw new Error('The other person must review this entry.');
    item.approval = payload.decision;
    item.confirmedBy = state.pair.role;
    item.updatedAt = new Date().toISOString();
    addAudit(`${payload.decision} entry`, item.date || `${item.month} toilet ${item.slot}`);
  }
  if (action === 'lockMonth') {
    if (state.pair.role !== 'employer') throw new Error('Only the homeowner can lock a month.');
    const open = [...snap.dailyLogs.filter((x) => x.date?.startsWith(payload.month)), ...snap.toiletLogs.filter((x) => x.month === payload.month)].filter((x) => x.approval !== 'confirmed');
    if (open.length) throw new Error('Resolve all pending or disputed entries before locking the month.');
    const effectivePolicy = policyForMonth(snap.profile, payload.month);
    const calc = calculateMonth({ ...snap, policy: effectivePolicy, month: payload.month });
    const payment = { month: payload.month, baseSalary: effectivePolicy.monthlySalary, adjustment: calc.adjustment, finalPayment: calc.finalPayment, status: 'locked', lockedAt: new Date().toISOString() };
    const index = snap.payments.findIndex((x) => x.month === payload.month);
    if (index >= 0) snap.payments[index] = payment; else snap.payments.push(payment);
    addAudit('Locked month', payload.month);
  }
  if (action === 'acknowledgePayment') {
    if (state.pair.role !== 'worker') throw new Error('Only the worker can acknowledge the payment.');
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
  if (state.draftDirty && state.page === 'today') {
    if (showToast) toast('Save or change the date before syncing. Your edits are still here.', true);
    return;
  }
  state.busy = true;
  render();
  try {
    if (state.pair) {
      state.snapshot = await api('snapshot');
      state.snapshot.syncedAt = new Date().toISOString();
      state.draft = makeDraft();
      state.draftDirty = false;
    } else {
      const data = await api('listPairs');
      state.pairs = data.pairs || [];
    }
    saveStore();
    if (showToast) toast(state.pair ? 'Ledger updated.' : 'People list updated.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

function applyAccountResponse(data, endpoint, mode = 'remote') {
  const account = data.account || {};
  state.auth = { mode, endpoint, token: data.token || state.auth?.token, userId: account.userId, displayName: account.displayName, phone: account.phone };
  state.connection = { mode, endpoint, displayName: account.displayName, phone: account.phone };
  state.pairs = data.pairs || [];
  state.pair = null;
  state.snapshot = null;
  saveStore();
}

async function openPair(pairId) {
  const pair = state.pairs.find((item) => item.pairId === pairId);
  if (!pair) throw new Error('This payroll pair is no longer available.');
  state.pair = pair;
  state.auth.role = pair.role;
  state.snapshot = state.auth.mode === 'demo' ? defaultSnapshot(pair.pairId) : await api('snapshot', { pairId: pair.pairId });
  state.draft = makeDraft();
  state.page = 'month';
  state.openedFromCalendar = false;
  saveStore();
}

function closePair() {
  state.pair = null;
  state.snapshot = null;
  state.draft = null;
  if (state.auth) delete state.auth.role;
  saveStore();
}

function pairCard(pair) {
  return `<button class="pair-card" data-action="open-pair" data-pair-id="${escapeHtml(pair.pairId)}">
    <span class="pair-avatar">${escapeHtml((pair.counterpartName || '?').slice(0, 1).toUpperCase())}</span>
    <span class="pair-copy"><strong>${escapeHtml(pair.counterpartName)}</strong><small>${escapeHtml(pair.counterpartPhone || (pair.pending ? 'Waiting for worker to join' : 'Phone not shown'))}</small></span>
    <span class="pair-arrow">›</span>
  </button>`;
}

function renderHub() {
  const grouped = groupPairs(state.pairs);
  const canSavePersonalBackup = state.auth.mode !== 'demo' && grouped.workingForMe.length > 0;
  const section = (title, items, empty) => `<section class="hub-section"><h2>${title}</h2>${items.length ? `<div class="pair-list">${items.map(pairCard).join('')}</div>` : `<div class="empty-card">${empty}</div>`}</section>`;
  app.innerHTML = `<div class="shell hub-shell"><header class="topbar"><div class="identity"><div class="brand-mark">S</div><div><strong>${escapeHtml(state.auth.displayName || 'SaafHisaab')}</strong><small>${escapeHtml(state.auth.phone || 'Demo account')}</small></div></div><button class="icon-button" data-action="sync" aria-label="Sync">${state.busy ? '…' : '↻'}</button></header>
    <main class="main hub-main"><div class="hub-heading"><div><h1>Your payroll people</h1><p>Choose one person. Only that pair’s records will open.</p></div><button class="secondary compact" data-action="lock-app">Lock</button></div>
    ${section('Working for me', grouped.workingForMe, 'No workers added yet.')}
    ${section('I work for', grouped.iWorkFor, 'No homeowner connections yet.')}
    <details class="card more-details"><summary>Add or join a person <small>Only when you need another payroll connection</small></summary><div class="setup-stack"><h3>Add a worker</h3><p class="card-sub">Creates a separate private payroll pair under your account.</p><form id="createPairForm"><div class="grid-2"><label class="field"><span>Your name for this pair</span><input name="employerName" value="${escapeHtml(state.auth.displayName || '')}" required /></label><label class="field"><span>Worker name</span><input name="workerName" required /></label></div><button class="primary" ${state.busy ? 'disabled' : ''}>Create worker pair</button></form><hr/><h3>Join another homeowner</h3><p class="card-sub">Use the invitation they shared and your existing PIN.</p><form id="joinAnotherForm"><label class="field"><span>Invitation</span><textarea name="invite" rows="3" placeholder="SH1.…" required></textarea></label><label class="field"><span>Your PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label><button class="primary" ${state.busy ? 'disabled' : ''}>Join pair</button></form></div></details>
    <details class="card more-details"><summary>Backup and portability <small>Compact JSON.gz</small></summary><p class="card-sub">The live Sheet and 14 daily recovery copies stay with the service. Your personal export contains only payroll pairs this account may access and excludes PIN hashes, session tokens and joining codes.</p>${canSavePersonalBackup ? '<div class="notice good">On Android, <strong>Save to my Drive</strong> opens the system share sheet. Choose Google Drive and the homeowner Google account. On a browser that cannot share files, SaafHisaab downloads the backup for you to upload.</div>' : ''}<div class="inline-actions"><button class="secondary" data-action="export-data" ${state.auth.mode === 'demo' ? 'disabled' : ''}>Download backup</button>${canSavePersonalBackup ? '<button class="primary" data-action="backup-my-drive">Save to my Drive</button>' : ''}</div></details>
    <button class="danger full-width" data-action="forget-all">Forget this device</button></main></div>`;
}

function base64BackupFile(data) {
  const binary = atob(data.base64), bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], data.fileName, { type: data.mimeType || 'application/gzip' });
}

function downloadBase64File(data) {
  const file = base64BackupFile(data);
  const url = URL.createObjectURL(file);
  const link = document.createElement('a'); link.href = url; link.download = data.fileName; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function nativePlugin(name) {
  const bridge = window.Capacitor;
  if (!bridge?.isNativePlatform?.() || !bridge.registerPlugin) return null;
  return bridge.Plugins?.[name] || bridge.registerPlugin(name);
}

async function saveBackupToPersonalDrive(data) {
  const filesystem = nativePlugin('Filesystem'), share = nativePlugin('Share');
  if (filesystem && share) {
    const path = `backups/${data.fileName}`;
    const saved = await filesystem.writeFile({ path, data: data.base64, directory: 'CACHE', recursive: true });
    const fileUri = saved.uri || (await filesystem.getUri({ path, directory: 'CACHE' })).uri;
    toast('Choose Google Drive and the homeowner account.');
    await share.share({
      title: 'SaafHisaab homeowner backup',
      text: 'Save this compressed SaafHisaab backup to your Google Drive.',
      files: [fileUri],
      dialogTitle: 'Save backup to Google Drive',
    });
    return 'shared';
  }
  const file = base64BackupFile(data);
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    toast('Choose Google Drive and the homeowner account.');
    try {
      await navigator.share({ title: 'SaafHisaab homeowner backup', text: 'Save this compressed SaafHisaab backup to your Google Drive.', files: [file] });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  downloadBase64File(data);
  return 'downloaded';
}

function policy(month = state.selectedMonth) { return policyForMonth(state.snapshot?.profile || {}, month); }

function activitiesForMonth(month = state.selectedMonth) { return activityDefinitions(policy(month)); }
function dailyActivities(month = state.selectedMonth) { return activitiesForMonth(month).filter((item) => item.cadence === 'daily'); }
function flexibleActivities(month = state.selectedMonth) { return activitiesForMonth(month).filter((item) => item.cadence === 'flexible'); }

function calcForMonth(month = state.selectedMonth) {
  const remote = state.snapshot?.monthSummaries?.[month];
  if (remote) return remote;
  return calculateMonth({ dailyLogs: state.snapshot?.dailyLogs || [], toiletLogs: state.snapshot?.toiletLogs || [], policy: policy(month), month });
}

function positionForMonth(month = state.selectedMonth) {
  const remote = state.snapshot?.monthPositions?.[month];
  if (remote) return remote;
  return salaryPosition({
    dailyLogs: state.snapshot?.dailyLogs || [],
    toiletLogs: state.snapshot?.toiletLogs || [],
    policy: policy(month),
    month,
  });
}

function decimalDays(value) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function relativeUpdatedTime() {
  const at = new Date(state.snapshot?.syncedAt || 0).getTime();
  if (!at) return 'Not synced yet';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago` : `Updated ${new Date(at).toLocaleString('en-IN')}`;
}

function renderSalaryCard(month, compact = false) {
  const p = policy(month), position = positionForMonth(month), payment = state.snapshot.payments?.find((item) => item.month === month);
  const confirmedPay = payment?.finalPayment ?? position.confirmed.finalPayment;
  const pending = !payment && position.pendingPossibleAdjustment > 0;
  return `<section class="card live-salary ${compact ? 'compact-card' : ''}">
    <div class="salary-title"><div><span class="eyebrow">${escapeHtml(monthLabel(month))} salary</span><h2>${money(confirmedPay)}</h2><p>Confirmed current pay</p></div><span class="live-dot"><i></i>${payment ? escapeHtml(payment.status) : 'Live'}</span></div>
    <div class="salary-metrics">
      <div><span>Allowance used</span><strong>${decimalDays(position.confirmedEquivalentDays)} / ${decimalDays(position.allowanceDays)} days</strong></div>
      <div><span>Allowance remaining</span><strong>${decimalDays(position.remainingAllowanceDays)} days</strong></div>
      <div><span>Confirmed adjustment</span><strong>${position.confirmed.adjustment ? `− ${money(position.confirmed.adjustment)}` : money(0)}</strong></div>
      <div><span>Pending possible impact</span><strong class="${pending ? 'warning-text' : ''}">${pending ? `− ${money(position.pendingPossibleAdjustment)}` : money(0)}</strong></div>
    </div>
    ${pending ? `<div class="projection"><span>If pending items are confirmed</span><strong>${money(position.projected.finalPayment)}</strong></div>` : '<div class="projection settled"><span>No pending salary impact</span><strong>✓</strong></div>'}
    <p class="salary-foot">Pending entries never change confirmed pay until the other person approves them. · ${escapeHtml(relativeUpdatedTime())}</p>
  </section>`;
}

function renderMonthCalendar() {
  const [year, month] = state.selectedMonth.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const first = new Date(year, month - 1, 1).getDay();
  const logs = state.snapshot.dailyLogs.filter((item) => item.date?.startsWith(state.selectedMonth));
  const cells = Array.from({ length: first }, () => '<span class="calendar-day blank"></span>');
  for (let day = 1; day <= days; day += 1) {
    const date = `${state.selectedMonth}-${String(day).padStart(2, '0')}`;
    const log = logs.find((item) => item.date === date);
    let status = 'empty', label = 'No record';
    if (log?.approval === 'disputed') { status = 'disputed'; label = 'Disputed'; }
    else if (log?.approval === 'pending') { status = 'pending'; label = 'Pending'; }
    else if (log?.leave === 'full' || log?.leave === 'half') { status = 'leave'; label = log.leave === 'full' ? 'Full leave' : 'Half leave'; }
    else if (log && dailyActivities(state.selectedMonth).some((activity) => (log.activityOutcomes?.[activity.id] ?? log.tasks?.[activity.id]) === 'missed')) { status = 'missed'; label = 'Missed activity'; }
    else if (log) { status = 'done'; label = 'Completed'; }
    const marker = status === 'done' ? '✓' : status === 'pending' ? '…' : status === 'leave' ? 'L' : status === 'missed' ? '!' : status === 'disputed' ? '?' : '';
    cells.push(`<button class="calendar-day ${status}" data-calendar-date="${date}" title="${escapeHtml(label)}" aria-label="${escapeHtml(`${prettyDate(date)}: ${label}`)}"><span>${day}</span><i aria-hidden="true">${marker}</i></button>`);
  }
  return `<section class="card"><div class="calendar-head"><div><h2>Workday calendar</h2><p class="card-sub">Tap any day to mark work, missed activities or leave.</p></div><div class="calendar-legend"><span class="done">Done</span><span class="pending">Pending</span><span class="missed">Miss/leave</span></div></div><div class="calendar-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-grid">${cells.join('')}</div></section>`;
}

function renderAuth() {
  const unlock = state.connection;
  let body = '';
  if (unlock) {
    body = `<form id="unlockForm" class="card">
      <h2>Unlock ${escapeHtml(unlock.displayName || 'SaafHisaab')}</h2>
      <p class="card-sub">Use your phone number and PIN to reopen all your payroll pairings.</p>
      ${unlock.mode === 'demo' ? '' : `<label class="field"><span>Phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="9876543210 or +919876543210" value="${escapeHtml(unlock.phone || '')}" required /></label>`}
      <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" autocomplete="current-password" required /></label>
      <button class="primary" ${state.busy ? 'disabled' : ''}>Unlock</button>
      <button type="button" class="link-button" data-action="forget-connection">Use a different account</button>
    </form>`;
  } else if (state.authTab === 'login') {
    const serviceReady = serviceIsReady();
    body = `<form id="loginForm" class="card">
      <h2>Login to SaafHisaab</h2>
      <p class="card-sub">One phone number opens everyone working for you and everyone you work for. No OTP or SMS is sent.</p>
      ${serviceReady ? '' : '<div class="notice">This installation has not been connected to the SaafHisaab service. Please use the official configured APK or website.</div>'}
      <label class="field"><span>Phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="9876543210 or +919876543210" required /></label>
      <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" autocomplete="current-password" required /></label>
      <button class="primary" ${state.busy || !serviceReady ? 'disabled' : ''}>Login</button>
    </form>`;
  } else if (state.authTab === 'employer') {
    const serviceReady = serviceIsReady();
    body = `<form id="employerSetupForm" class="card">
      <h2>Create homeowner account</h2>
      <p class="card-sub">Use the private owner setup code supplied by the SaafHisaab administrator.</p>
      ${serviceReady ? '' : '<div class="notice">Account creation is unavailable because this installation has not been connected to the SaafHisaab service.</div>'}
      <label class="field"><span>Owner setup code</span><input name="setupCode" autocomplete="off" required /></label>
      <div class="grid-2"><label class="field"><span>Homeowner name</span><input name="employerName" autocomplete="name" required /></label><label class="field"><span>Worker name</span><input name="workerName" required /></label></div>
      <label class="field"><span>Homeowner phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="9876543210 or +919876543210" required /></label>
      <label class="field"><span>Create homeowner PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label>
      <button class="primary" ${state.busy || !serviceReady ? 'disabled' : ''}>Create account</button>
    </form>`;
  } else if (state.authTab === 'worker') {
    body = `<form id="workerJoinForm" class="card">
      <h2>Join the homeowner’s ledger</h2>
      <p class="card-sub">Paste the invitation shared by the homeowner.</p>
      <label class="field"><span>Invitation</span><textarea name="invite" rows="4" placeholder="SH1.…" required></textarea></label>
      <label class="field"><span>Worker phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="9876543210 or +919876543210" required /></label>
      <label class="field"><span>Create worker PIN</span><input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label>
      <button class="primary" ${state.busy ? 'disabled' : ''}>Join household</button>
    </form>`;
  } else {
    body = `<div class="card"><h2>Try without Google Sheets</h2><p class="card-sub">Demo data stays on this phone. You can switch between homeowner and worker to test confirmations.</p><button class="primary" data-action="start-demo">Open demo</button></div>`;
  }
  const choices = !unlock ? `<div class="auth-choices">${state.authTab !== 'login' ? '<button class="link-button" data-auth-tab="login">← Back to login</button>' : '<span>First time?</span><button class="link-button" data-auth-tab="employer">Create homeowner account</button><button class="link-button" data-auth-tab="worker">Join invitation</button><button class="link-button" data-auth-tab="demo">Try demo</button>'}</div>` : '';
  app.innerHTML = `<main class="auth-shell"><div class="auth-wrap"><div class="auth-brand"><div class="brand-mark">S</div><h1>SaafHisaab</h1><p>Update leaves. Calculate salary clearly.</p></div>${body}${choices}<p class="helper-text right">The service database stays private in the deployment owner’s Google account.</p></div></main>`;
}

function header() {
  const profile = state.snapshot.profile;
  const display = state.pair.role === 'employer' ? profile.workerName : profile.employerName;
  return `<header class="topbar"><div class="identity"><button class="back-button" data-action="back-to-hub" aria-label="Back to people">‹</button><div><strong>${escapeHtml(display)}</strong><small>${roleName()} · ${state.auth.mode === 'demo' ? 'Demo on this phone' : 'Google Sheet connected'}</small></div></div><button class="icon-button" data-action="sync" aria-label="Sync">${state.busy ? '…' : '↻'}</button></header>`;
}

function nav() {
  return `<nav class="bottom-nav">
    ${[['month','▦','Calendar'],['today','✓','Day'],['activity','≡','Activity'],['account','⚙','Account']].map(([id, icon, label]) => `<button class="nav-item ${state.page === id ? 'active' : ''}" data-page="${id}"><span>${icon}</span>${label}</button>`).join('')}
  </nav>`;
}

function renderToday() {
  if (state.pair.role === 'worker') return renderWorkerToday();
  const draft = state.draft || makeDraft();
  const locked = state.snapshot.payments?.some((x) => x.month === draft.date.slice(0, 7) && x.status);
  const outsideExpense = (state.snapshot.expenses || []).find((item) => item.category === 'outside_food' && item.linkedLeaveDate === draft.date);
  const detailsOpen = Boolean(draft.arrivalTime || draft.departureTime || draft.calls || draft.messages || draft.note || outsideExpense);
  const activities = dailyActivities(draft.date.slice(0, 7));
  const missedCount = activities.filter((activity) => draft.activityOutcomes?.[activity.id] === 'missed').length;
  return `${state.openedFromCalendar ? '<button class="context-back" data-action="back-to-calendar">← Back to calendar</button>' : ''}<div class="page-head"><div><h1>${escapeHtml(prettyDate(state.selectedDate))}</h1><p>Normal workday: one tap. Mark only exceptions.</p></div><input class="date-input" id="selectedDate" type="date" value="${escapeHtml(state.selectedDate)}" /></div>
    ${renderSalaryCard(draft.date.slice(0, 7), true)}
    ${locked ? '<div class="notice">This month is locked. Existing records cannot be changed.</div>' : ''}
    <form id="dailyForm">
      <section class="card quick-day"><div class="quick-icon">✓</div><div><h2>Everything completed?</h2><p class="card-sub">Marks every daily function in this worker’s ${escapeHtml(policy(draft.date.slice(0, 7)).jobProfileName || 'job profile')} as completed.</p></div><button type="button" class="primary" data-action="quick-complete-day" ${locked || state.busy ? 'disabled' : ''}>Everything completed today</button>
      </section>
      <section class="card"><div class="exception-head"><div><h2>Leave or exceptions</h2><p class="card-sub">All activities start as completed. Change only what did not happen.</p></div>${missedCount ? `<span class="exception-count">${missedCount} missed</span>` : '<span class="status-pill confirmed">Normal day</span>'}</div>
        <div class="grid-2"><label class="field"><span>Leave for this day</span><select name="leave" id="leaveSelect"><option value="none" ${draft.leave === 'none' ? 'selected' : ''}>No leave</option><option value="half" ${draft.leave === 'half' ? 'selected' : ''}>Half-day leave</option><option value="full" ${draft.leave === 'full' ? 'selected' : ''}>Full-day leave</option></select></label><label class="field"><span>Notice given</span><select name="leaveNotice" ${draft.leave === 'none' ? 'disabled' : ''}><option value="" ${!draft.leaveNotice ? 'selected' : ''}>Not classified</option><option value="planned" ${draft.leaveNotice === 'planned' ? 'selected' : ''}>Planned / informed well</option><option value="last_minute" ${draft.leaveNotice === 'last_minute' ? 'selected' : ''}>Last-minute informed</option><option value="no_contact" ${draft.leaveNotice === 'no_contact' ? 'selected' : ''}>No update / no response</option></select></label></div>
        <div class="task-list">
        ${activities.map((activity) => taskControl(activity.id, activity.label, draft.activityOutcomes?.[activity.id] || 'done', draft.leave !== 'none')).join('')}
        </div><p class="helper-text">These functions come from the versioned job profile. Change the profile from Account → Agreement and job functions.</p>
        <button class="primary" ${locked || state.busy ? 'disabled' : ''}>Save leave or exceptions</button>
      </section>
      <details class="card more-details" ${detailsOpen ? 'open' : ''}><summary>More details <small>Time, contact attempts and note</small></summary><p class="card-sub">Optional evidence only. These fields do not directly change salary.</p>
        <div class="grid-2"><label class="field"><span>Arrived</span><input name="arrivalTime" type="time" value="${escapeHtml(draft.arrivalTime)}" /></label><label class="field"><span>Left</span><input name="departureTime" type="time" value="${escapeHtml(draft.departureTime)}" /></label></div>
        <div class="grid-2"><label class="field"><span>Calls made</span><input name="calls" type="number" min="0" max="99" value="${Number(draft.calls || 0)}" /></label><label class="field"><span>Messages sent</span><input name="messages" type="number" min="0" max="99" value="${Number(draft.messages || 0)}" /></label></div>
        <label class="field"><span>Note</span><textarea name="note" rows="3" placeholder="Optional clarification">${escapeHtml(draft.note || '')}</textarea></label>
        <div class="subsection"><h3>Outside food because of this leave</h3><p class="card-sub">Private household accounting. It does not reduce salary.</p><input type="hidden" name="outsideExpenseId" value="${escapeHtml(outsideExpense?.id || '')}" /><div class="grid-2"><label class="field"><span>Amount paid</span><input name="outsideFoodAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(outsideExpense?.amount || '')}" placeholder="0" /></label><label class="field"><span>Restaurant / shop</span><input name="outsideFoodVendor" maxlength="100" value="${escapeHtml(outsideExpense?.vendor || '')}" placeholder="Optional" /></label></div><label class="field"><span>What was ordered?</span><input name="outsideFoodNote" maxlength="300" value="${escapeHtml(outsideExpense?.note || '')}" placeholder="Optional" /></label></div>
      </details>
    </form>`;
}

function leaveNoticeLabel(value) {
  return value === 'planned' ? 'Planned / informed well' : value === 'last_minute' ? 'Last-minute informed' : value === 'no_contact' ? 'No update / no response' : 'Not classified';
}

function renderWorkerToday() {
  const log = state.snapshot.dailyLogs.find((item) => item.date === state.selectedDate);
  const requests = (state.snapshot.requests || []).filter((item) => item.date === state.selectedDate).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const locked = state.snapshot.payments?.some((item) => item.month === state.selectedDate.slice(0, 7) && item.status);
  return `${state.openedFromCalendar ? '<button class="context-back" data-action="back-to-calendar">← Back to calendar</button>' : ''}<div class="page-head"><div><h1>${escapeHtml(prettyDate(state.selectedDate))}</h1><p>Your payroll ledger is read-only. Request leave or ask the homeowner to correct a record.</p></div><input class="date-input" id="selectedDate" type="date" value="${escapeHtml(state.selectedDate)}" /></div>
    ${renderSalaryCard(state.selectedDate.slice(0, 7), true)}
    <section class="card"><h2>Agreed record for this date</h2>${log ? `<div class="list-row"><div><strong>${escapeHtml(dailyDetail(log))}</strong><small>Recorded by ${escapeHtml(roleName(log.createdBy))}</small></div>${approvalPill(log.approval)}</div>` : '<div class="empty">No payroll record has been added for this date.</div>'}</section>
    <section class="card"><h2>Request leave or a correction</h2><p class="card-sub">This does not change salary. It stays pending until the homeowner accepts it.</p>${locked ? '<div class="notice">This month is locked, so new requests are closed.</div>' : `<form id="workerRequestForm"><div class="grid-2"><label class="field"><span>Leave duration</span><select name="leave" required><option value="full">Full day</option><option value="half">Half day</option></select></label><label class="field"><span>Notice</span><select name="leaveNotice" required><option value="planned">Planned / informed well</option><option value="last_minute">Last-minute informed</option></select></label></div><label class="field"><span>Message to homeowner</span><textarea name="note" rows="3" placeholder="Optional reason or correction details"></textarea></label><button class="primary" ${state.busy ? 'disabled' : ''}>Send request</button></form>`}</section>
    <section class="card"><h2>Requests for this date</h2>${requests.length ? requests.map((item) => `<div class="list-row"><div><strong>${item.leave === 'half' ? 'Half-day' : 'Full-day'} leave</strong><small>${escapeHtml(leaveNoticeLabel(item.leaveNotice))}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>${approvalPill(item.status)}</div>`).join('') : '<div class="empty">No requests sent for this date.</div>'}</section>`;
}

function taskControl(key, label, value, disabled) {
  return `<div class="task-row" data-task-row="${key}"><strong>${escapeHtml(label)}</strong><div class="segments">
    <button type="button" class="segment done ${value === 'done' ? 'active' : ''}" data-task="${key}" data-outcome="done" aria-pressed="${value === 'done'}" ${disabled ? 'disabled' : ''}>✓ Done</button>
    <button type="button" class="segment missed ${value === 'missed' ? 'active' : ''}" data-task="${key}" data-outcome="missed" aria-pressed="${value === 'missed'}" ${disabled ? 'disabled' : ''}>✕ Missed</button>
    <button type="button" class="segment skip ${['not_required','cancelled'].includes(value) ? 'active' : ''}" data-task="${key}" data-outcome="not_required" aria-pressed="${['not_required','cancelled'].includes(value)}" ${disabled ? 'disabled' : ''}>— N/A</button>
  </div></div>`;
}

function renderBulkLeave() {
  if (state.pair.role !== 'employer') return '';
  const [year, month] = state.selectedMonth.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const locked = state.snapshot.payments?.some((item) => item.month === state.selectedMonth && item.status);
  const choices = Array.from({ length: days }, (_, index) => {
    const day = index + 1, date = `${state.selectedMonth}-${String(day).padStart(2, '0')}`;
    const existing = state.snapshot.dailyLogs.find((item) => item.date === date);
    return `<label class="bulk-day ${existing ? 'has-record' : ''}" title="${escapeHtml(existing ? dailyDetail(existing) : 'No record')}"><input type="checkbox" name="dates" value="${date}" ${locked ? 'disabled' : ''}/><span>${day}</span><small>${new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))}</small></label>`;
  }).join('');
  return `<details class="card more-details"><summary>Add multiple leaves <small>Select every date once</small></summary><p class="card-sub">Useful when several leave dates are known together. Existing entries are visibly marked; saving replaces only homeowner-created entries for the selected dates.</p>${locked ? '<div class="notice">This month is locked.</div>' : `<form id="bulkLeaveForm"><div class="bulk-day-grid">${choices}</div><div class="grid-2"><label class="field"><span>Leave duration</span><select name="leave" required><option value="full">Full day</option><option value="half">Half day</option></select></label><label class="field"><span>Notice</span><select name="leaveNotice" required><option value="planned">Planned / informed well</option><option value="last_minute">Last-minute informed</option><option value="no_contact">No update / no response</option></select></label></div><label class="field"><span>Note for all selected dates</span><input name="note" maxlength="500" placeholder="Optional" /></label><button class="primary" ${state.busy ? 'disabled' : ''}>Save selected leaves</button></form>`}</details>`;
}

function renderMonth() {
  const p = policy();
  const calc = calcForMonth();
  const missed = missedActivityRows(state.snapshot.dailyLogs, state.snapshot.toiletLogs, state.selectedMonth, p);
  const categories = categoryTotals(p);
  const payment = state.snapshot.payments?.find((x) => x.month === state.selectedMonth);
  const openCount = [...state.snapshot.dailyLogs.filter((x) => x.date?.startsWith(state.selectedMonth)), ...state.snapshot.toiletLogs.filter((x) => x.month === state.selectedMonth)].filter((x) => x.approval !== 'confirmed').length + (state.snapshot.requests || []).filter((x) => x.date?.startsWith(state.selectedMonth) && x.status === 'pending').length;
  return `<div class="page-head"><div><h1>${escapeHtml(monthLabel(state.selectedMonth))}</h1><p>Agreement, missed activities and final payment.</p></div><input class="month-input" id="selectedMonth" type="month" value="${escapeHtml(state.selectedMonth)}" /></div>
    ${renderSalaryCard(state.selectedMonth)}
    ${renderMonthCalendar()}
    ${renderBulkLeave()}
    <section class="card"><h2>${escapeHtml(p.jobProfileName || 'Worker')} agreement</h2><p class="card-sub">These category amounts are visible to both people. Individual function rates are not shown to the worker.</p><div class="agreement">
      ${Object.entries(categories).map(([category, amount]) => `<div class="agreement-row"><div><strong>${escapeHtml(category)}</strong><small>${activityDefinitions(p).filter((item) => item.category === category).map((item) => escapeHtml(item.label)).join(' · ')}</small></div><span class="amount">${money(amount)}</span></div>`).join('')}
      <div class="agreement-row total"><div><strong>Monthly salary</strong><small>${decimalDays(p.paidLeaveDays)} paid leave-equivalent days allowed</small></div><span class="amount">${money(p.monthlySalary)}</span></div>
    </div></section>
    <section class="card"><h2>Leave and missed activities</h2><p class="card-sub">${openCount ? `${openCount} item${openCount === 1 ? '' : 's'} still need review.` : 'All recorded items have been reviewed.'}</p><div class="missed-list">
      ${missed.length ? missed.map((row) => `<div class="list-row"><div><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(prettyDate(row.date))}</small></div>${approvalPill(row.approval)}</div>`).join('') : '<div class="empty">No leave or missed activities recorded for this month.</div>'}
    </div></section>
    ${state.pair.role === 'employer' ? renderFlexibleActivitySlots() : flexibleActivities().length ? '<section class="card"><h2>Flexible job functions</h2><p class="card-sub">The homeowner records flexible monthly functions. You can see missed items above and all entries in Activity.</p></section>' : ''}
    <section class="card"><h2>Finalize payment</h2><p class="card-sub">Individual task amounts remain combined. A month can be locked only after every record is confirmed.</p>
      <div class="notice ${openCount ? '' : 'good'}">${openCount ? `${openCount} unresolved item${openCount === 1 ? '' : 's'} before this month can be locked.` : `Ready to finalize at ${money(payment?.finalPayment ?? calc.finalPayment)}.`}</div>
      <button class="secondary" data-action="share-month">Share monthly summary</button>
      ${state.pair.role === 'employer' && !payment ? `<button class="primary" data-action="lock-month" ${openCount || state.busy ? 'disabled' : ''}>Lock final payment</button>` : ''}
      ${state.pair.role === 'worker' && payment?.status === 'locked' ? `<button class="primary" data-action="ack-payment">Confirm payment amount</button>` : ''}
    </section>
    ${state.pair.role === 'employer' ? renderEmployerAudit(calc) : ''}`;
}

function monthlySummaryText() {
  const p = policy();
  const categories = categoryTotals(p);
  const calc = calcForMonth();
  const position = positionForMonth();
  const payment = state.snapshot.payments?.find((item) => item.month === state.selectedMonth);
  const missed = missedActivityRows(state.snapshot.dailyLogs, state.snapshot.toiletLogs, state.selectedMonth, p);
  const activityLines = missed.length
    ? missed.map((row) => `- ${prettyDate(row.date)}: ${row.label} (${String(row.approval || 'pending').replace('_', ' ')})`)
    : ['- None recorded'];
  return [
    `SaafHisaab — ${monthLabel(state.selectedMonth)}`,
    '',
    ...Object.entries(categories).map(([category, amount]) => `${category}: ${money(amount)}`),
    `Monthly salary: ${money(p.monthlySalary)}`,
    '',
    'Leave and missed activities:',
    ...activityLines,
    '',
    `Confirmed adjustment: ${calc.adjustment ? `- ${money(calc.adjustment)}` : money(0)}`,
    `Final payment: ${money(payment?.finalPayment ?? calc.finalPayment)}`,
    ...(position.pendingPossibleAdjustment && !payment ? [`Pending possible adjustment: - ${money(position.pendingPossibleAdjustment)}`, `If pending items are confirmed: ${money(position.projected.finalPayment)}`] : []),
    `Status: ${payment?.status || 'Open month'}`,
  ].join('\n');
}

function flexibleWindow(slot, count) {
  if (count === 4) return ['1–7', '8–14', '15–21', '22–month end'][slot - 1];
  return `Occurrence ${slot} of ${count}`;
}

function renderFlexibleActivitySlots() {
  const logs = state.snapshot.toiletLogs.filter((x) => x.month === state.selectedMonth);
  const payment = state.snapshot.payments?.find((x) => x.month === state.selectedMonth);
  const activities = flexibleActivities();
  if (!activities.length) return '';
  return activities.map((activity) => {
    const count = Math.max(1, Number(activity.expectedPerMonth || 1));
    return `<section class="card"><h2>${escapeHtml(activity.label)}</h2><p class="card-sub">${count} flexible monthly occurrence${count === 1 ? '' : 's'}. Record the actual completion date.</p><div class="toilet-grid">
      ${Array.from({ length: count }, (_, index) => index + 1).map((slot) => {
        const log = logs.find((x) => (x.activityId || 'toiletCleaning') === activity.id && Number(x.slot) === slot) || { id: uid('flex'), month: state.selectedMonth, activityId: activity.id, activityLabel: activity.label, slot, outcome: 'pending', completedDate: '' };
        const controlId = `${activity.id}-${slot}`;
        return `<div class="toilet-slot"><strong>${escapeHtml(activity.label)} ${slot}</strong><small>${escapeHtml(flexibleWindow(slot, count))}</small><select data-flex-outcome="${escapeHtml(controlId)}" ${payment ? 'disabled' : ''}><option value="pending" ${log.outcome === 'pending' ? 'selected' : ''}>Not logged</option><option value="done" ${log.outcome === 'done' ? 'selected' : ''}>Completed</option><option value="missed" ${log.outcome === 'missed' ? 'selected' : ''}>Missed</option><option value="not_required" ${log.outcome === 'not_required' ? 'selected' : ''}>Not required</option><option value="cancelled" ${log.outcome === 'cancelled' ? 'selected' : ''}>Household cancelled</option></select><label class="field"><span>Completed date</span><input data-flex-date="${escapeHtml(controlId)}" type="date" value="${escapeHtml(log.completedDate || '')}" ${payment ? 'disabled' : ''}/></label><button class="secondary" style="width:100%" data-action="save-flexible" data-activity-id="${escapeHtml(activity.id)}" data-activity-label="${escapeHtml(activity.label)}" data-slot="${slot}" data-id="${escapeHtml(log.id)}" ${payment ? 'disabled' : ''}>Save</button>${log.approval ? `<div style="margin-top:9px">${approvalPill(log.approval)}</div>` : ''}</div>`;
      }).join('')}
    </div></section>`;
  }).join('');
}

function renderEmployerAudit(calc) {
  const r = calc.rates || {};
  return `<section class="card"><h2>Homeowner calculation audit</h2><p class="card-sub">This panel is hidden from the worker. The worker sees the activity history and one combined adjustment.</p><details class="audit"><summary>Show internal rates and calculation</summary>
    <table class="audit-table"><thead><tr><th>Internal rate</th><th>Amount</th></tr></thead><tbody>
      <tr><td>Full day</td><td>${money(r.daily)}</td></tr>${activityDefinitions(policy()).map((activity) => `<tr><td>${escapeHtml(activity.label)}</td><td>${money(r.byActivity?.[activity.id] || 0)}</td></tr>`).join('')}
    </tbody></table>
    <table class="audit-table"><thead><tr><th>Confirmed item</th><th>Internal value</th></tr></thead><tbody>${(calc.audit || []).map((x) => `<tr><td>${escapeHtml(x.date)} · ${escapeHtml(x.label)}</td><td>${money(x.value)}</td></tr>`).join('') || '<tr><td colspan="2">No confirmed absence value.</td></tr>'}</tbody></table>
    <div class="payment-line" style="color:var(--ink)"><span>Allowance</span><strong>${money(calc.allowance)}</strong></div><div class="payment-line" style="color:var(--ink)"><span>Used value</span><strong>${money(calc.usedValue)}</strong></div>
  </details></section>`;
}

function renderExpenseLedger() {
  const expenses = (state.snapshot.expenses || []).filter((item) => item.date?.startsWith(state.selectedMonth)).sort((a, b) => b.date.localeCompare(a.date));
  const totals = expenses.reduce((result, item) => {
    result.total += Number(item.amount || 0);
    result[item.category] = (result[item.category] || 0) + Number(item.amount || 0);
    return result;
  }, { total: 0 });
  const categoryLabel = (value) => value === 'outside_food' ? 'Outside food' : value === 'groceries' ? 'Groceries' : 'Other household';
  return `<section class="card"><div class="calendar-head"><div><h2>Household expenses</h2><p class="card-sub">Private to the homeowner. These costs never change worker salary.</p></div><strong>${money(totals.total)}</strong></div>
    <div class="expense-summary"><span>Outside food <strong>${money(totals.outside_food || 0)}</strong></span><span>Groceries <strong>${money(totals.groceries || 0)}</strong></span><span>Other <strong>${money(totals.other || 0)}</strong></span></div>
    <form id="expenseForm"><div class="grid-2"><label class="field"><span>Date</span><input name="date" type="date" value="${escapeHtml(state.selectedDate)}" required /></label><label class="field"><span>Type</span><select name="category"><option value="outside_food">Outside food because work was missed</option><option value="groceries">Groceries</option><option value="other">Other household expense</option></select></label></div><div class="grid-2"><label class="field"><span>Amount paid</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required /></label><label class="field"><span>Shop / restaurant</span><input name="vendor" maxlength="100" placeholder="Optional" /></label></div><label class="field"><span>Related leave date</span><input name="linkedLeaveDate" type="date" /></label><label class="field"><span>Note</span><input name="note" maxlength="300" placeholder="What was ordered or bought?" /></label><button class="primary" ${state.busy ? 'disabled' : ''}>Add expense</button></form>
    <div class="ledger-list expense-list">${expenses.length ? expenses.map((item) => `<div class="list-row"><div><strong>${escapeHtml(categoryLabel(item.category))} · ${escapeHtml(prettyDate(item.date))}</strong><small>${escapeHtml([item.vendor, item.note, item.linkedLeaveDate ? `Leave ${prettyDate(item.linkedLeaveDate)}` : ''].filter(Boolean).join(' · '))}</small></div><span class="amount">${money(item.amount)}</span></div>`).join('') : '<div class="empty">No household expenses recorded for this month.</div>'}</div>
  </section>`;
}

function renderActivity() {
  const daily = [...state.snapshot.dailyLogs].sort((a, b) => b.date.localeCompare(a.date));
  const toilet = [...state.snapshot.toiletLogs].sort((a, b) => `${b.month}-${b.slot}`.localeCompare(`${a.month}-${a.slot}`));
  const rows = [
    ...daily.map((x) => ({ entity: 'daily', id: x.id, title: prettyDate(x.date), detail: dailyDetail(x), ...x })),
    ...toilet.map((x) => ({ entity: 'toilet', id: x.id, title: `${monthLabel(x.month)} · ${x.activityLabel || 'Toilet cleaning'} ${x.slot}`, detail: OUTCOMES[x.outcome] || x.outcome, ...x })),
  ].sort((a, b) => String(b.updatedAt || b.date || b.month).localeCompare(String(a.updatedAt || a.date || a.month)));
  const requests = [...(state.snapshot.requests || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return `<div class="page-head"><div><h1>Activity ledger</h1><p>Both people see payroll records; household expenses stay homeowner-only.</p></div></div>
    ${state.pair.role === 'employer' ? renderExpenseLedger() : ''}
    <section class="card"><h2>Worker requests</h2><p class="card-sub">Requests do not affect salary until the homeowner accepts them.</p><div class="ledger-list">${requests.length ? requests.map((x) => `<div class="list-row"><div><strong>${escapeHtml(prettyDate(x.date))} · ${x.leave === 'half' ? 'Half-day' : 'Full-day'} leave</strong><small>${escapeHtml(leaveNoticeLabel(x.leaveNotice))}${x.note ? ` · ${escapeHtml(x.note)}` : ''}</small>${state.pair.role === 'employer' && x.status === 'pending' ? `<div class="inline-actions" style="margin-top:10px"><button class="secondary" data-action="review-request" data-id="${escapeHtml(x.id)}" data-decision="accepted">Accept</button><button class="danger" data-action="review-request" data-id="${escapeHtml(x.id)}" data-decision="declined">Decline</button></div>` : ''}</div>${approvalPill(x.status)}</div>`).join('') : '<div class="empty">No worker requests yet.</div>'}</div></section>
    <section class="card"><h2>Payroll records</h2><div class="ledger-list">
    ${rows.length ? rows.map((x) => `<div class="list-row"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.detail)}</small><small>Recorded by ${escapeHtml(roleName(x.createdBy))}</small>${x.approval === 'pending' && x.createdBy !== state.pair.role ? `<div class="inline-actions" style="margin-top:10px"><button class="secondary" data-action="review" data-entity="${x.entity}" data-id="${x.id}" data-decision="confirmed">Confirm</button><button class="danger" data-action="review" data-entity="${x.entity}" data-id="${x.id}" data-decision="disputed">Dispute</button></div>` : ''}</div>${approvalPill(x.approval)}</div>`).join('') : '<div class="empty">No records yet.</div>'}
  </div></section>`;
}

function dailyDetail(log) {
  if (log.leave === 'full') return `Full-day leave · ${leaveNoticeLabel(log.leaveNotice)}`;
  if (log.leave === 'half') return `Half-day leave · ${leaveNoticeLabel(log.leaveNotice)}`;
  const activities = dailyActivities(String(log.date || state.selectedDate).slice(0, 7));
  const done = activities.filter((activity) => (log.activityOutcomes?.[activity.id] ?? log.tasks?.[activity.id]) === 'done').length;
  const missed = activities.filter((activity) => (log.activityOutcomes?.[activity.id] ?? log.tasks?.[activity.id]) === 'missed').length;
  return `${done} completed · ${missed} missed${log.arrivalTime ? ` · arrived ${log.arrivalTime}` : ''}${log.departureTime ? ` · left ${log.departureTime}` : ''}`;
}

function readPolicyDraft() {
  const form = document.querySelector('#policyForm');
  if (!form) return state.policyDraft;
  const data = new FormData(form);
  const ids = data.getAll('activityId');
  return {
    effectiveMonth: data.get('effectiveMonth'),
    jobProfileName: data.get('jobProfileName') || 'Worker',
    workingDays: Number(data.get('workingDays')),
    paidLeaveDays: Number(data.get('paidLeaveDays')),
    activities: ids.map((id, index) => ({
      id,
      label: data.getAll('activityLabel')[index],
      category: data.getAll('activityCategory')[index],
      cadence: data.getAll('activityCadence')[index],
      monthlyAmount: Number(data.getAll('activityAmount')[index]),
      expectedPerMonth: Number(data.getAll('activityExpected')[index] || 1),
    })),
  };
}

function renderPolicyEditor(currentPolicy) {
  const draft = state.policyDraft || { effectiveMonth: state.selectedMonth, ...structuredClone(currentPolicy) };
  const activities = activityDefinitions(draft);
  const total = activities.reduce((sum, activity) => sum + Number(activity.monthlyAmount || 0), 0);
  return `<section class="card"><h2>Agreement and job functions</h2><p class="card-sub">Build any role from functions. Each version applies from its effective month; workers see names and category totals, not private per-function rates.</p><form id="policyForm"><div class="grid-2"><label class="field"><span>Effective from</span><input name="effectiveMonth" type="month" value="${escapeHtml(draft.effectiveMonth || state.selectedMonth)}" required /></label><label class="field"><span>Job profile name</span><input name="jobProfileName" maxlength="80" value="${escapeHtml(draft.jobProfileName || 'Worker')}" placeholder="Cook, cleaner, driver, nanny…" required /></label></div><div class="grid-2"><label class="field"><span>Working days / month</span><input name="workingDays" type="number" min="1" max="31" value="${draft.workingDays}" required /></label><label class="field"><span>Paid leave days</span><input name="paidLeaveDays" type="number" min="0" max="31" step="0.5" value="${draft.paidLeaveDays}" required /></label></div>
    <div class="function-editor"><div class="section-title-row"><div><h3>Job functions</h3><p class="card-sub">Daily functions appear on every workday. Flexible functions get a chosen number of monthly occurrences.</p></div><button type="button" class="secondary compact" data-action="add-job-function">+ Add function</button></div>${activities.map((activity, index) => `<div class="function-row"><input type="hidden" name="activityId" value="${escapeHtml(activity.id)}" /><label class="field"><span>Function</span><input name="activityLabel" maxlength="80" value="${escapeHtml(activity.label)}" required /></label><label class="field"><span>Category</span><input name="activityCategory" maxlength="60" value="${escapeHtml(activity.category)}" required /></label><label class="field"><span>Schedule</span><select name="activityCadence" data-policy-cadence="${index}"><option value="daily" ${activity.cadence === 'daily' ? 'selected' : ''}>Every workday</option><option value="flexible" ${activity.cadence === 'flexible' ? 'selected' : ''}>Flexible times/month</option></select></label><label class="field"><span>Times / month</span><input name="activityExpected" type="number" min="1" max="93" value="${activity.cadence === 'daily' ? draft.workingDays : activity.expectedPerMonth}" ${activity.cadence === 'daily' ? 'readonly' : ''} required /></label><label class="field"><span>Monthly allocation</span><input name="activityAmount" type="number" min="0" step="0.01" value="${activity.monthlyAmount}" required /></label><button type="button" class="danger compact" data-action="remove-job-function" data-index="${index}" ${activities.length === 1 ? 'disabled' : ''}>Remove</button></div>`).join('')}</div>
    <div class="notice good">Monthly salary from all functions: <strong>${money(total)}</strong>.</div><button class="primary" ${state.busy ? 'disabled' : ''}>Save agreement version</button></form><p class="helper-text">Hourly payroll remains disabled until overtime, breaks, rounding and paid-leave-hour rules are defined. A per-activity profile is fully supported here.</p></section>`;
}

function renderAccount() {
  const profile = state.snapshot.profile;
  const p = policy(state.selectedMonth);
  const invite = state.pair.role === 'employer' && state.auth.mode !== 'demo' && profile.joinCode ? inviteEncode({ endpoint: state.auth.endpoint, householdId: profile.householdId, joinCode: profile.joinCode }) : '';
  return `<div class="page-head"><div><h1>Account</h1><p>Connection, access and device controls.</p></div></div>
    <section class="card"><h2>${escapeHtml(profile.employerName)} and ${escapeHtml(profile.workerName)}</h2><p class="card-sub">Pair ID: ${escapeHtml(profile.householdId)}${state.auth.phone ? ` · Login: ${escapeHtml(state.auth.phone)}` : ''}</p><div class="notice good">${state.auth.mode === 'demo' ? 'Demo data is stored only on this phone.' : 'This pair is isolated inside the deployment owner’s private Google Sheet database.'}</div><button class="secondary full-width" data-action="back-to-hub">Back to all people</button></section>
    ${invite ? `<section class="card"><h2>Worker invitation</h2><p class="card-sub">Share this once with the worker. It contains the service address and one-time joining code, not your PIN.</p><label class="field"><span>Invitation</span><textarea id="inviteText" rows="5" readonly>${escapeHtml(invite)}</textarea></label><div class="inline-actions"><button class="secondary" data-action="copy-invite">Copy</button><button class="primary" data-action="share-invite">Share</button></div></section>` : ''}
    ${state.pair.role === 'employer' ? renderPolicyEditor(p) : `<section class="card"><h2>Agreement</h2><p class="card-sub">Only the homeowner can change the job profile and rates. Your function names and category amounts are visible on the Calendar screen.</p></section>`}
    ${state.auth.mode === 'demo' ? `<section class="card"><h2>Test both roles</h2><p class="card-sub">Switch roles to confirm or dispute entries created by the other person.</p><button class="secondary" style="width:100%" data-action="switch-demo-role">Switch to ${state.pair.role === 'employer' ? 'Worker' : 'Homeowner'}</button></section>` : ''}
    <section class="card"><h2>Device access</h2><p class="card-sub">Lock removes the active session from the screen but remembers this connection. Forget removes the connection from this phone.</p><div class="inline-actions"><button class="secondary" data-action="lock-app">Lock app</button><button class="danger" data-action="forget-all">Forget this device</button></div></section>
    <p class="sync-note">Last updated ${state.snapshot.syncedAt ? new Date(state.snapshot.syncedAt).toLocaleString('en-IN') : 'not yet'}</p>`;
}

function render() {
  if (!state.auth) return renderAuth();
  if (!state.pair || !state.snapshot) return renderHub();
  let content = state.page === 'today' ? renderToday() : state.page === 'month' ? renderMonth() : state.page === 'activity' ? renderActivity() : renderAccount();
  app.innerHTML = `<div class="shell">${header()}<main class="main">${content}</main>${nav()}</div>`;
}

function currentDailyLog() {
  state.draft ||= makeDraft();
  syncDraftFromDailyForm();
  return { ...state.draft, date: state.selectedDate };
}

async function saveCurrentDay(message, log = null) {
  state.snapshot = await api('saveDaily', { log: log || currentDailyLog() });
  state.draft = makeDraft();
  state.draftDirty = false;
  saveStore();
  toast(message);
}

async function silentRefresh() {
  if (!state.auth || state.auth.mode !== 'remote' || state.busy || state.draftDirty || document.visibilityState !== 'visible') return;
  try {
    if (state.pair) {
      state.snapshot = await api('snapshot');
      state.snapshot.syncedAt = new Date().toISOString();
      state.draft = makeDraft();
    } else {
      const data = await api('listPairs');
      state.pairs = data.pairs || [];
    }
    saveStore();
    render();
  } catch (_) {}
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
  if (page) { state.page = page.dataset.page; state.openedFromCalendar = false; state.policyDraft = null; render(); return; }
  const calendarDay = event.target.closest('[data-calendar-date]');
  if (calendarDay) { state.selectedDate = calendarDay.dataset.calendarDate; state.page = 'today'; state.openedFromCalendar = true; state.draft = makeDraft(); state.draftDirty = false; render(); return; }
  const task = event.target.closest('[data-task]');
  if (task) {
    state.draft ||= makeDraft();
    syncDraftFromDailyForm();
    state.draft.activityOutcomes ||= {};
    state.draft.activityOutcomes[task.dataset.task] = task.dataset.outcome;
    state.draftDirty = true;
    render();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'add-job-function') {
    state.policyDraft = readPolicyDraft();
    state.policyDraft.activities.push({ id: uid('activity'), label: 'New function', category: 'Other', cadence: 'daily', monthlyAmount: 0, expectedPerMonth: state.policyDraft.workingDays });
    render(); return;
  }
  if (name === 'remove-job-function') {
    state.policyDraft = readPolicyDraft();
    state.policyDraft.activities.splice(Number(action.dataset.index), 1);
    render(); return;
  }
  if (name === 'start-demo') {
    state.auth = { mode: 'demo', displayName: 'Demo homeowner', phone: '', token: 'demo' };
    state.connection = { mode: 'demo', displayName: 'Demo homeowner', phone: '' };
    state.pairs = [
      { pairId: 'demo-one', role: 'employer', counterpartName: 'Cook and cleaner', counterpartPhone: '+91 90000 00001', status: 'connected' },
      { pairId: 'demo-two', role: 'employer', counterpartName: 'Part-time helper', counterpartPhone: '+91 90000 00002', status: 'connected' },
    ];
    state.pair = null; state.snapshot = null; saveStore(); render();
  }
  if (name === 'open-pair') await withBusy(async () => { await openPair(action.dataset.pairId); });
  if (name === 'back-to-hub') { closePair(); render(); return; }
  if (name === 'back-to-calendar') { state.selectedMonth = state.selectedDate.slice(0, 7); state.page = 'month'; state.openedFromCalendar = false; state.draftDirty = false; render(); return; }
  if (name === 'sync') await refresh(true);
  if (name === 'quick-complete-day') {
    const log = currentDailyLog();
    log.leave = 'none';
    log.leaveNotice = '';
    log.activityOutcomes = Object.fromEntries(dailyActivities(log.date.slice(0, 7)).map((activity) => [activity.id, 'done']));
    await withBusy(async () => { await saveCurrentDay('Full day saved for review.', log); });
  }
  if (name === 'forget-connection' || name === 'forget-all') {
    localStorage.removeItem(STORE_KEY); state.auth = null; state.connection = null; state.pairs = []; state.pair = null; state.snapshot = null; render();
  }
  if (name === 'lock-app') { state.connection = { ...state.connection, mode: state.auth.mode, endpoint: state.auth.endpoint, displayName: state.auth.displayName, phone: state.auth.phone }; state.auth = null; state.pair = null; state.snapshot = null; saveStore(); render(); }
  if (name === 'switch-demo-role') { state.pair.role = state.pair.role === 'employer' ? 'worker' : 'employer'; state.auth.role = state.pair.role; saveStore(); render(); }
  if (name === 'export-data') await withBusy(async () => { const data = await api('exportMyData'); downloadBase64File(data); toast(`Downloaded ${data.fileName}`); });
  if (name === 'backup-my-drive') await withBusy(async () => {
    const data = await api('exportMyData');
    const result = await saveBackupToPersonalDrive(data);
    if (result === 'shared') toast('Backup handed to your selected app. Confirm it appears in your Google Drive.');
    if (result === 'downloaded') toast('Backup downloaded. Upload this file to your Google Drive.');
  });
  if (name === 'copy-invite') { await navigator.clipboard.writeText(document.querySelector('#inviteText').value); toast('Invitation copied.'); }
  if (name === 'share-invite') {
    const text = document.querySelector('#inviteText').value;
    if (navigator.share) await navigator.share({ title: 'SaafHisaab worker invitation', text }); else { await navigator.clipboard.writeText(text); toast('Invitation copied.'); }
  }
  if (name === 'share-month') {
    const text = monthlySummaryText();
    if (navigator.share) {
      try { await navigator.share({ title: `SaafHisaab — ${monthLabel(state.selectedMonth)}`, text }); }
      catch (error) { if (error?.name !== 'AbortError') { await navigator.clipboard.writeText(text); toast('Monthly summary copied.'); } }
    } else { await navigator.clipboard.writeText(text); toast('Monthly summary copied.'); }
  }
  if (name === 'save-flexible') await withBusy(async () => {
    const slot = Number(action.dataset.slot);
    const controlId = `${action.dataset.activityId}-${slot}`;
    const outcome = document.querySelector(`[data-flex-outcome="${CSS.escape(controlId)}"]`).value;
    const completedDate = document.querySelector(`[data-flex-date="${CSS.escape(controlId)}"]`).value;
    state.snapshot = await api('saveToilet', { log: { id: action.dataset.id, month: state.selectedMonth, activityId: action.dataset.activityId, activityLabel: action.dataset.activityLabel, slot, outcome, completedDate } });
    saveStore(); toast(`${action.dataset.activityLabel} saved for review.`);
  });
  if (name === 'review') await withBusy(async () => {
    state.snapshot = await api('reviewEntry', { entity: action.dataset.entity, id: action.dataset.id, decision: action.dataset.decision });
    saveStore(); toast(`Entry ${action.dataset.decision}.`);
  });
  if (name === 'review-request') await withBusy(async () => {
    state.snapshot = await api('reviewRequest', { id: action.dataset.id, decision: action.dataset.decision });
    saveStore(); toast(`Worker request ${action.dataset.decision}.`);
  });
  if (name === 'lock-month') await withBusy(async () => { state.snapshot = await api('lockMonth', { month: state.selectedMonth }); saveStore(); toast('Final payment locked.'); });
  if (name === 'ack-payment') await withBusy(async () => { state.snapshot = await api('acknowledgePayment', { month: state.selectedMonth }); saveStore(); toast('Payment amount acknowledged.'); });
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'selectedDate') { state.selectedDate = event.target.value; state.draft = makeDraft(); state.draftDirty = false; render(); }
  if (event.target.id === 'selectedMonth') { state.selectedMonth = event.target.value; render(); }
  if (event.target.id === 'leaveSelect') { state.draft ||= makeDraft(); syncDraftFromDailyForm(); state.draft.leave = event.target.value; state.draftDirty = true; render(); }
  if (event.target.matches('[data-policy-cadence]')) { state.policyDraft = readPolicyDraft(); render(); }
});

app.addEventListener('input', (event) => {
  if (event.target.closest('#dailyForm')) { state.draft ||= makeDraft(); syncDraftFromDailyForm(); state.draftDirty = true; }
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'dailyForm') {
    const data = new FormData(event.target);
    const log = currentDailyLog();
    await withBusy(async () => {
      state.snapshot = await api('saveDaily', { log });
      const amount = Number(data.get('outsideFoodAmount') || 0);
      if (amount > 0) {
        state.snapshot = await api('saveExpense', { expense: { id: data.get('outsideExpenseId') || uid('expense'), date: log.date, category: 'outside_food', amount, vendor: data.get('outsideFoodVendor') || '', note: data.get('outsideFoodNote') || '', linkedLeaveDate: log.date } });
      }
      state.draft = makeDraft(); state.draftDirty = false; saveStore(); toast('Leave, work and linked costs saved.');
    });
  }
  if (event.target.id === 'workerRequestForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    state.snapshot = await api('submitRequest', { request: { id: uid('request'), date: state.selectedDate, leave: form.leave, leaveNotice: form.leaveNotice, note: form.note || '' } });
    saveStore(); toast('Request sent to the homeowner.');
  });
  if (event.target.id === 'bulkLeaveForm') await withBusy(async () => {
    const data = new FormData(event.target), dates = data.getAll('dates');
    if (!dates.length) throw new Error('Select at least one leave date.');
    state.snapshot = await api('saveBulkLeaves', { leaves: dates.map((date) => ({ date, leave: data.get('leave'), leaveNotice: data.get('leaveNotice'), note: data.get('note') || '' })) });
    state.draft = makeDraft(); saveStore(); toast(`${dates.length} leave date${dates.length === 1 ? '' : 's'} saved for review.`);
  });
  if (event.target.id === 'expenseForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    state.snapshot = await api('saveExpense', { expense: { id: uid('expense'), date: form.date, category: form.category, amount: Number(form.amount), vendor: form.vendor || '', note: form.note || '', linkedLeaveDate: form.linkedLeaveDate || '' } });
    state.selectedMonth = form.date.slice(0, 7); saveStore(); toast('Household expense added.');
  });
  if (event.target.id === 'policyForm') {
    const draft = readPolicyDraft();
    await withBusy(async () => {
    const policyInput = { jobProfileName: draft.jobProfileName, workingDays: draft.workingDays, paidLeaveDays: draft.paidLeaveDays, activities: draft.activities };
    state.snapshot = await api('updatePolicy', { effectiveMonth: draft.effectiveMonth, policy: policyInput });
    state.selectedMonth = draft.effectiveMonth; state.policyDraft = null; saveStore(); toast(`Job profile saved from ${monthLabel(draft.effectiveMonth)}.`);
    });
  }
  if (event.target.id === 'employerSetupForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    form.phone = normalizePhone(form.phone);
    const endpoint = requireServiceEndpoint();
    const data = await api('createHousehold', { ...form, endpoint }, false);
    applyAccountResponse(data, endpoint);
    await openPair(data.selectedPairId);
    toast('First worker pair created.');
  });
  if (event.target.id === 'workerJoinForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    const invite = inviteDecode(form.invite);
    const phone = normalizePhone(form.phone);
    const data = await api('joinHousehold', { ...invite, endpoint: invite.endpoint, phone, pin: form.pin }, false);
    applyAccountResponse(data, invite.endpoint);
    await openPair(data.selectedPairId);
    toast('Worker account connected.');
  });
  if (event.target.id === 'loginForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    const phone = normalizePhone(form.phone);
    const endpoint = requireServiceEndpoint();
    const data = await api('login', { endpoint, phone, pin: form.pin }, false);
    applyAccountResponse(data, endpoint);
  });
  if (event.target.id === 'unlockForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    if (state.connection.mode === 'demo') {
      state.auth = { mode: 'demo', displayName: state.connection.displayName, phone: '', token: 'demo' };
    } else {
      const phone = normalizePhone(form.phone);
      const data = await api('login', { endpoint: state.connection.endpoint, phone, pin: form.pin }, false);
      applyAccountResponse(data, state.connection.endpoint);
    }
    saveStore();
  });
  if (event.target.id === 'createPairForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    const data = await api('createPair', form);
    state.pairs = data.pairs || [];
    saveStore();
    await openPair(data.selectedPairId);
    toast('Worker pair created. Share its invitation from Account.');
  });
  if (event.target.id === 'joinAnotherForm') await withBusy(async () => {
    const form = Object.fromEntries(new FormData(event.target));
    const invite = inviteDecode(form.invite);
    const data = await api('joinHousehold', { ...invite, endpoint: state.auth.endpoint, phone: state.auth.phone, pin: form.pin }, false);
    applyAccountResponse(data, state.auth.endpoint);
    await openPair(data.selectedPairId);
    toast('New homeowner pair connected.');
  });
});

loadStore();
if (state.auth && state.pair && state.snapshot) state.draft = makeDraft();
render();
if (state.auth?.mode === 'remote') refresh(false);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') silentRefresh(); });
window.setInterval(() => { if (state.page !== 'today') silentRefresh(); }, 45000);
