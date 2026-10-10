# Custom selection rules

Admins open **Selection Rules** from their workspace navigation. Faculty use the
same section in their faculty portal, scoped to their assigned domain.

1. Choose a non-frozen selection cycle.
2. Name the version and choose a scope and programme: HOPE, PEP or both.
3. Add conditions and select AND (all) or OR (any).
4. Preview against a student register number. This is read-only, not a decision.
5. Save a draft, then explicitly activate it from version history.

Admins can manage college-wide policies or any domain. Faculty can manage only
their assigned domain. Other policies remain visible but read-only. The API uses
the authenticated account's role and domain; supplied actor/domain headers cannot
grant permissions. Students cannot read or edit rule administration endpoints.

## Effects

- The existing college baseline remains required. College-wide custom rules add
  programme-specific requirements during official classification.
- Domain policies constrain generation, advisory placement and approval of
  allocations in that domain. They do not disqualify students from other domains.
- BOTH and programme-specific policies both apply. Active policies are combined
  with AND, regardless of each policy's internal AND/OR setting.
- Only one policy version may be active per cycle/scope/programme. Activation
  replaces the previous version for that combination, keeping its history.
- Rules do not change scoring weights, rank order or seat capacities.
- Saving, previewing, activating and deactivating do not rerun selection or alter
  existing official results. An admin must run official selection to update
  programme decisions. New domain placements and approvals use active rules.
- Frozen cycles reject rule mutations. Snapshot entries preserve programme
  eligibility and the policy evaluations used by classification.
- Classifications retain rule evaluations for student-facing reasons and next
  steps; changing the active policy does not rewrite historical explanations.

Supported numeric fields: CGPA, attendance, coding, aptitude, communication and
interview marks; verified certificate count; verified readiness total out of 250;
and all 12 verified Project 2 parameter scores. Comparisons: GTE, LTE, GT, LT, EQ,
NEQ and EXISTS. Missing/unverified marks fail comparisons and EXISTS; a verified
zero is available data. Thresholds respect known field maxima.

## API

Base: `/api/selection-rules`, Bearer authentication required.

| Method/path | Purpose |
| --- | --- |
| GET `/options` | Cycles, active domains and supported fields |
| GET `/cycles/:id` | Baseline and policy history, with scoped edit flags |
| POST `/` | Save immutable draft |
| POST `/preview` | Evaluate proposed criteria for a register number |
| POST `/:id/activate` | Activate version, replacing matching active version |
| POST `/:id/deactivate` | Deactivate version |

Example draft (replace IDs with values from options):

```json
{
  "selectionCycleId": "cycle-id",
  "domainId": "faculty-domain-id",
  "program": "BOTH",
  "name": "Domain entry requirements",
  "logic": "AND",
  "rules": [
    { "id": "cgpa-min", "field": "cgpa", "operator": "GTE", "value": 7.5 },
    { "id": "readiness-min", "field": "readinessScore", "operator": "GTE", "value": 150 }
  ]
}
```

For preview, add `registerNumber` to the same body. Preview reports the proposed
version and baseline separately: a proposed PASS is not a promise of selection.
Other policies, ranking and capacity may still prevent selection or allocation.

Rule changes and activations write audit records. Database constraints enforce
one active version per combination. Cycle row locks serialize activation and
recheck frozen status before committing. The policy table is not accessible via
Supabase anonymous/authenticated direct database roles.

No new college thresholds or active custom policies are seeded by this feature.
