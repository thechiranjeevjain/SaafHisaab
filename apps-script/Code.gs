var SH_VERSION = '2.2.0';
var SH_SESSION_DAYS = 180;
var SH_SHEETS = {
  households: 'Households', users: 'Users', sessions: 'Sessions', accounts: 'Accounts', accountSessions: 'Account Sessions', daily: 'Daily Logs',
  toilet: 'Toilet Logs', requests: 'Requests', payments: 'Payments', audit: 'Audit'
};
var SH_HEADERS = {
  households: ['householdId','employerName','workerName','joinCode','createdAt','monthlySalary','workingDays','paidLeaveDays','cookingAmount','cleaningAmount','utensilsAmount','floorInternalAmount','toiletInternalAmount','toiletPerMonth','employerUserId','workerUserId'],
  users: ['householdId','role','displayName','phone','pinSalt','pinHash','createdAt'],
  sessions: ['tokenHash','householdId','role','expiresAt','createdAt','lastSeenAt'],
  accounts: ['userId','phone','displayName','pinSalt','pinHash','createdAt','updatedAt','status'],
  accountSessions: ['tokenHash','userId','expiresAt','createdAt','lastSeenAt'],
  daily: ['id','householdId','date','arrivalTime','departureTime','calls','messages','leave','morningCooking','eveningCooking','morningUtensils','eveningUtensils','floorCleaning','note','createdBy','approval','confirmedBy','createdAt','updatedAt','leaveNotice'],
  toilet: ['id','householdId','month','slot','outcome','completedDate','note','createdBy','approval','confirmedBy','createdAt','updatedAt'],
  requests: ['id','householdId','type','date','leave','leaveNotice','note','createdBy','status','reviewedBy','createdAt','updatedAt'],
  payments: ['householdId','month','baseSalary','adjustment','finalPayment','status','lockedAt','acknowledgedAt','updatedAt'],
  audit: ['id','householdId','at','role','action','entity','entityId','detail']
};

function setupSaafHisaab() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('SAAF_HISAAB_DATABASE_ID');
  if (existingId) {
    var existingBook = SpreadsheetApp.openById(existingId);
    ensureSchema_(existingBook);
    migrateLegacyAccounts_();
    ensureAutomaticBackupTrigger_();
    var missingPhones = rows_('users').some(function(user) { return !user.phone; });
    return {
      alreadySetup: true,
      spreadsheetUrl: existingBook.getUrl(),
      needsPhoneMigration: missingPhones,
      message: missingPhones ? 'Schema updated. Run configureExistingLoginPhones(homeownerPhone, workerPhone) once.' : 'SaafHisaab is already set up. Run resetOwnerSetupCode() only if you lost the owner setup code.'
    };
  }
  var book = SpreadsheetApp.create('SaafHisaab Shared Ledger');
  var first = book.getSheets()[0];
  first.setName(SH_SHEETS.households);
  Object.keys(SH_SHEETS).forEach(function(key) {
    var name = SH_SHEETS[key];
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    initializeSheet_(sheet, SH_HEADERS[key]);
  });
  var setupCode = randomCode_(14);
  props.setProperties({
    SAAF_HISAAB_DATABASE_ID: book.getId(),
    SAAF_HISAAB_SETUP_CODE_HASH: hash_(setupCode),
    SAAF_HISAAB_VERSION: SH_VERSION
  });
  ensureAutomaticBackupTrigger_();
  return { alreadySetup: false, ownerSetupCode: setupCode, spreadsheetUrl: book.getUrl() };
}

