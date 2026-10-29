# Extensible employee agreements

SaafHisaab 2.4 uses a profile-driven agreement. The cook-and-cleaner setup is now only the default profile; homeowners can add, remove, rename and price job functions for a driver, nanny, gardener, office assistant or another recurring worker. Each version also carries expected weekdays and optional employment boundaries for calendar completeness.

## Recommended model

Each homeowner-worker pair owns a versioned agreement:

```json
{
  "jobProfileName": "Cook & cleaner",
  "currency": "INR",
  "monthlySalary": 7000,
  "workingDays": 26,
  "paidLeaveDays": 4,
  "workWeekdays": [1, 2, 3, 4, 5, 6],
  "employmentStartDate": "2026-11-01",
  "employmentEndDate": "",
  "activities": [
    { "id": "cook-am", "label": "Morning cooking", "category": "Cooking", "cadence": "daily", "expectedPerMonth": 26, "monthlyAmount": 2500 },
    { "id": "cook-pm", "label": "Evening cooking", "category": "Cooking", "cadence": "daily", "expectedPerMonth": 26, "monthlyAmount": 2500 },
    { "id": "floor", "label": "Floor cleaning", "category": "Cleaning", "cadence": "daily", "expectedPerMonth": 26, "monthlyAmount": 900 },
    { "id": "toilet", "label": "Toilet cleaning", "category": "Cleaning", "cadence": "flexible", "expectedPerMonth": 4, "monthlyAmount": 300 }
  ]
}
```

The same schema can represent a driver, nanny, gardener, office assistant or any other recurring employee. The homeowner chooses a starter template, adds or removes activities, changes frequency and amounts, and previews the worker-visible agreement before saving.

## Rules that keep history auditable

- Never edit an agreement version that has payroll records. Create a new version with an effective month.
- Store activity IDs and labels with each flexible monthly record so deleting an activity from a future profile does not erase history.
- Category amounts are worker-visible; `monthlyAmount` and per-occurrence rates remain homeowner-only.
- Validate that category totals and internal weights each reconcile to the monthly salary before activation.
- A profile change is a homeowner-only action. Worker acknowledgement of a future agreement version remains a later governance enhancement.
- The calculation engine consumes the active agreement version; UI screens render the same categories and activities dynamically.
- Weekday scheduling governs which dates require a record. `workingDays` remains the agreed salary divisor; schedule variation never silently reprices a day.

## Plug-in / plug-out UX

1. Open employee > Account > Agreement.
2. Pick a template or start blank.
3. Add categories and functions; choose every-workday or flexible-times-per-month cadence.
4. Choose expected weekdays and optional employment start/end dates.
5. Enter expected occurrences and the monthly share.
6. Preview exactly what the worker will see.
7. Activate from a future month; the current and past months remain unchanged.

Existing cook-and-cleaner pairs are interpreted as the default profile when no explicit activity list exists. Saving from Account creates the first explicit version without rewriting locked months.
