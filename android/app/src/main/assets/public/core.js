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

export const OUTCOMES = Object.freeze({
  pending: 'Not logged',
  done: 'Completed',
  missed: 'Missed',
  not_required: 'Not required',
  cancelled: 'Household cancelled',
});

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

export function rates(policy = POLICY) {
  return {
    daily: policy.monthlySalary / policy.workingDays,
    cookingSession: policy.cookingAmount / (policy.workingDays * 2),
    utensilSession: policy.utensilsAmount / (policy.workingDays * 2),
    floor: policy.floorInternalAmount / policy.workingDays,
    toilet: policy.toiletInternalAmount / policy.toiletPerMonth,
  };
}

export function calculateMonth({ dailyLogs = [], toiletLogs = [], policy = POLICY, month }) {
  const r = rates(policy);
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
    for (const [key, label] of TASKS) {
      if (log.tasks?.[key] !== 'missed') continue;
      const value = key.includes('Cooking') ? r.cookingSession : key.includes('Utensils') ? r.utensilSession : r.floor;
      usedValue += value;
      audit.push({ date: log.date, label, value });
    }
  }

  for (const log of confirmedToilet) {
    if (log.outcome !== 'missed') continue;
    usedValue += r.toilet;
    audit.push({ date: log.completedDate || `${month} · toilet ${log.slot}`, label: `Toilet cleaning ${log.slot}`, value: r.toilet });
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

export function missedActivityRows(dailyLogs = [], toiletLogs = [], month) {
  const rows = [];
  for (const log of dailyLogs.filter((x) => x.date?.startsWith(month))) {
    if (log.leave === 'full' || log.leave === 'half') {
      rows.push({ date: log.date, label: log.leave === 'full' ? 'Full-day leave' : 'Half-day leave', approval: log.approval, outcome: 'leave' });
    }
    if (log.leave === 'none' || !log.leave) {
      for (const [key, label] of TASKS) {
        if (log.tasks?.[key] === 'missed') rows.push({ date: log.date, label, approval: log.approval, outcome: 'missed' });
      }
    }
  }
  for (const log of toiletLogs.filter((x) => x.month === month && x.outcome === 'missed')) {
    rows.push({ date: log.completedDate || `Window ${log.slot}`, label: `Toilet cleaning ${log.slot}`, approval: log.approval, outcome: 'missed' });
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
  return { ...POLICY, ...(profile.policy || profile) };
}

export function policyForMonth(profile = {}, month = monthKey()) {
  const history = Array.isArray(profile.policyHistory) ? profile.policyHistory : [];
  const eligible = history
    .filter((entry) => /^\d{4}-\d{2}$/.test(entry?.effectiveMonth || '') && entry.effectiveMonth <= month)
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  return sanitizePolicy(eligible.at(-1)?.policy || profile.policy || profile);
}