function configureExistingLoginPhones(homeownerPhone, workerPhone) {
  var homeowner = normalizePhone_(homeownerPhone);
  var worker = workerPhone ? normalizePhone_(workerPhone) : '';
  if (worker && secureEqual_(homeowner, worker)) throw new Error('Homeowner and worker must use different phone numbers in the same household.');
  return lockedWrite_(function() {
    var homeownerRow = findRow_('users', function(row) { return row.role === 'employer'; });
    if (!homeownerRow) throw new Error('Homeowner account was not found.');
    homeownerRow.object.phone = homeowner;
    updateObject_('users', homeownerRow.rowNumber, homeownerRow.object);
    var workerRow = findRow_('users', function(row) { return row.role === 'worker'; });
    if (workerRow) {
      if (!worker) throw new Error('Worker phone number is required because a worker account already exists.');
      workerRow.object.phone = worker;
      updateObject_('users', workerRow.rowNumber, workerRow.object);
    }
    migrateLegacyAccounts_();
    return { homeownerPhone: homeowner, workerPhone: workerRow ? worker : '', updated: true };
  });
}

function resetOwnerSetupCode() {
  database_();
  var code = randomCode_(14);
  PropertiesService.getScriptProperties().setProperty('SAAF_HISAAB_SETUP_CODE_HASH', hash_(code));
  return { ownerSetupCode: code };
}

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.webAppUrl = ScriptApp.getService().getUrl() || '';
  return template.evaluate().setTitle('SaafHisaab').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
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
  if (action === 'health') return { version: SH_VERSION, ready: true };
  if (action === 'createHousehold') return createHousehold_(payload);
  if (action === 'joinHousehold') return joinHousehold_(payload);
  if (action === 'login') return login_(payload);
  var account = authenticateAccount_(request.token);
  if (action === 'listPairs') return accountResponse_(account);
  if (action === 'createPair') return createPair_(account, payload);
  if (action === 'exportMyData') return exportMyData_(account);
  if (action === 'backupMyDataToDrive') return backupMyDataToDrive_(account);
  var actor = authorizePair_(account, payload.pairId || payload.householdId);
  if (action === 'snapshot') return snapshot_(actor);
  if (action === 'saveDaily') return lockedWrite_(function() { saveDaily_(actor, payload.log || {}); return snapshot_(actor); });
  if (action === 'saveToilet') return lockedWrite_(function() { saveToilet_(actor, payload.log || {}); return snapshot_(actor); });
  if (action === 'submitRequest') return lockedWrite_(function() { submitRequest_(actor, payload.request || {}); return snapshot_(actor); });
  if (action === 'reviewRequest') return lockedWrite_(function() { reviewRequest_(actor, payload); return snapshot_(actor); });
  if (action === 'reviewEntry') return lockedWrite_(function() { reviewEntry_(actor, payload); return snapshot_(actor); });
  if (action === 'lockMonth') return lockedWrite_(function() { lockMonth_(actor, payload.month); return snapshot_(actor); });
  if (action === 'acknowledgePayment') return lockedWrite_(function() { acknowledgePayment_(actor, payload.month); return snapshot_(actor); });
  throw new Error('Unknown action.');
}

function createHousehold_(payload) {
  return lockedWrite_(function() {
    var props = PropertiesService.getScriptProperties();
    if (!secureEqual_(hash_(String(payload.setupCode || '')), props.getProperty('SAAF_HISAAB_SETUP_CODE_HASH') || '')) throw new Error('Owner setup code is incorrect.');
    validatePin_(payload.pin);
    if (rows_('accounts').length) throw new Error('SaafHisaab is already initialized. Log in and use Add worker.');
    var employerName = requiredText_(payload.employerName, 'Employer name', 60);
    var workerName = requiredText_(payload.workerName, 'Worker name', 60);
    var phone = normalizePhone_(payload.phone);
    var householdId = 'sh_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    var joinCode = randomCode_(8);
    var now = isoNow_();
    var account = createOrVerifyAccount_(employerName, phone, payload.pin);
    appendObject_('households', {
      householdId: householdId, employerName: employerName, workerName: workerName, joinCode: joinCode, createdAt: now,
      monthlySalary: 7000, workingDays: 26, paidLeaveDays: 4, cookingAmount: 5000,
      cleaningAmount: 1200, utensilsAmount: 800, floorInternalAmount: 900,
      toiletInternalAmount: 300, toiletPerMonth: 4, employerUserId: account.userId, workerUserId: ''
    });
    var token = createAccountSession_(account.userId);
    audit_(householdId, 'employer', 'Created household', 'household', householdId, 'Initial salary policy ₹7,000');
    return accountResponse_({ userId: account.userId, phone: phone, displayName: account.displayName }, token, householdId);
  });
}

