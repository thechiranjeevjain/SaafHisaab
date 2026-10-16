var HP_VERSION = '1.0.0';
var HP_SESSION_DAYS = 180;
var HP_SHEETS = {
  households: 'Households', users: 'Users', sessions: 'Sessions', daily: 'Daily Logs',
  toilet: 'Toilet Logs', payments: 'Payments', audit: 'Audit'
};
var HP_HEADERS = {
  households: ['householdId','employerName','workerName','joinCode','createdAt','monthlySalary','workingDays','paidLeaveDays','cookingAmount','cleaningAmount','utensilsAmount','floorInternalAmount','toiletInternalAmount','toiletPerMonth'],
  users: ['householdId','role','displayName','pinSalt','pinHash','createdAt'],
  sessions: ['tokenHash','householdId','role','expiresAt','createdAt','lastSeenAt'],
  daily: ['id','householdId','date','arrivalTime','departureTime','calls','messages','leave','morningCooking','eveningCooking','morningUtensils','eveningUtensils','floorCleaning','note','createdBy','approval','confirmedBy','createdAt','updatedAt'],
  toilet: ['id','householdId','month','slot','outcome','completedDate','note','createdBy','approval','confirmedBy','createdAt','updatedAt'],
  payments: ['householdId','month','baseSalary','adjustment','finalPayment','status','lockedAt','acknowledgedAt','updatedAt'],
  audit: ['id','householdId','at','role','action','entity','entityId','detail']
};

function setupHomePay() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('HOMEPAY_DATABASE_ID');
  if (existingId) {
    return {
      alreadySetup: true,
      spreadsheetUrl: SpreadsheetApp.openById(existingId).getUrl(),
      message: 'HomePay is already set up. Run resetOwnerSetupCode() only if you lost the owner setup code.'
    };
  }
  var book = SpreadsheetApp.create('HomePay Shared Ledger');
  var first = book.getSheets()[0];
  first.setName(HP_SHEETS.households);
  Object.keys(HP_SHEETS).forEach(function(key) {
    var name = HP_SHEETS[key];
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    initializeSheet_(sheet, HP_HEADERS[key]);
  });
  var setupCode = randomCode_(14);
  props.setProperties({
    HOMEPAY_DATABASE_ID: book.getId(),
    HOMEPAY_SETUP_CODE_HASH: hash_(setupCode),
    HOMEPAY_VERSION: HP_VERSION
  });
  return { alreadySetup: false, ownerSetupCode: setupCode, spreadsheetUrl: book.getUrl() };
}

function resetOwnerSetupCode() {
  database_();
  var code = randomCode_(14);
  PropertiesService.getScriptProperties().setProperty('HOMEPAY_SETUP_CODE_HASH', hash_(code));
  return { ownerSetupCode: code };
}

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.webAppUrl = ScriptApp.getService().getUrl() || '';
  return template.evaluate().setTitle('HomePay').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function doPost(e) {
  try {
    var result = apiRequest(e && e.postData ? e.postData.contents : '{}');
    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_({ ok: false, error: cleanError_(error) });
  }
}

function apiRequest(requestJson) {
  try {
    var request = typeof requestJson === 'string' ? JSON.parse(requestJson || '{}') : requestJson;
    return { ok: true, data: dispatch_(request || {}) };
  } catch (error) {
    return { ok: false, error: cleanError_(error) };
  }
}

function dispatch_(request) {
  var action = String(request.action || '');
  var payload = request.payload || {};
  if (action === 'health') return { version: HP_VERSION, ready: true };
  if (action === 'createHousehold') return createHousehold_(payload);
  if (action === 'joinHousehold') return joinHousehold_(payload);
  if (action === 'login') return login_(payload);
  var actor = authenticate_(request.token);
  if (action === 'snapshot') return snapshot_(actor);
  if (action === 'saveDaily') return lockedWrite_(function() { saveDaily_(actor, payload.log || {}); return snapshot_(actor); });
  if (action === 'saveToilet') return lockedWrite_(function() { saveToilet_(actor, payload.log || {}); return snapshot_(actor); });
  if (action === 'reviewEntry') return lockedWrite_(function() { reviewEntry_(actor, payload); return snapshot_(actor); });
  if (action === 'lockMonth') return lockedWrite_(function() { lockMonth_(actor, payload.month); return snapshot_(actor); });
  if (action === 'acknowledgePayment') return lockedWrite_(function() { acknowledgePayment_(actor, payload.month); return snapshot_(actor); });
  throw new Error('Unknown action.');
}

