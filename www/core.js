export const POLICY = Object.freeze({
  monthlySalary: 7000,
  workingDays: 26,
  paidLeaveDays: 4,
  cookingAmount: 5000,
  cleaningAmount: 1200,
  utensilsAmount: 800,
  floorInternalAmount: 900,
  toiletInternalAmount: 300,
  toiletPerMonth: 4,
});

export const TASKS = Object.freeze([
  ['morningCooking', 'Morning cooking'],
  ['eveningCooking', 'Evening cooking'],
  ['morningUtensils', 'Morning utensils'],
  ['eveningUtensils', 'Evening utensils'],
  ['floorCleaning', 'Floor cleaning'],
]);

export const DEFAULT_ACTIVITIES = Object.freeze([
  { id: 'morningCooking', label: 'Morning cooking', category: 'Cooking', cadence: 'daily', monthlyAmount: 2500, expectedPerMonth: 26 },
  { id: 'eveningCooking', label: 'Evening cooking', category: 'Cooking', cadence: 'daily', monthlyAmount: 2500, expectedPerMonth: 26 },
  { id: 'morningUtensils', label: 'Morning utensils', category: 'Utensils', cadence: 'daily', monthlyAmount: 400, expectedPerMonth: 26 },
  { id: 'eveningUtensils', label: 'Evening utensils', category: 'Utensils', cadence: 'daily', monthlyAmount: 400, expectedPerMonth: 26 },
  { id: 'floorCleaning', label: 'Floor cleaning', category: 'Cleaning', cadence: 'daily', monthlyAmount: 900, expectedPerMonth: 26 },
  { id: 'toiletCleaning', label: 'Toilet cleaning', category: 'Cleaning', cadence: 'flexible', monthlyAmount: 300, expectedPerMonth: 4 },
]);

export const OUTCOMES = Object.freeze({
  pending: 'Not logged',
  done: 'Completed',
  missed: 'Missed',
  not_required: 'Not required',
  cancelled: 'Household cancelled',
});

export const DEFAULT_WORK_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6]);

function normalizedWorkWeekdays(value) {
  const supplied = Array.isArray(value) ? value : DEFAULT_WORK_WEEKDAYS;
  const days = [...new Set(supplied.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return days.length ? days : [...DEFAULT_WORK_WEEKDAYS];
}

export function scheduledDatesForMonth(month, policy = POLICY) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const weekdays = new Set(normalizedWorkWeekdays(policy.workWeekdays));
  const activeFrom = /^\d{4}-\d{2}-\d{2}$/.test(policy.employmentStartDate || '') ? policy.employmentStartDate : '';
  const activeUntil = /^\d{4}-\d{2}-\d{2}$/.test(policy.employmentEndDate || '') ? policy.employmentEndDate : '';
  const dates = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (activeFrom && date < activeFrom) continue;
    if (activeUntil && date > activeUntil) continue;
    if (weekdays.has(new Date(`${date}T12:00:00`).getDay())) dates.push(date);
  }
  return dates;
}

export function isScheduledWorkday(date, policy = POLICY) {
  return scheduledDatesForMonth(String(date || '').slice(0, 7), policy).includes(date);
}

export function monthReadiness({ dailyLogs = [], policy = POLICY, month, today = dateKey() }) {
  const scheduledDates = scheduledDatesForMonth(month, policy);
  const byDate = new Map(dailyLogs.filter((log) => log.date?.startsWith(month)).map((log) => [log.date, log]));
  const scheduledLogs = scheduledDates.map((date) => byDate.get(date)).filter(Boolean);
  const missingDates = scheduledDates.filter((date) => !byDate.has(date));
  const futureDates = missingDates.filter((date) => date > today);
  const overdueMissingDates = missingDates.filter((date) => date <= today);
  return {
    scheduledDates,
    scheduledCount: scheduledDates.length,
    recordedCount: scheduledLogs.length,
    missingDates,
    missingCount: missingDates.length,
    futureDates,
    futureCount: futureDates.length,
    overdueMissingDates,
    overdueMissingCount: overdueMissingDates.length,
    notRequiredCount: scheduledLogs.filter((log) => log.dayType === 'not_required').length,
    leaveCount: scheduledLogs.filter((log) => log.dayType !== 'not_required' && ['half', 'full'].includes(log.leave)).length,
    normalCount: scheduledLogs.filter((log) => log.dayType !== 'not_required' && (!log.leave || log.leave === 'none')).length,
  };
}

export function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (/[^0-9+()\s-]/.test(raw)) throw new Error('Phone number contains unsupported characters.');
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  throw new Error('Enter a 10-digit Indian phone number or include the country code, for example +919876543210.');
}

export function groupPairs(pairs = []) {
  return {
    workingForMe: pairs.filter((pair) => pair.role === 'employer'),
    iWorkFor: pairs.filter((pair) => pair.role === 'worker'),
  };
}