function joinHousehold_(payload) {
  return lockedWrite_(function() {
    validatePin_(payload.pin);
    var phone = normalizePhone_(payload.phone);
    var household = findHousehold_(payload.householdId);
    if (!secureEqual_(String(payload.joinCode || '').toUpperCase(), String(household.joinCode || '').toUpperCase())) throw new Error('Invitation code is incorrect.');
    if (household.workerUserId) throw new Error('This worker profile is already connected. Ask the homeowner to create another worker pair.');
    var account = createOrVerifyAccount_(household.workerName, phone, payload.pin);
    if (account.userId === household.employerUserId) throw new Error('The homeowner and worker must use different accounts for this pair.');
    var found = findRow_('households', function(row) { return row.householdId === household.householdId; });
    found.object.workerUserId = account.userId;
    updateObject_('households', found.rowNumber, found.object);
    var token = createAccountSession_(account.userId);
    audit_(household.householdId, 'worker', 'Joined household', 'user', 'worker', 'Worker device registered');
    return accountResponse_({ userId: account.userId, phone: phone, displayName: account.displayName }, token, household.householdId);
  });
}

function login_(payload) {
  validatePin_(payload.pin);
  var phone = normalizePhone_(payload.phone);
  enforceLoginRateLimit_(phone);
  var account = rows_('accounts').filter(function(row) { return row.phone === phone && row.status !== 'disabled'; })[0];
  if (!account || !secureEqual_(pinHash_(payload.pin, account.pinSalt), account.pinHash)) {
    recordLoginFailure_(phone);
    throw new Error('Phone number or PIN is incorrect.');
  }
  clearLoginFailures_(phone);
  var token = lockedWrite_(function() { return createAccountSession_(account.userId); });
  return accountResponse_(account, token);
}

function authenticateAccount_(rawToken) {
  if (!rawToken) throw new Error('Please log in again.');
  var hash = hash_(String(rawToken));
  var session = rows_('accountSessions').filter(function(row) { return secureEqual_(row.tokenHash, hash); })[0];
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) throw new Error('Session expired. Please log in again.');
  var account = rows_('accounts').filter(function(row) { return row.userId === session.userId && row.status !== 'disabled'; })[0];
  if (!account) throw new Error('Account is unavailable.');
  return account;
}

function authorizePair_(account, pairId) {
  if (!pairId) throw new Error('Choose a person before opening payroll data.');
  var household = findHousehold_(pairId);
  var role = household.employerUserId === account.userId ? 'employer' : household.workerUserId === account.userId ? 'worker' : '';
  if (!role) throw new Error('You do not have access to this payroll pair.');
  return { householdId: household.householdId, pairId: household.householdId, role: role, userId: account.userId };
}

function pairsForAccount_(account) {
  var accounts = rows_('accounts');
  return rows_('households').map(function(household) {
    var role = household.employerUserId === account.userId ? 'employer' : household.workerUserId === account.userId ? 'worker' : '';
    if (!role) return null;
    var counterpartId = role === 'employer' ? household.workerUserId : household.employerUserId;
    var counterpart = counterpartId ? accounts.filter(function(item) { return item.userId === counterpartId; })[0] : null;
    return {
      pairId: household.householdId, role: role,
      ownName: role === 'employer' ? household.employerName : household.workerName,
      counterpartName: role === 'employer' ? household.workerName : household.employerName,
      counterpartPhone: counterpart ? counterpart.phone : '', pending: !household.workerUserId,
      status: household.workerUserId ? 'connected' : 'waiting_for_worker'
    };
  }).filter(function(item) { return item; });
}

