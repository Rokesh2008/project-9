# Readiness and the 12 Project 2 modules

Student profiles (`GET /api/profiles/me`) and staff profile views
(`GET /api/profiles/:studentId`) return `readiness`: total out of 250,
verification status, assessment date, source, and all 12 module rows. Missing
marks are `null`, not zero. Confirmed zero marks remain zero.

This is a live assessment section, separate from the selection composite score
and any frozen official selection result. Displaying readiness does not change
eligibility, rank or allocation. Older Project 2 imports that supplied only a
`readinessScore` still display their total, with all module marks pending.

## Score-only integration

`POST https://project9-api.vercel.app/api/integrations/project2/readiness`

Required headers:

```http
Content-Type: application/json
x-integration-api-key: <server-only integration secret>
Idempotency-Key: <stable event identifier for retries>
```

An administrator/coordinator bearer token can replace the integration key.
Student and faculty accounts cannot import results.

```json
{
  "sourceBatchId": "project2-october-2026",
  "records": [{
    "registerNumber": "DEMO2026004",
    "sourceResultId": "demo-readiness-2026-v1",
    "assessedAt": "2026-10-07T00:00:00Z",
    "readinessScore": 5,
    "verificationStatus": "VERIFIED",
    "parameterScores": [{
      "parameterKey": "monthly_coding_assessment",
      "rawScore": 5,
      "verificationStatus": "VERIFIED"
    }]
  }]
}
```

This example is synthetic. Never use it as an actual student's result.

Each record is a complete assessment snapshot. Omitted modules display pending;
the API does not combine module marks across different snapshots. Maximum 500
records per request. Students must already exist and match by register number.
No CGPA, attendance, coding score, roster details or allocation is overwritten.

| Parameter key | Maximum |
|---|---:|
| `hundred_days_training` | 15 |
| `foreign_language` | 15 |
| `gate_higher_studies` | 25 |
| `competitions_hackathons` | 20 |
| `internship_startup` | 20 |
| `industry_academic_certificates` | 20 |
| `aptitude_communication` | 20 |
| `coding_problems` | 25 |
| `competitive_rating` | 20 |
| `open_source_contributions` | 20 |
| `monthly_coding_assessment` | 20 |
| `project_publication_patent` | 30 |

Module status is `NOT_STARTED`, `PENDING`, `VERIFIED` or `REJECTED`.
Verified modules require numeric marks. Not-started modules require null/omitted
marks. Total status is `PENDING`, `VERIFIED` or `REJECTED`. A verified total
requires numeric marks. When all 12 modules are verified, their sum must equal
the supplied total. A partial breakdown does not fabricate the other marks.

The database uses immutable `(studentId, sourceResultId)` records for replay
safety, regardless of the retry header. An identical result returns
`ignoredDuplicates`; changing an existing result ID returns 409. Use a new
result ID and assessment timestamp for corrections/revisions. The complete batch
runs in a transaction. Latest assessment date determines the displayed snapshot.

Data resides in `ReadinessAssessment`, with row-level security enabled and no
direct Supabase anonymous/authenticated table access. Real Excel students remain
pending until Project 2 supplies results. No synthetic assessments are seeded
for the college roster.