function createHousehold_(payload) {
  return lockedWrite_(function() {
    var props = PropertiesService.getScriptProperties();
    if (!secureEqual_(hash_(String(payload.setupCode || '')), props.getProperty('HOMEPAY_SETUP_CODE_HASH') || '')) throw new Error('Owner setup code is incorrect.');
    validatePin_(payload.pin);
    var households = rows_('households');
    if (households.length) throw new Error('This HomePay service already has a household. Use the existing employer login.');
    var employerName = requiredText_(payload.employerName, 'Employer name', 60);
    var workerName = requiredText_(payload.workerName, 'Worker name', 60);
    var householdId = 'home_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    var joinCode = randomCode_(8);
    var now = isoNow_();
    appendObject_('households', {
      householdId: householdId, employerName: employerName, workerName: workerName, joinCode: joinCode, createdAt: now,
      monthlySalary: 7000, workingDays: 26, paidLeaveDays: 4, cookingAmount: 5000,
      cleaningAmount: 1200, utensilsAmount: 800, floorInternalAmount: 900,
      toiletInternalAmount: 300, toiletPerMonth: 4
    });
    createUser_(householdId, 'employer', employerName, payload.pin);
    var token = createSession_(householdId, 'employer');
    audit_(householdId, 'employer', 'Created household', 'household', householdId, 'Initial salary policy ₹7,000');
    var actor = { householdId: householdId, role: 'employer' };
    return { householdId: householdId, token: token, snapshot: snapshot_(actor) };
  });
}

function joinHousehold_(payload) {
  return lockedWrite_(function() {
    validatePin_(payload.pin);
    var household = findHousehold_(payload.householdId);
    if (!secureEqual_(String(payload.joinCode || '').toUpperCase(), String(household.joinCode || '').toUpperCase())) throw new Error('Invitation code is incorrect.');
    var worker = rows_('users').filter(function(row) { return row.householdId === household.householdId && row.role === 'worker'; })[0];
    if (worker) throw new Error('A worker device is already registered. The employer must reset access before another worker can join.');
    createUser_(household.householdId, 'worker', household.workerName, payload.pin);
    var token = createSession_(household.householdId, 'worker');
    audit_(household.householdId, 'worker', 'Joined household', 'user', 'worker', 'Worker device registered');
    var actor = { householdId: household.householdId, role: 'worker' };
    return { token: token, displayName: household.workerName, snapshot: snapshot_(actor) };
  });
}

function login_(payload) {
  validatePin_(payload.pin);
  var householdId = requiredText_(payload.householdId, 'Household ID', 80);
  var role = payload.role === 'employer' ? 'employer' : payload.role === 'worker' ? 'worker' : '';
  if (!role) throw new Error('Role is invalid.');
  var user = rows_('users').filter(function(row) { return row.householdId === householdId && row.role === role; })[0];
  if (!user || !secureEqual_(pinHash_(payload.pin, user.pinSalt), user.pinHash)) throw new Error('PIN is incorrect.');
  var token = lockedWrite_(function() { return createSession_(householdId, role); });
  var actor = { householdId: householdId, role: role };
  return { token: token, displayName: user.displayName, snapshot: snapshot_(actor) };
}

function authenticate_(rawToken) {
  if (!rawToken) throw new Error('Please log in again.');
  var hash = hash_(String(rawToken));
  var session = rows_('sessions').filter(function(row) { return secureEqual_(row.tokenHash, hash); })[0];
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) throw new Error('Session expired. Please log in again.');
  return { householdId: session.householdId, role: session.role };
}