function accountResponse_(account, token, selectedPairId) {
  var result = {
    account: { userId: account.userId, phone: account.phone, displayName: account.displayName },
    pairs: pairsForAccount_(account)
  };
  if (token) result.token = token;
  if (selectedPairId) result.selectedPairId = selectedPairId;
  return result;
}

function createPair_(account, payload) {
  return lockedWrite_(function() {
    var employerName = requiredText_(payload.employerName || account.displayName, 'Homeowner name', 60);
    var workerName = requiredText_(payload.workerName, 'Worker name', 60);
    var householdId = 'sh_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    appendObject_('households', {
      householdId: householdId, employerName: employerName, workerName: workerName, joinCode: randomCode_(8), createdAt: isoNow_(),
      monthlySalary: 7000, workingDays: 26, paidLeaveDays: 4, cookingAmount: 5000, cleaningAmount: 1200,
      utensilsAmount: 800, floorInternalAmount: 900, toiletInternalAmount: 300, toiletPerMonth: 4,
      employerUserId: account.userId, workerUserId: ''
    });
    audit_(householdId, 'employer', 'Created worker pair', 'household', householdId, 'Initial salary policy 7000');
    return accountResponse_(account, null, householdId);
  });
}

function snapshot_(actor) {
  var household = findHousehold_(actor.householdId);
  var daily = rows_('daily').filter(byHousehold_(actor.householdId)).map(dailyFromRow_);
  var toilet = rows_('toilet').filter(byHousehold_(actor.householdId)).map(toiletFromRow_);
  var requests = rows_('requests').filter(byHousehold_(actor.householdId));
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
  return { profile: profile, dailyLogs: daily, toiletLogs: toilet, requests: requests, payments: payments, audit: auditRows, monthSummaries: summaries, syncedAt: isoNow_() };
}

function saveDaily_(actor, log) {
  if (actor.role !== 'employer') throw new Error('Workers cannot edit payroll records. Submit a request for the homeowner instead.');
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
    note: optionalText_(log.note, 500), createdBy: actor.role, approval: 'pending', confirmedBy: '', createdAt: current ? current.object.createdAt : now, updatedAt: now,
    leaveNotice: ['planned','last_minute','no_contact'].indexOf(log.leaveNotice) >= 0 ? log.leaveNotice : ''
  };
  if (current) updateObject_('daily', current.rowNumber, object); else appendObject_('daily', object);
  audit_(actor.householdId, actor.role, current ? 'Corrected daily log' : 'Created daily log', 'daily', object.id, date);
}

