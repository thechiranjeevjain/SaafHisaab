# Extensible employee agreements

SaafHisaab 2.x deliberately keeps the first pilot agreement fixed while the shared-ledger, authorization, salary and recovery flows are proven. The next model should be profile-driven before unrelated employee types are added.

## Recommended model

Each homeowner-worker pair owns a versioned agreement:

```json
{
  "roleTitle": "Cook and cleaner",
  "currency": "INR",
  "monthlySalary": 7000,
  "workingDays": 26,
  "paidLeaveDays": 4,
  "categories": [
    { "id": "food", "label": "Cooking", "visibleAmount": 5000 },
    { "id": "cleaning", "label": "Cleaning", "visibleAmount": 1200 },
    { "id": "utensils", "label": "Utensils", "visibleAmount": 800 }
  ],
  "activities": [
    { "id": "cook-am", "label": "Morning cooking", "categoryId": "food", "cadence": "daily", "expectedPerMonth": 26, "internalWeight": 2500 },
    { "id": "cook-pm", "label": "Evening cooking", "categoryId": "food", "cadence": "daily", "expectedPerMonth": 26, "internalWeight": 2500 },
    { "id": "floor", "label": "Floor cleaning", "categoryId": "cleaning", "cadence": "daily", "expectedPerMonth": 26, "internalWeight": 900 },
    { "id": "toilet", "label": "Toilet cleaning", "categoryId": "cleaning", "cadence": "monthly", "expectedPerMonth": 4, "internalWeight": 300 }
  ]
}
```

The same schema can represent a driver, nanny, gardener, office assistant or any other recurring employee. The homeowner chooses a starter template, adds or removes activities, changes frequency and amounts, and previews the worker-visible agreement before saving.

## Rules that keep history auditable

- Never edit an agreement version that has payroll records. Create a new version with an effective month.
- Store activity IDs and labels with each monthly record so deleting an activity from a future profile does not erase history.
- Category amounts are worker-visible; `internalWeight` and per-occurrence rates remain homeowner-only.
- Validate that category totals and internal weights each reconcile to the monthly salary before activation.
- A profile change is a homeowner action and should require worker acknowledgement before its effective month.
- The calculation engine consumes the active agreement version; UI screens render the same categories and activities dynamically.

## Plug-in / plug-out UX

1. Open employee > Account > Agreement.
2. Pick a template or start blank.
3. Add a category and activities; choose daily, weekly or monthly cadence.
4. Enter expected occurrences and the monthly share.
5. Preview exactly what the worker will see.
6. Activate from a future month; the current and past months remain unchanged.

The implementation should migrate existing cook-and-cleaner pairs into version 1 of this schema automatically. Until that migration is shipped and tested, 2.x must not pretend that adding an arbitrary job title changes the payroll tasks.