function snapshot_(actor) {
  var household = findHousehold_(actor.householdId);
  var daily = rows_('daily').filter(byHousehold_(actor.householdId)).map(dailyFromRow_);
  var toilet = rows_('toilet').filter(byHousehold_(actor.householdId)).map(toiletFromRow_);
  var payments = rows_('payments').filter(byHousehold_(actor.householdId));
  var profile = {
    householdId: household.householdId,
    employerName: household.employerName,
    workerName: household.workerName,
    policy: {
      monthlySalary: number_(household.monthlySalary), workingDays: number_(household.workingDays), paidLeaveDays: number_(household.paidLeaveDays),
      cookingAmount: number_(household.cookingAmount), cleaningAmount: number_(household.cleaningAmount), utensilsAmount: number_(household.utensilsAmount),
      toiletPerMonth: number_(household.toiletPerMonth)
    }
  };
  if (actor.role === 'employer') {
    profile.joinCode = household.joinCode;
    profile.policy.floorInternalAmount = number_(household.floorInternalAmount);
    profile.policy.toiletInternalAmount = number_(household.toiletInternalAmount);
  }
  var months = {};
  months[Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM')] = true;
  daily.forEach(function(x) { months[x.date.slice(0, 7)] = true; });
  toilet.forEach(function(x) { months[x.month] = true; });
  payments.forEach(function(x) { months[x.month] = true; });
  var summaries = {};
  Object.keys(months).forEach(function(month) { summaries[month] = calculateMonth_(household, daily, toilet, month, actor.role === 'employer'); });
  var auditRows = rows_('audit').filter(byHousehold_(actor.householdId)).slice(-200).reverse();
  return { profile: profile, dailyLogs: daily, toiletLogs: toilet, payments: payments, audit: auditRows, monthSummaries: summaries, syncedAt: isoNow_() };
}

function saveDaily_(actor, log) {
  var date = validateDate_(log.date);
  ensureMonthOpen_(actor.householdId, date.slice(0, 7));
  var current = findRow_('daily', function(row) { return row.householdId === actor.householdId && (row.id === log.id || row.date === date); });
  if (current && current.object.createdBy !== actor.role) throw new Error('Only the person who recorded this entry can correct it. The other person can confirm or dispute it.');
  var leave = ['none','half','full'].indexOf(log.leave) >= 0 ? log.leave : 'none';
  var allowedOutcomes = ['pending','done','missed','not_required','cancelled'];
  var task = function(value) { return allowedOutcomes.indexOf(value) >= 0 ? value : 'pending'; };
  var now = isoNow_();
  var object = {
    id: current ? current.object.id : String(log.id || Utilities.getUuid()), householdId: actor.householdId, date: date,
    arrivalTime: safeTime_(log.arrivalTime), departureTime: safeTime_(log.departureTime), calls: boundedInt_(log.calls, 0, 99), messages: boundedInt_(log.messages, 0, 99), leave: leave,
    morningCooking: task(log.tasks && log.tasks.morningCooking), eveningCooking: task(log.tasks && log.tasks.eveningCooking),
    morningUtensils: task(log.tasks && log.tasks.morningUtensils), eveningUtensils: task(log.tasks && log.tasks.eveningUtensils), floorCleaning: task(log.tasks && log.tasks.floorCleaning),
    note: optionalText_(log.note, 500), createdBy: actor.role, approval: 'pending', confirmedBy: '', createdAt: current ? current.object.createdAt : now, updatedAt: now
  };
  if (current) updateObject_('daily', current.rowNumber, object); else appendObject_('daily', object);
  audit_(actor.householdId, actor.role, current ? 'Corrected daily log' : 'Created daily log', 'daily', object.id, date);
}

function saveToilet_(actor, log) {
  var month = validateMonth_(log.month);
  ensureMonthOpen_(actor.householdId, month);
  var slot = boundedInt_(log.slot, 1, 4);
  var current = findRow_('toilet', function(row) { return row.householdId === actor.householdId && (row.id === log.id || (row.month === month && number_(row.slot) === slot)); });
  if (current && current.object.createdBy !== actor.role) throw new Error('Only the person who recorded this entry can correct it. The other person can confirm or dispute it.');
  var allowed = ['pending','done','missed','not_required','cancelled'];
  var outcome = allowed.indexOf(log.outcome) >= 0 ? log.outcome : 'pending';
  var now = isoNow_();
  var object = {
    id: current ? current.object.id : String(log.id || Utilities.getUuid()), householdId: actor.householdId, month: month, slot: slot, outcome: outcome,
    completedDate: log.completedDate ? validateDate_(log.completedDate) : '', note: optionalText_(log.note, 500), createdBy: actor.role,
    approval: 'pending', confirmedBy: '', createdAt: current ? current.object.createdAt : now, updatedAt: now
  };
  if (current) updateObject_('toilet', current.rowNumber, object); else appendObject_('toilet', object);
  audit_(actor.householdId, actor.role, current ? 'Corrected toilet log' : 'Created toilet log', 'toilet', object.id, month + ' slot ' + slot);
}

function reviewEntry_(actor, payload) {
  var key = payload.entity === 'toilet' ? 'toilet' : payload.entity === 'daily' ? 'daily' : '';
  if (!key) throw new Error('Entry type is invalid.');
  var found = findRow_(key, function(row) { return row.householdId === actor.householdId && row.id === payload.id; });
  if (!found) throw new Error('Entry was not found.');
  if (found.object.createdBy === actor.role) throw new Error('The other person must review this entry.');
  var month = key === 'daily' ? found.object.date.slice(0, 7) : found.object.month;
  ensureMonthOpen_(actor.householdId, month);
  var decision = payload.decision === 'confirmed' ? 'confirmed' : payload.decision === 'disputed' ? 'disputed' : '';
  if (!decision) throw new Error('Review decision is invalid.');
  found.object.approval = decision;
  found.object.confirmedBy = actor.role;
  found.object.updatedAt = isoNow_();
  updateObject_(key, found.rowNumber, found.object);
  audit_(actor.householdId, actor.role, decision === 'confirmed' ? 'Confirmed entry' : 'Disputed entry', key, found.object.id, month);
}

function lockMonth_(actor, month) {
  if (actor.role !== 'employer') throw new Error('Only the employer can lock a month.');
  month = validateMonth_(month);
  ensureMonthOpen_(actor.householdId, month);
  var daily = rows_('daily').filter(function(row) { return row.householdId === actor.householdId && row.date.indexOf(month) === 0; }).map(dailyFromRow_);
  var toilet = rows_('toilet').filter(function(row) { return row.householdId === actor.householdId && row.month === month; }).map(toiletFromRow_);
  var unresolved = daily.concat(toilet).filter(function(row) { return row.approval !== 'confirmed'; });
  if (unresolved.length) throw new Error('Resolve all pending and disputed entries before locking the month.');
  var household = findHousehold_(actor.householdId);
  var calc = calculateMonth_(household, daily, toilet, month, true);
  var object = { householdId: actor.householdId, month: month, baseSalary: number_(household.monthlySalary), adjustment: calc.adjustment, finalPayment: calc.finalPayment, status: 'locked', lockedAt: isoNow_(), acknowledgedAt: '', updatedAt: isoNow_() };
  appendObject_('payments', object);
  audit_(actor.householdId, actor.role, 'Locked month', 'payment', month, 'Final payment ' + calc.finalPayment.toFixed(2));
}

function acknowledgePayment_(actor, month) {
  if (actor.role !== 'worker') throw new Error('Only the worker can acknowledge the payment.');
  month = validateMonth_(month);
  var found = findRow_('payments', function(row) { return row.householdId === actor.householdId && row.month === month; });
  if (!found) throw new Error('The employer has not locked this month yet.');
  found.object.status = 'acknowledged';
  found.object.acknowledgedAt = isoNow_();
  found.object.updatedAt = isoNow_();
  updateObject_('payments', found.rowNumber, found.object);
  audit_(actor.householdId, actor.role, 'Acknowledged payment', 'payment', month, 'Worker acknowledged final amount');
}

function calculateMonth_(household, daily, toilet, month, includeAudit) {
  var salary = number_(household.monthlySalary), workDays = number_(household.workingDays), paidDays = number_(household.paidLeaveDays);
  var r = {
    daily: salary / workDays,
    cookingSession: number_(household.cookingAmount) / (workDays * 2),
    utensilSession: number_(household.utensilsAmount) / (workDays * 2),
    floor: number_(household.floorInternalAmount) / workDays,
    toilet: number_(household.toiletInternalAmount) / number_(household.toiletPerMonth)
  };
  var used = 0, audit = [];
  daily.filter(function(x) { return x.date.indexOf(month) === 0 && x.approval === 'confirmed'; }).forEach(function(x) {
    if (x.leave === 'full' || x.leave === 'half') {
      var leaveValue = x.leave === 'full' ? r.daily : r.daily / 2;
      used += leaveValue; audit.push({ date: x.date, label: x.leave === 'full' ? 'Full-day leave' : 'Half-day leave', value: leaveValue }); return;
    }
    [['morningCooking','Morning cooking',r.cookingSession],['eveningCooking','Evening cooking',r.cookingSession],['morningUtensils','Morning utensils',r.utensilSession],['eveningUtensils','Evening utensils',r.utensilSession],['floorCleaning','Floor cleaning',r.floor]].forEach(function(rule) {
      if (x.tasks[rule[0]] === 'missed') { used += rule[2]; audit.push({ date: x.date, label: rule[1], value: rule[2] }); }
    });
  });
  toilet.filter(function(x) { return x.month === month && x.approval === 'confirmed' && x.outcome === 'missed'; }).forEach(function(x) { used += r.toilet; audit.push({ date: x.completedDate || month + ' toilet ' + x.slot, label: 'Toilet cleaning ' + x.slot, value: r.toilet }); });
  var allowance = paidDays * r.daily;
  var adjustment = Math.max(0, used - allowance);
  var result = { usedValue: used, allowance: allowance, adjustment: adjustment, finalPayment: Math.max(0, salary - adjustment) };
  if (includeAudit) { result.audit = audit; result.rates = r; }
  return result;
}

function dailyFromRow_(row) {
  return { id: row.id, date: row.date, arrivalTime: row.arrivalTime, departureTime: row.departureTime, calls: number_(row.calls), messages: number_(row.messages), leave: row.leave, tasks: { morningCooking: row.morningCooking, eveningCooking: row.eveningCooking, morningUtensils: row.morningUtensils, eveningUtensils: row.eveningUtensils, floorCleaning: row.floorCleaning }, note: row.note, createdBy: row.createdBy, approval: row.approval, confirmedBy: row.confirmedBy, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toiletFromRow_(row) {
  return { id: row.id, month: row.month, slot: number_(row.slot), outcome: row.outcome, completedDate: row.completedDate, note: row.note, createdBy: row.createdBy, approval: row.approval, confirmedBy: row.confirmedBy, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function createUser_(householdId, role, name, pin) {
  var salt = randomCode_(20);
  appendObject_('users', { householdId: householdId, role: role, displayName: name, pinSalt: salt, pinHash: pinHash_(pin, salt), createdAt: isoNow_() });
}

function createSession_(householdId, role) {
  var token = randomCode_(48);
  var expires = new Date(Date.now() + HP_SESSION_DAYS * 86400000).toISOString();
  appendObject_('sessions', { tokenHash: hash_(token), householdId: householdId, role: role, expiresAt: expires, createdAt: isoNow_(), lastSeenAt: isoNow_() });
  return token;
}

function audit_(householdId, role, action, entity, entityId, detail) {
  appendObject_('audit', { id: Utilities.getUuid(), householdId: householdId, at: isoNow_(), role: role, action: action, entity: entity, entityId: entityId, detail: detail || '' });
}

function database_() {
  var id = PropertiesService.getScriptProperties().getProperty('HOMEPAY_DATABASE_ID');
  if (!id) throw new Error('Run setupHomePay() in the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}

function sheet_(key) {
  var sheet = database_().getSheetByName(HP_SHEETS[key]);
  if (!sheet) throw new Error('Database sheet is missing: ' + HP_SHEETS[key]);
  return sheet;
}

function rows_(key) {
  var sheet = sheet_(key), headers = HP_HEADERS[key], last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, headers.length).getValues().map(function(values) {
    var row = {}; headers.forEach(function(header, index) { row[header] = values[index] === null ? '' : String(values[index]); }); return row;
  });
}

function appendObject_(key, object) {
  var headers = HP_HEADERS[key];
  sheet_(key).appendRow(headers.map(function(header) { return object[header] === undefined ? '' : object[header]; }));
}

function updateObject_(key, rowNumber, object) {
  var headers = HP_HEADERS[key];
  sheet_(key).getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function(header) { return object[header] === undefined ? '' : object[header]; })]);
}

function findRow_(key, predicate) {
  var all = rows_(key);
  for (var i = 0; i < all.length; i++) if (predicate(all[i])) return { object: all[i], rowNumber: i + 2 };
  return null;
}

function findHousehold_(id) {
  var row = rows_('households').filter(function(x) { return x.householdId === id; })[0];
  if (!row) throw new Error('Household was not found.');
  return row;
}

function ensureMonthOpen_(householdId, month) {
  var locked = rows_('payments').some(function(row) { return row.householdId === householdId && row.month === month; });
  if (locked) throw new Error('This month is locked and cannot be changed.');
}

function initializeSheet_(sheet, headers) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#176b57').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(2, sheet.getMaxRows()), headers.length).createFilter();
  sheet.setHiddenGridlines(true);
}

function byHousehold_(id) { return function(row) { return row.householdId === id; }; }
function number_(value) { var n = Number(value); return isFinite(n) ? n : 0; }
function isoNow_() { return new Date().toISOString(); }
function pinHash_(pin, salt) { return hash_(String(salt) + ':' + String(pin)); }
function hash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8).map(function(byte) { var v = byte < 0 ? byte + 256 : byte; return ('0' + v.toString(16)).slice(-2); }).join(''); }
function secureEqual_(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; var result = 0; for (var i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }
function randomCode_(length) { var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Math.random() + ':' + Date.now()); var out = ''; for (var i = 0; i < length; i++) out += chars.charAt((bytes[i % bytes.length] + 256) % chars.length); return out; }
function validatePin_(pin) { if (!/^\d{4,12}$/.test(String(pin || ''))) throw new Error('PIN must contain 4 to 12 digits.'); }
function requiredText_(value, label, max) { var text = String(value || '').trim(); if (!text) throw new Error(label + ' is required.'); if (text.length > max) throw new Error(label + ' is too long.'); return text; }
function optionalText_(value, max) { var text = String(value || '').trim(); return text.slice(0, max); }
function boundedInt_(value, min, max) { var n = Math.floor(Number(value)); if (!isFinite(n)) n = min; return Math.max(min, Math.min(max, n)); }
function validateDate_(value) { var text = String(value || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || isNaN(new Date(text + 'T00:00:00Z').getTime())) throw new Error('Date is invalid.'); return text; }
function validateMonth_(value) { var text = String(value || ''); if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('Month is invalid.'); return text; }
function safeTime_(value) { var text = String(value || ''); return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : ''; }
function cleanError_(error) { return String(error && error.message ? error.message : error || 'Unexpected error').replace(/^Exception:\s*/, ''); }
function lockedWrite_(work) { var lock = LockService.getScriptLock(); lock.waitLock(20000); try { return work(); } finally { lock.releaseLock(); } }
function jsonOutput_(object) { return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON); }