function saveToilet_(actor, log) {
  if (actor.role !== 'employer') throw new Error('Workers cannot edit payroll records. Submit a request for the homeowner instead.');
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

function submitRequest_(actor, request) {
  if (actor.role !== 'worker') throw new Error('Only the worker can submit a worker request.');
  var date = validateDate_(request.date);
  ensureMonthOpen_(actor.householdId, date.slice(0, 7));
  var leave = request.leave === 'half' ? 'half' : request.leave === 'full' ? 'full' : '';
  if (!leave) throw new Error('Choose half-day or full-day leave.');
  var notice = request.leaveNotice === 'planned' ? 'planned' : request.leaveNotice === 'last_minute' ? 'last_minute' : '';
  if (!notice) throw new Error('Choose planned or last-minute notice.');
  var now = isoNow_(), id = String(request.id || Utilities.getUuid());
  appendObject_('requests', {
    id: id, householdId: actor.householdId, type: 'leave', date: date,
    leave: leave, leaveNotice: notice, note: optionalText_(request.note, 500), createdBy: 'worker', status: 'pending',
    reviewedBy: '', createdAt: now, updatedAt: now
  });
  audit_(actor.householdId, actor.role, 'Submitted leave request', 'request', id, date + ' ' + notice);
}

function reviewRequest_(actor, payload) {
  if (actor.role !== 'employer') throw new Error('Only the homeowner can review worker requests.');
  var found = findRow_('requests', function(row) { return row.householdId === actor.householdId && row.id === payload.id; });
  if (!found) throw new Error('Request was not found.');
  if (found.object.status !== 'pending') throw new Error('This request has already been reviewed.');
  var decision = payload.decision === 'accepted' ? 'accepted' : payload.decision === 'declined' ? 'declined' : '';
  if (!decision) throw new Error('Request decision is invalid.');
  ensureMonthOpen_(actor.householdId, found.object.date.slice(0, 7));
  if (decision === 'accepted') {
    var current = findRow_('daily', function(row) { return row.householdId === actor.householdId && row.date === found.object.date; });
    var now = isoNow_();
    var object = current ? current.object : {
      id: Utilities.getUuid(), householdId: actor.householdId, date: found.object.date, arrivalTime: '', departureTime: '', calls: 0, messages: 0,
      morningCooking: 'done', eveningCooking: 'done', morningUtensils: 'done', eveningUtensils: 'done', floorCleaning: 'done', note: '', createdAt: now
    };
    object.leave = found.object.leave;
    object.leaveNotice = found.object.leaveNotice;
    object.note = found.object.note;
    object.createdBy = 'worker';
    object.approval = 'confirmed';
    object.confirmedBy = 'employer';
    object.updatedAt = now;
    if (current) updateObject_('daily', current.rowNumber, object); else appendObject_('daily', object);
  }
  found.object.status = decision;
  found.object.reviewedBy = 'employer';
  found.object.updatedAt = isoNow_();
  updateObject_('requests', found.rowNumber, found.object);
  audit_(actor.householdId, actor.role, decision === 'accepted' ? 'Accepted worker request' : 'Declined worker request', 'request', found.object.id, found.object.date);
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
  unresolved = unresolved.concat(rows_('requests').filter(function(row) { return row.householdId === actor.householdId && row.date.indexOf(month) === 0 && row.status === 'pending'; }));
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
  return { id: row.id, date: row.date, arrivalTime: row.arrivalTime, departureTime: row.departureTime, calls: number_(row.calls), messages: number_(row.messages), leave: row.leave, leaveNotice: row.leaveNotice || '', tasks: { morningCooking: row.morningCooking, eveningCooking: row.eveningCooking, morningUtensils: row.morningUtensils, eveningUtensils: row.eveningUtensils, floorCleaning: row.floorCleaning }, note: row.note, createdBy: row.createdBy, approval: row.approval, confirmedBy: row.confirmedBy, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toiletFromRow_(row) {
  return { id: row.id, month: row.month, slot: number_(row.slot), outcome: row.outcome, completedDate: row.completedDate, note: row.note, createdBy: row.createdBy, approval: row.approval, confirmedBy: row.confirmedBy, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function createUser_(householdId, role, name, phone, pin) {
  phone = normalizePhone_(phone);
  var duplicate = rows_('users').some(function(user) { return user.householdId === householdId && user.phone === phone; });
  if (duplicate) throw new Error('That phone number is already used in this household.');
  var salt = randomCode_(20);
  appendObject_('users', { householdId: householdId, role: role, displayName: name, phone: phone, pinSalt: salt, pinHash: pinHash_(pin, salt), createdAt: isoNow_() });
}

function createOrVerifyAccount_(name, phone, pin) {
  phone = normalizePhone_(phone);
  var existing = rows_('accounts').filter(function(account) { return account.phone === phone; })[0];
  if (existing) {
    if (!secureEqual_(pinHash_(pin, existing.pinSalt), existing.pinHash)) throw new Error('This phone number already has an account. Enter its existing PIN.');
    return existing;
  }
  var now = isoNow_(), salt = randomCode_(20);
  var account = { userId: 'usr_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16), phone: phone, displayName: requiredText_(name, 'Name', 60), pinSalt: salt, pinHash: pinHash_(pin, salt), createdAt: now, updatedAt: now, status: 'active' };
  appendObject_('accounts', account);
  return account;
}

function createAccountSession_(userId) {
  var token = randomCode_(48), now = isoNow_();
  appendObject_('accountSessions', { tokenHash: hash_(token), userId: userId, expiresAt: new Date(Date.now() + SH_SESSION_DAYS * 86400000).toISOString(), createdAt: now, lastSeenAt: now });
  return token;
}

function createSession_(householdId, role) {
  var token = randomCode_(48);
  var expires = new Date(Date.now() + SH_SESSION_DAYS * 86400000).toISOString();
  appendObject_('sessions', { tokenHash: hash_(token), householdId: householdId, role: role, expiresAt: expires, createdAt: isoNow_(), lastSeenAt: isoNow_() });
  return token;
}

function audit_(householdId, role, action, entity, entityId, detail) {
  appendObject_('audit', { id: Utilities.getUuid(), householdId: householdId, at: isoNow_(), role: role, action: action, entity: entity, entityId: entityId, detail: detail || '' });
}

function database_() {
  var id = PropertiesService.getScriptProperties().getProperty('SAAF_HISAAB_DATABASE_ID');
  if (!id) throw new Error('Run setupSaafHisaab() in the Apps Script editor first.');
  var book = SpreadsheetApp.openById(id);
  ensureSchema_(book);
  return book;
}

function ensureSchema_(book) {
  var users = book.getSheetByName(SH_SHEETS.users);
  if (!users) {
    users = book.insertSheet(SH_SHEETS.users);
    initializeSheet_(users, SH_HEADERS.users);
  } else {
    var lastColumn = Math.max(1, users.getLastColumn());
    var headers = users.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
    if (headers.indexOf('phone') < 0) {
      var displayColumn = headers.indexOf('displayName') + 1;
      if (!displayColumn) throw new Error('Users sheet has an unsupported header layout.');
      users.insertColumnAfter(displayColumn);
      users.getRange(1, displayColumn + 1).setValue('phone').setFontWeight('bold').setBackground('#176b57').setFontColor('#ffffff');
    }
  }
  ['accounts','accountSessions','daily','toilet','payments','audit','households','sessions'].forEach(function(key) {
    var sheet = book.getSheetByName(SH_SHEETS[key]);
    if (!sheet) {
      sheet = book.insertSheet(SH_SHEETS[key]);
      initializeSheet_(sheet, SH_HEADERS[key]);
      return;
    }
    var lastColumn = Math.max(1, sheet.getLastColumn());
    var current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
    SH_HEADERS[key].forEach(function(header) {
      if (current.indexOf(header) < 0) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header).setFontWeight('bold').setBackground('#176b57').setFontColor('#ffffff');
        current.push(header);
      }
    });
  });
  PropertiesService.getScriptProperties().setProperty('SAAF_HISAAB_VERSION', SH_VERSION);
}

function migrateLegacyAccounts_() {
  var users = rows_('users'), accountRows = rows_('accounts');
  users.forEach(function(user) {
    if (!user.phone) return;
    var account = accountRows.filter(function(item) { return item.phone === user.phone; })[0];
    if (!account) {
      account = { userId: 'usr_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16), phone: user.phone, displayName: user.displayName, pinSalt: user.pinSalt, pinHash: user.pinHash, createdAt: user.createdAt || isoNow_(), updatedAt: isoNow_(), status: 'active' };
      appendObject_('accounts', account);
      accountRows.push(account);
    }
    var household = findRow_('households', function(row) { return row.householdId === user.householdId; });
    if (household) {
      var field = user.role === 'worker' ? 'workerUserId' : 'employerUserId';
      if (!household.object[field]) {
        household.object[field] = account.userId;
        updateObject_('households', household.rowNumber, household.object);
      }
    }
  });
}

function sheet_(key) {
  var sheet = database_().getSheetByName(SH_SHEETS[key]);
  if (!sheet) throw new Error('Database sheet is missing: ' + SH_SHEETS[key]);
  return sheet;
}

function rows_(key) {
  var sheet = sheet_(key), headers = SH_HEADERS[key], last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, headers.length).getValues().map(function(values) {
    var row = {}; headers.forEach(function(header, index) { row[header] = values[index] === null ? '' : String(values[index]); }); return row;
  });
}

function appendObject_(key, object) {
  var headers = SH_HEADERS[key];
  sheet_(key).appendRow(headers.map(function(header) { return object[header] === undefined ? '' : object[header]; }));
}

function updateObject_(key, rowNumber, object) {
  var headers = SH_HEADERS[key];
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

function userExportBlob_(account) {
  var pairs = pairsForAccount_(account), ids = pairs.map(function(pair) { return pair.pairId; });
  var includesPair = function(row) { return ids.indexOf(row.householdId) >= 0; };
  var payload = {
    format: 'saafhisaab-user-backup', version: 2, exportedAt: isoNow_(),
    account: { userId: account.userId, phone: account.phone, displayName: account.displayName }, pairs: pairs,
    households: rows_('households').filter(includesPair).map(function(row) {
      var copy = JSON.parse(JSON.stringify(row)); delete copy.joinCode; return copy;
    }),
    dailyLogs: rows_('daily').filter(includesPair), toiletLogs: rows_('toilet').filter(includesPair), requests: rows_('requests').filter(includesPair),
    payments: rows_('payments').filter(includesPair), audit: rows_('audit').filter(includesPair)
  };
  var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
  var name = 'SaafHisaab-' + account.phone.replace(/\D/g, '') + '-' + stamp + '.json.gz';
  return Utilities.gzip(Utilities.newBlob(JSON.stringify(payload), 'application/json', name.replace(/\.gz$/, ''))).setName(name);
}

function exportMyData_(account) {
  var blob = userExportBlob_(account), bytes = blob.getBytes();
  return { fileName: blob.getName(), mimeType: 'application/gzip', base64: Utilities.base64Encode(bytes), bytes: bytes.length, sha256: hashBytes_(bytes) };
}

function backupMyDataToDrive_(account) {
  var blob = userExportBlob_(account), folder = driveFolder_('SaafHisaab User Backups'), file = folder.createFile(blob);
  return { fileId: file.getId(), fileName: file.getName(), url: file.getUrl(), bytes: file.getSize() };
}

function backupDatabaseToDrive() {
  database_();
  var payload = { format: 'saafhisaab-database', version: 3, exportedAt: isoNow_(), sheets: {} };
  Object.keys(SH_SHEETS).forEach(function(key) {
    var sheet = sheet_(key), values = sheet.getDataRange().getValues();
    payload.sheets[key] = values.map(function(row) { return row.map(function(value) { return value instanceof Date ? value.toISOString() : value; }); });
  });
  var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
  var blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(payload), 'application/json', 'SaafHisaab-database-' + stamp + '.json')).setName('SaafHisaab-database-' + stamp + '.json.gz');
  var folder = driveFolder_('SaafHisaab Database Backups');
  var file = folder.createFile(blob), bytes = blob.getBytes();
  pruneBackupFolder_(folder, 14);
  return { fileId: file.getId(), fileName: file.getName(), url: file.getUrl(), bytes: bytes.length, sha256: hashBytes_(bytes) };
}

function restoreDatabaseFromDrive(fileId) {
  if (!fileId) throw new Error('Drive file ID is required.');
  var preRestore = backupDatabaseToDrive();
  var json = Utilities.ungzip(DriveApp.getFileById(String(fileId)).getBlob()).getDataAsString('UTF-8');
  var payload = JSON.parse(json);
  if (!payload || payload.format !== 'saafhisaab-database' || [2,3].indexOf(Number(payload.version)) < 0 || !payload.sheets) throw new Error('This is not a compatible SaafHisaab database backup.');
  return lockedWrite_(function() {
    var normalized = {};
    Object.keys(SH_SHEETS).forEach(function(key) {
      var values = payload.sheets[key];
      if ((!Array.isArray(values) || !values.length) && key === 'requests') values = [SH_HEADERS[key]];
      if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) throw new Error('Backup sheet is missing or incompatible: ' + key);
      var sourceHeaders = values[0].map(String);
      normalized[key] = [SH_HEADERS[key]].concat(values.slice(1).map(function(row) {
        return SH_HEADERS[key].map(function(header) { var index = sourceHeaders.indexOf(header); return index < 0 ? '' : row[index]; });
      }));
    });
    Object.keys(SH_SHEETS).forEach(function(key) {
      var sheet = sheet_(key), values = normalized[key];
      sheet.clear();
      sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
      sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold').setBackground('#176b57').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    });
    return { restored: true, sourceFileId: String(fileId), preRestoreBackup: preRestore };
  });
}

function ensureAutomaticBackupTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === 'backupDatabaseToDrive'; });
  if (!exists) ScriptApp.newTrigger('backupDatabaseToDrive').timeBased().everyDays(1).atHour(2).create();
  return { enabled: true, cadence: 'daily', retainedBackups: 14 };
}

function pruneBackupFolder_(folder, keep) {
  var files = [], iterator = folder.getFiles();
  while (iterator.hasNext()) files.push(iterator.next());
  files.sort(function(a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(keep).forEach(function(file) { file.setTrashed(true); });
}

function driveFolder_(name) {
  var matches = DriveApp.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : DriveApp.createFolder(name);
}

function hashBytes_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(byte) { var v = byte < 0 ? byte + 256 : byte; return ('0' + v.toString(16)).slice(-2); }).join('');
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
function normalizePhone_(value) { var raw = String(value || '').trim(); if (/[^0-9+()\s-]/.test(raw)) throw new Error('Phone number contains unsupported characters.'); var digits = raw.replace(/\D/g, ''); if (raw.indexOf('+') === 0 && digits.length >= 8 && digits.length <= 15) return '+' + digits; if (digits.length === 10) return '+91' + digits; if (digits.length === 11 && digits.indexOf('0') === 0) return '+91' + digits.slice(1); if (digits.length === 12 && digits.indexOf('91') === 0) return '+' + digits; throw new Error('Enter a 10-digit Indian phone number or include the country code, for example +919876543210.'); }
function loginAttemptKey_(phone) { return 'login_fail_' + hash_(phone).slice(0, 24); }
function enforceLoginRateLimit_(phone) { var failures = Number(CacheService.getScriptCache().get(loginAttemptKey_(phone)) || 0); if (failures >= 5) throw new Error('Too many failed attempts. Wait 15 minutes and try again.'); }
function recordLoginFailure_(phone) { var cache = CacheService.getScriptCache(); var key = loginAttemptKey_(phone); var failures = Number(cache.get(key) || 0) + 1; cache.put(key, String(failures), 900); }
function clearLoginFailures_(phone) { CacheService.getScriptCache().remove(loginAttemptKey_(phone)); }
function requiredText_(value, label, max) { var text = String(value || '').trim(); if (!text) throw new Error(label + ' is required.'); if (text.length > max) throw new Error(label + ' is too long.'); return text; }
function optionalText_(value, max) { var text = String(value || '').trim(); return text.slice(0, max); }
function boundedInt_(value, min, max) { var n = Math.floor(Number(value)); if (!isFinite(n)) n = min; return Math.max(min, Math.min(max, n)); }
function validateDate_(value) { var text = String(value || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || isNaN(new Date(text + 'T00:00:00Z').getTime())) throw new Error('Date is invalid.'); return text; }
function validateMonth_(value) { var text = String(value || ''); if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('Month is invalid.'); return text; }
function safeTime_(value) { var text = String(value || ''); return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : ''; }
function cleanError_(error) { return String(error && error.message ? error.message : error || 'Unexpected error').replace(/^Exception:\s*/, ''); }
function lockedWrite_(work) { var lock = LockService.getScriptLock(); lock.waitLock(20000); try { return work(); } finally { lock.releaseLock(); } }
function jsonOutput_(object) { return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON); }
