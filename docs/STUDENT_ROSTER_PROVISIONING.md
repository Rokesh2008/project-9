# Second-year roster provisioning

The local provisioning script accepts the institution roster without assessment data.
It uses register numbers as student identifiers and login IDs, including alphanumeric
register numbers. Faculty and administrators continue to log in with email addresses.
The API retains the `email` request field for compatibility; its value can be a
student register number when calling `POST /api/auth/login`.

Run `apps/api/scripts/import-second-year.cjs` from the repository root with
`--file <local XLSX path> --academic-year <YYYY-YYYY>`. Set `DATABASE_URL` to the
intended local database. The default is a read-only validation/dry run. Back up the
database before applying. Supply `ROSTER_INITIAL_PASSWORD` through the environment
and add `--apply` to create records in one transaction. Do not commit the spreadsheet,
password, database backup, or a credential export to Git.

The importer:

- Requires Register Number, Name of the Student, Dept and College headers.
- Deduplicates identical student identities and aborts on conflicting identities.
- Separates Engineering (SJCE) and Technology (SJCT) departments and second-year batches.
- Preserves existing student accounts and their passwords on repeat runs.
- Creates student-only accounts with individually salted scrypt password hashes.
- Uses an internal `<register-number>@students.project9.local` account address;
  this is not a real student email and must never be used for notifications.
- Leaves CGPA, attendance, assessments and cycle membership unset. Training-group
  labels in the roster are not converted into official HOPE/PEP classifications.

Students can read only their linked profile. With no assessment data or selection
cycle, the portal explicitly shows assessment data pending, blank scores and no
selection decision. The existing cycle-based selection pipeline does not include
these roster-only students until they are enrolled and assessed.

`verify-second-year.cjs` checks password hashes, empty assessment/selection state
and representative live register-number logins without printing personal records,
password hashes or access tokens. Run it with the same database/password environment.
It is a provisioning-time check, not intended after later assessments are imported.

Shared initial passwords are temporary and not production-safe. Replace them with
individual strong passwords through administrator account management before real
deployment. Account password creation/reset validation remains unchanged; there is
no automatic first-login password-change requirement yet.

## Existing Excel allocations

`import-roster-allocations.cjs --file <local XLSX path>` validates existing students
and the training-group (column F) and training-level (column G) assignments. The
default is a dry run; `--apply` inserts them atomically into `RosterAllocation`.
It records the source filename, worksheet, row numbers and SHA-256 hash, skips
identical duplicate rows, and refuses conflicting assignments. Repeat runs preserve
existing allocations and account passwords. No raw source or student list is saved
in the repository.

These are existing college-provided allocations, not algorithmic decisions for a
new selection cycle. They do not create assessment scores, eligibility/rankings,
HOPE/PEP classifications, capacity changes, fake faculty approvals or freezes.
Students see their imported group and training level separately from future cycle
results. Administrators and faculty can search and filter the read-only **Excel
Allocations** directory at `GET /api/profiles/roster-allocations`. Students cannot
access that staff directory or other students’ profiles.