function normalizedActivity(activity, index, workingDays) {
  const cadence = activity?.cadence === 'flexible' ? 'flexible' : 'daily';
  const id = String(activity?.id || `activity_${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  return {
    id,
    label: String(activity?.label || `Activity ${index + 1}`).slice(0, 80),
    category: String(activity?.category || 'Other').slice(0, 60),
    cadence,
    monthlyAmount: Math.max(0, Number(activity?.monthlyAmount || 0)),
    expectedPerMonth: cadence === 'daily' ? Math.max(1, Number(workingDays || 26)) : Math.max(1, Number(activity?.expectedPerMonth || 1)),
  };
}

export function activityDefinitions(policy = POLICY) {
  const workingDays = Math.max(1, Number(policy.workingDays || POLICY.workingDays));
  if (Array.isArray(policy.activities) && policy.activities.length) {
    return policy.activities.map((activity, index) => normalizedActivity(activity, index, workingDays));
  }
  const amounts = {
    morningCooking: Number(policy.cookingAmount ?? POLICY.cookingAmount) / 2,
    eveningCooking: Number(policy.cookingAmount ?? POLICY.cookingAmount) / 2,
    morningUtensils: Number(policy.utensilsAmount ?? POLICY.utensilsAmount) / 2,
    eveningUtensils: Number(policy.utensilsAmount ?? POLICY.utensilsAmount) / 2,
    floorCleaning: Number(policy.floorInternalAmount ?? POLICY.floorInternalAmount),
    toiletCleaning: Number(policy.toiletInternalAmount ?? POLICY.toiletInternalAmount),
  };
  return DEFAULT_ACTIVITIES.map((activity, index) => normalizedActivity({
    ...activity,
    monthlyAmount: amounts[activity.id],
    expectedPerMonth: activity.id === 'toiletCleaning' ? Number(policy.toiletPerMonth || POLICY.toiletPerMonth) : workingDays,
  }, index, workingDays));
}

export function categoryTotals(policy = POLICY) {
  if (policy.categoryAmounts && typeof policy.categoryAmounts === 'object') {
    const supplied = Object.fromEntries(Object.entries(policy.categoryAmounts).map(([key, value]) => [key, Number(value || 0)]));
    if (Object.keys(supplied).length && activityDefinitions(policy).every((activity) => activity.monthlyAmount === 0)) return supplied;
  }
  const totals = {};
  for (const activity of activityDefinitions(policy)) totals[activity.category] = (totals[activity.category] || 0) + activity.monthlyAmount;
  return totals;
}

export function rates(policy = POLICY) {
  const byActivity = Object.fromEntries(activityDefinitions(policy).map((activity) => [activity.id, activity.monthlyAmount / activity.expectedPerMonth]));
  return {
    daily: policy.monthlySalary / policy.workingDays,
    byActivity,
    cookingSession: byActivity.morningCooking || 0,
    utensilSession: byActivity.morningUtensils || 0,
    floor: byActivity.floorCleaning || 0,
    toilet: byActivity.toiletCleaning || 0,
  };
}

export function calculateMonth({ dailyLogs = [], toiletLogs = [], policy = POLICY, month }) {
  const r = rates(policy);
  const activities = activityDefinitions(policy);
  const confirmedDaily = dailyLogs.filter((x) => x.date?.startsWith(month) && x.approval === 'confirmed');
  const confirmedToilet = toiletLogs.filter((x) => x.month === month && x.approval === 'confirmed');
  let usedValue = 0;
  const audit = [];

  for (const log of confirmedDaily) {
    if (log.leave === 'full') {
      usedValue += r.daily;
      audit.push({ date: log.date, label: 'Full-day leave', value: r.daily });
      continue;
    }
    if (log.leave === 'half') {
      usedValue += r.daily / 2;
      audit.push({ date: log.date, label: 'Half-day leave', value: r.daily / 2 });
      continue;
    }
    for (const activity of activities.filter((item) => item.cadence === 'daily')) {
      const outcome = log.activityOutcomes?.[activity.id] ?? log.tasks?.[activity.id];
      if (outcome !== 'missed') continue;
      const value = r.byActivity[activity.id] || 0;
      usedValue += value;
      audit.push({ date: log.date, label: activity.label, activityId: activity.id, value });
    }
  }

  for (const log of confirmedToilet) {
    if (log.outcome !== 'missed') continue;
    const activity = activities.find((item) => item.id === (log.activityId || 'toiletCleaning')) || activities.find((item) => item.cadence === 'flexible');
    if (!activity) continue;
    const value = r.byActivity[activity.id] || 0;
    usedValue += value;
    audit.push({ date: log.completedDate || `${month} · ${activity.label} ${log.slot}`, label: `${activity.label} ${log.slot}`, activityId: activity.id, value });
  }

  const allowance = policy.paidLeaveDays * r.daily;
  const adjustment = Math.max(0, usedValue - allowance);
  const finalPayment = Math.max(0, policy.monthlySalary - adjustment);
  return { usedValue, allowance, adjustment, finalPayment, audit, rates: r };
}

export function salaryPosition({ dailyLogs = [], toiletLogs = [], policy = POLICY, month }) {
  const confirmed = calculateMonth({ dailyLogs, toiletLogs, policy, month });
  const includePending = (entry) => entry.approval === 'pending' ? { ...entry, approval: 'confirmed' } : entry;
  const projected = calculateMonth({
    dailyLogs: dailyLogs.map(includePending),
    toiletLogs: toiletLogs.map(includePending),
    policy,
    month,
  });
  const dailyRate = confirmed.rates.daily || 1;
  return {
    confirmed,
    projected,
    allowanceDays: policy.paidLeaveDays,
    confirmedEquivalentDays: confirmed.usedValue / dailyRate,
    pendingEquivalentDays: Math.max(0, projected.usedValue - confirmed.usedValue) / dailyRate,
    remainingAllowanceDays: Math.max(0, policy.paidLeaveDays - confirmed.usedValue / dailyRate),
    pendingPossibleAdjustment: Math.max(0, projected.adjustment - confirmed.adjustment),
  };
}

export function missedActivityRows(dailyLogs = [], toiletLogs = [], month, policy = POLICY) {
  const rows = [];
  const activities = activityDefinitions(policy);
  for (const log of dailyLogs.filter((x) => x.date?.startsWith(month))) {
    if (log.leave === 'full' || log.leave === 'half') {
      rows.push({ date: log.date, label: log.leave === 'full' ? 'Full-day leave' : 'Half-day leave', approval: log.approval, outcome: 'leave' });
    }
    if (log.leave === 'none' || !log.leave) {
      for (const activity of activities.filter((item) => item.cadence === 'daily')) {
        const outcome = log.activityOutcomes?.[activity.id] ?? log.tasks?.[activity.id];
        if (outcome === 'missed') rows.push({ date: log.date, label: activity.label, activityId: activity.id, approval: log.approval, outcome: 'missed' });
      }
    }
  }
  for (const log of toiletLogs.filter((x) => x.month === month && x.outcome === 'missed')) {
    const activity = activities.find((item) => item.id === (log.activityId || 'toiletCleaning')) || { id: log.activityId, label: log.activityLabel || 'Flexible activity' };
    rows.push({ date: log.completedDate || `Occurrence ${log.slot}`, label: `${activity.label} ${log.slot}`, activityId: activity.id, approval: log.approval, outcome: 'missed' });
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function money(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
}

export function monthKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 7);
}

export function dateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizePolicy(profile = {}) {
  const raw = profile.policy || profile;
  const merged = { ...POLICY, ...raw };
  merged.jobProfileName = String(raw.jobProfileName || 'Cook & cleaner').slice(0, 80);
  merged.workWeekdays = normalizedWorkWeekdays(raw.workWeekdays);
  merged.employmentStartDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.employmentStartDate || '') ? raw.employmentStartDate : '';
  merged.employmentEndDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.employmentEndDate || '') ? raw.employmentEndDate : '';
  if (merged.employmentStartDate && merged.employmentEndDate && merged.employmentEndDate < merged.employmentStartDate) merged.employmentEndDate = '';
  if (raw.compensationHidden === true) {
    merged.compensationHidden = true;
    merged.activities = activityDefinitions({ ...merged, activities: (raw.activities || []).map((activity) => ({ ...activity, monthlyAmount: 0 })) });
    merged.categoryAmounts = {};
    merged.monthlySalary = 0;
    merged.cookingAmount = 0;
    merged.utensilsAmount = 0;
    merged.cleaningAmount = 0;
    merged.floorInternalAmount = 0;
    merged.toiletInternalAmount = 0;
    return merged;
  }
  merged.activities = activityDefinitions(merged);
  const categories = categoryTotals(merged);
  merged.monthlySalary = Object.values(categories).reduce((sum, value) => sum + value, 0) || Number(raw.monthlySalary || POLICY.monthlySalary);
  merged.cookingAmount = categories.Cooking ?? Number(raw.cookingAmount ?? POLICY.cookingAmount);
  merged.utensilsAmount = categories.Utensils ?? Number(raw.utensilsAmount ?? POLICY.utensilsAmount);
  merged.cleaningAmount = categories.Cleaning ?? Number(raw.cleaningAmount ?? POLICY.cleaningAmount);
  return merged;
}

export function policyForMonth(profile = {}, month = monthKey()) {
  const history = Array.isArray(profile.policyHistory) ? profile.policyHistory : [];
  const eligible = history
    .filter((entry) => /^\d{4}-\d{2}$/.test(entry?.effectiveMonth || '') && entry.effectiveMonth <= month)
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  return sanitizePolicy(eligible.at(-1)?.policy || profile.policy || profile);
}
