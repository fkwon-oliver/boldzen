# Pilot E2E Runbook

Repo-specific operator runbook to configure and execute the migration tool locally and test three pilot scenarios end-to-end.

---

## A. Preconditions

| Requirement | Version / Detail |
|---|---|
| Node.js | >= 18.0.0 |
| PostgreSQL | Any 14+ (local or Docker) |
| Zendesk sandbox or test instance | Admin access, API token, ability to create custom ticket fields |
| BoldDesk instance | API key with ticket/contact create permissions |
| git | repo cloned locally |

You do **not** need Docker, Redis, or any queue infrastructure.

---

## B. Local Setup

### B1. Clone and install

```powershell
cd "C:\Users\Foster K\Documents\Zendesk to BoldDesk Migration Tool"
npm install
```

### B2. Create `.env`

Copy the example and fill in real values (details in sections C and D):

```powershell
copy .env.example .env
```

The file must contain every variable listed below. The app throws on startup if any `required()` variable is missing.

### B3. Required environment variables

| Variable | Required | Source | Notes |
|---|---|---|---|
| `ZENDESK_SUBDOMAIN` | Yes | Zendesk Admin → Account → Subdomain | e.g. `yourcompany` (not the full URL) |
| `ZENDESK_EMAIL` | Yes | Zendesk agent/admin email | Must be an active admin or agent |
| `ZENDESK_API_TOKEN` | Yes | Zendesk Admin → Apps & Integrations → Zendesk API → API token | Generate or use existing token |
| `BOLDDESK_BASE_URL` | Yes | BoldDesk instance | e.g. `https://yourcompany.bolddesk.com` (no trailing slash) |
| `BOLDDESK_API_KEY` | Yes | BoldDesk Developer Portal → API Keys | Needs ticket + contact permissions |
| `BOLDDESK_BRAND_ID` | No | BoldDesk brand ID | Default `1`; confirm in BoldDesk Admin → Brands |
| `DATABASE_URL` | Yes | Your local PostgreSQL | e.g. `postgres://migrator:migrator@localhost:5432/migration` |
| `MIGRATION_BATCH_SIZE` | No | - | Default `50`. Leave default for testing |
| `LOG_LEVEL` | No | - | `info` (default) or `debug` for verbose output |
| `RETRY_MAX_ATTEMPTS` | No | - | Default `3`. Set to `2` for faster scenario 3 testing |
| `RETRY_BACKOFF_BASE_MS` | No | - | Default `2000`. Set to `500` for faster testing |
| `ZD_FIELD_OWNER_SYSTEM` | Yes (pilot) | Zendesk custom field ID | See section C |
| `ZD_FIELD_SYNC_STATE` | Yes (pilot) | Zendesk custom field ID | See section C |
| `ZD_FIELD_BOLDDESK_TICKET_ID` | Yes (pilot) | Zendesk custom field ID | See section C |
| `PILOT_HANDOFF_TAG` | No | - | Default `handled_in_bolddesk` |
| `PILOT_PENDING_SYNC_TAG` | No | - | Default `pending_bolddesk_sync` |

### B4. Database startup and migrations

**Option A — Local PostgreSQL (already installed):**

```powershell
# Create the database (adjust user/password to match your local install)
psql -U postgres -c "CREATE DATABASE migration;"
psql -U postgres -c "CREATE USER migrator WITH PASSWORD 'migrator';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE migration TO migrator;"
# On PG 15+ you also need:
psql -U postgres -d migration -c "GRANT ALL ON SCHEMA public TO migrator;"
```

**Option B — Docker (recommended for isolation):**

```powershell
docker run -d --name migration-pg -e POSTGRES_USER=migrator -e POSTGRES_PASSWORD=migrator -e POSTGRES_DB=migration -p 5432:5432 postgres:16-alpine
```

Wait a few seconds for the container to start, then set in `.env`:

```
DATABASE_URL=postgres://migrator:migrator@localhost:5432/migration
```

**Apply schema migrations:**

```powershell
npm run db:migrate
```

Expected output:

```
Applying 001_initial_schema.sql...
Applied 001_initial_schema.sql
Applying 002_retry_support.sql...
Applied 002_retry_support.sql
All migrations applied.
```

> **Warning:** The migration runner re-applies all SQL files every run. The `001` file uses `CREATE TABLE IF NOT EXISTS` so it's safe. The `002` file uses `ADD COLUMN IF NOT EXISTS` so it's safe. However, the `DELETE FROM failed_items` dedup statement in `002` runs every time — on an empty database this is harmless. On a database with real data, it deletes duplicate rows.

### B5. Verify unit tests pass

```powershell
npm test
```

All 14 test files should pass. If any fail, stop here — the repo is not in a runnable state.

---

## C. Zendesk Setup

### C0. Understanding the two sync-state models

The app uses **two separate state models** that must not be confused:

| Model | Values | Source of truth | Purpose |
|---|---|---|---|
| **Derived sync state** | `pending`, `partial`, `complete`, `failed` | Computed at runtime from `entity_mappings` + `failed_items` tables (`deriveTicketSyncState()` in `src/pilot/sync-state.ts`) | **Authoritative for the handoff gate.** The gate checks `syncState !== "complete"` and blocks if not met. |
| **Zendesk custom field values** | `migrated`, `pilot_active`, `sync_error` | Written TO Zendesk AFTER the handoff gate passes or fails | Display/coordination states for Zendesk agents. Not read by the gate. |

The handoff gate (`pilot.service.ts` line 126) **never reads the Zendesk Sync State field** to make its allow/block decision. It computes derived sync state from the database every time. The Zendesk field values are outputs, not inputs, of the gate.

`pilot-status` shows both: `Derived sync state` (from DB) and `Zendesk sync field` (from Zendesk API). When they disagree, derived sync state is authoritative.

### C1. Create three custom ticket fields

Go to **Zendesk Admin → Objects and Rules → Tickets → Fields** and create:

| Field Title | Field Type | Field Options (dropdown values) | Purpose |
|---|---|---|---|
| `Owner System` | Drop-down | `zendesk`, `bolddesk` | Tracks which system owns the ticket |
| `Sync State` | Drop-down | `migrated`, `pilot_active`, `sync_error` | Display state written by the app after handoff/rollback/failure |
| `BoldDesk Ticket ID` | Text | (free text) | Stores the destination ticket ID |

> **Note on `not_synced`:** The app never writes `not_synced` to this field. The `pilot-status` CLI command displays `not_synced` as a fallback when the field has no value. You may optionally add it as a dropdown option for manual use, but the app does not require it.

After saving each field, note the **Field ID** (visible in the URL when editing the field, or in the field settings panel — it's a numeric ID like `12345678`).

Set them in `.env`:

```
ZD_FIELD_OWNER_SYSTEM=<numeric_field_id>
ZD_FIELD_SYNC_STATE=<numeric_field_id>
ZD_FIELD_BOLDDESK_TICKET_ID=<numeric_field_id>
```

### C2. API token

Go to **Admin → Apps & Integrations → Zendesk API**:
- Enable Token Access
- Generate a new API Token (or use an existing one)
- Copy it into `ZENDESK_API_TOKEN`

### C3. Verify Zendesk connectivity

Quick smoke test from PowerShell:

```powershell
$subdomain = "yourcompany"
$email = "admin@example.com"
$token = "your_token"
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${email}/token:${token}"))
Invoke-RestMethod -Uri "https://${subdomain}.zendesk.com/api/v2/tickets?page[size]=1" -Headers @{Authorization="Basic $encoded"}
```

You should get a JSON response with a `tickets` array. If you get 401, your email or token is wrong.

### C4. Create or identify test tickets

You need **three test tickets** (one per scenario), or one ticket with a DB reset between runs.

**Scenario 1 ticket (clean path) — NO ATTACHMENTS:**
- At least 2 comments (one public reply, one internal note)
- **No attachments** on any comment
- Status: `open` or `pending` (not `closed`)

> **Why no attachments:** There is a confirmed bug where `uploadAttachment` returns tokens but `addReply`/`addNote` in the BoldDesk connector do not pass them in the request body (`attachments` field is omitted). Attachments are uploaded as orphans to BoldDesk storage but never linked to comments. The migration reports success silently. Using a ticket with attachments for the clean path would produce a false positive — the test would "pass" but BoldDesk comments would be missing attachments. Test attachment migration separately after the bug is fixed.

**Scenario 2 and 3 tickets (failure paths):**
- At least 2 comments (one public reply, one internal note)
- Attachments are optional (the failure is simulated via DB seeding)
- Status: `open` or `pending` (not `closed`)

**To create a test ticket:** submit a ticket as an end-user, add an internal note as an agent, reply publicly.

Record the **Zendesk ticket ID** (the numeric ID visible in the URL: `https://<subdomain>.zendesk.com/agent/tickets/<ID>`).

```
TEST_TICKET_1_ID=50041
TEST_TICKET_2_ID=50042
TEST_TICKET_3_ID=50043
```

(These are for your notes — not env vars the app reads.)

---

## D. BoldDesk Setup

### D1. API key

Go to **BoldDesk → Admin → API Keys** (or Developer Portal):
- Generate an API key with permissions for: Contacts, Contact Groups, Tickets, Ticket Conversations, Attachments.
- Copy into `BOLDDESK_API_KEY`.

### D2. Brand ID

Go to **BoldDesk → Admin → Brands** and note the numeric Brand ID for the brand you want tickets created under. Default is usually `1`. Set `BOLDDESK_BRAND_ID` accordingly.

### D3. Verify BoldDesk connectivity

```powershell
$baseUrl = "https://oliversolutions.bolddesk.com"
$apiKey = "<BOLDDESK API>"
Invoke-RestMethod -Uri "${baseUrl}/api/v1/contacts?pageSize=1" -Headers @{"x-api-key"=$apiKey}
```

You should get a JSON response with a `data` array. If you get 401 or 403, the API key is wrong or lacks permissions.

### D4. Confirm status IDs

BoldDesk uses numeric status/priority IDs that can differ per instance. The codebase is configured for this instance:

| Status (code key) | BoldDesk UI label | ID | Priority (code key) | BoldDesk UI label | ID |
|---|---|---|---|---|---|
| new | New | 1 | low | Low | 1 |
| open | Open | 2 | medium | Normal | 2 |
| pending | Waiting for Customer | 3 | high | High | 3 |
| on_hold | On Hold | 4 | urgent | Critical | 4 |
| resolved | Solved | 5 | | | |
| closed | Closed | 6 | | | |

These IDs are set in `src/connectors/bolddesk/bolddesk.types.ts` (`BOLDDESK_STATUS_IDS` and `BOLDDESK_PRIORITY_IDS`). If your BoldDesk instance changes statuses, update the IDs there.

---

## E. Run Commands

All CLI commands use the `dev` script (ts-node, no build needed):

| Action | Command |
|---|---|
| Migrate single ticket | `npm run dev -- migrate-ticket --ticket-id <ZD_ID>` |
| Run full historical migration | `npm run dev -- run` |
| Retry failed items | `npm run dev -- retry --job-id <JOB_ID>` |
| Reconciliation report | `npm run dev -- reconcile --job-id <JOB_ID>` |
| Pilot handoff | `npm run dev -- pilot-handoff --ticket-id <ZD_ID>` |
| Pilot rollback | `npm run dev -- pilot-rollback --ticket-id <ZD_ID>` |
| Pilot status | `npm run dev -- pilot-status --ticket-id <ZD_ID>` |
| Apply DB migrations | `npm run db:migrate` |
| Run unit tests | `npm test` |

---

## F. Scenario 1 — Clean Path

**Goal:** Migrate a complete ticket, verify `sync_state=complete`, verify handoff succeeds.

### F1. Migrate the ticket

```powershell
npm run dev -- migrate-ticket --ticket-id <TEST_TICKET_ID>
```

Expected output (structured summary):

```
── MIGRATE TICKET ──
Zendesk ticket: #<TEST_TICKET_ID>
Job:            #<JOB_ID>
Status:         completed
Processed:      1
Failed:         0
```

If `Status` is `failed` or `completed_with_errors`, the CLI will print the failed items and their error messages. **Do not proceed to F2 until Status is `completed` with 0 failures.** Check section J (troubleshooting) if the migration fails.

Note the **job ID** from the output.

### F2. Check pilot status

```powershell
npm run dev -- pilot-status --ticket-id <TEST_TICKET_ID>
```

Expected output:

```
── PILOT STATUS ──
Zendesk ticket:      #<TEST_TICKET_ID>
Owner system:        unknown
Derived sync state:  complete
Zendesk sync field:  not_synced
BoldDesk ticket:     (none)
Migration mapping:   yes
Unresolved failures: 0
```

Key check: **Derived sync state** must be `complete`.

### F3. Verify in database

```sql
-- Find the job
SELECT id, name, status, processed_items, failed_items
FROM migration_jobs
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_ID>'
ORDER BY id DESC LIMIT 1;
-- Expected: status = 'completed', failed_items = 0

-- Check entity mappings
SELECT entity_type, source_id, destination_id
FROM entity_mappings
WHERE source_id = '<TEST_TICKET_ID>' AND entity_type = 'ticket';
-- Expected: one row with the BoldDesk ticket ID

-- Check comment mappings exist
SELECT entity_type, source_id, destination_id
FROM entity_mappings
WHERE entity_type = 'comment';
-- Expected: one row per comment in the test ticket

-- Check no unresolved failed items
SELECT * FROM failed_items
WHERE (entity_type = 'ticket' AND source_id = '<TEST_TICKET_ID>')
   OR (metadata->>'ticketSourceId' = '<TEST_TICKET_ID>');
-- Expected: 0 rows

-- Check audit log
SELECT action, detail FROM audit_log
WHERE source_id = '<TEST_TICKET_ID>'
ORDER BY created_at;
-- Expected: 'migrated' action
```

### F4. Execute handoff

```powershell
npm run dev -- pilot-handoff --ticket-id <TEST_TICKET_ID>
```

Expected output:

```
── PILOT HANDOFF ──
Zendesk ticket: #<TEST_TICKET_ID>
BoldDesk ticket: #<BOLDDESK_ID>
Status:          handed_off
Sync state:      complete
```

### F5. Verify in Zendesk UI

Open the ticket in Zendesk Agent (`https://<subdomain>.zendesk.com/agent/tickets/<TEST_TICKET_ID>`):

- [ ] Custom field **Owner System** = `bolddesk`
- [ ] Custom field **Sync State** = `pilot_active`
- [ ] Custom field **BoldDesk Ticket ID** = the BoldDesk ID from output
- [ ] Tag `handled_in_bolddesk` is present
- [ ] An internal note exists: "This ticket is now managed in BoldDesk (ticket #...)."

### F6. Verify in BoldDesk UI

Open BoldDesk and find the ticket by the destination ID from the mapping:

- [ ] Ticket exists with correct subject
- [ ] Public replies are present and in chronological order
- [ ] Internal notes are present as private notes

> **Attachment verification is skipped for Scenario 1.** The test ticket intentionally has no attachments because of the confirmed attachment-linking bug (see section C4). Do not add attachments to the Scenario 1 ticket.

### F7. Verify pilot status post-handoff

```powershell
npm run dev -- pilot-status --ticket-id <TEST_TICKET_ID>
```

Expected:

```
Owner system:        bolddesk
Derived sync state:  complete
Zendesk sync field:  pilot_active
BoldDesk ticket:     <BOLDDESK_ID>
Migration mapping:   yes
Unresolved failures: 0
```

### F8. Verify audit log

```sql
SELECT action, detail FROM audit_log
WHERE source_id = '<TEST_TICKET_ID>'
ORDER BY created_at;
```

Expected actions: `migrated`, `pilot_handoff`.

---

## G. Scenario 2 — Partial Failure

**Goal:** Force a comment failure, verify `failed_items` persisted, verify `sync_state=partial`, verify handoff blocked.

### G0. Prerequisites

Use a **different test ticket** than scenario 1 (or reset — see below). The ticket must have at least 2 comments.

### G1. Migrate the ticket (clean)

```powershell
npm run dev -- migrate-ticket --ticket-id <TEST_TICKET_2_ID>
```

Confirm it succeeds (status=completed, 0 failed items). Record the **job ID**:

```sql
SELECT id FROM migration_jobs
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_2_ID>'
ORDER BY id DESC LIMIT 1;
```

### G2. Seed a simulated comment failure

Pick one comment mapping to "undo" and record its source_id:

```sql
-- Find a comment that was migrated for this ticket
SELECT em.source_id AS comment_source_id
FROM entity_mappings em
WHERE em.entity_type = 'comment'
  AND em.source_id IN (
    -- This subquery is illustrative; comment source IDs won't directly reference tickets
    -- in entity_mappings. Pick any comment source_id you know belongs to this ticket.
    SELECT source_id FROM entity_mappings WHERE entity_type = 'comment'
  )
LIMIT 1;
```

Alternatively, check Zendesk for comment IDs:

```powershell
$subdomain = "yourcompany"
$encoded = "<base64_token>"  # from section C3
Invoke-RestMethod -Uri "https://${subdomain}.zendesk.com/api/v2/tickets/<TEST_TICKET_2_ID>/comments" -Headers @{Authorization="Basic $encoded"}
```

Pick a comment ID. Then:

```sql
-- Delete the comment mapping (simulates it never being migrated)
DELETE FROM entity_mappings
WHERE entity_type = 'comment' AND source_id = '<COMMENT_SOURCE_ID>';

-- Insert a failed_item to simulate the failure
INSERT INTO failed_items (job_id, entity_type, source_id, error, retry_count, last_attempt_at, status, metadata)
VALUES (
  <JOB_ID>,
  'comment',
  '<COMMENT_SOURCE_ID>',
  'Simulated BoldDesk API error for testing',
  0,
  NOW(),
  'pending',
  '{"ticketSourceId": "<TEST_TICKET_2_ID>"}'
);
```

### G3. Verify sync state is partial

```powershell
npm run dev -- pilot-status --ticket-id <TEST_TICKET_2_ID>
```

Expected:

```
Derived sync state:  partial
Unresolved failures: 1
```

### G4. Verify handoff is blocked

```powershell
npm run dev -- pilot-handoff --ticket-id <TEST_TICKET_2_ID>
```

Expected:

```
── PILOT HANDOFF ──
Zendesk ticket: #<TEST_TICKET_2_ID>
BoldDesk ticket: #<BOLDDESK_ID>
Status:          blocked
Sync state:      partial
Blocked reasons:
  - Derived sync state is "partial" (requires "complete"). Unresolved failed items: 1
```

### G5. Verify failed_items in database

```sql
SELECT id, entity_type, source_id, error, retry_count, status, metadata
FROM failed_items
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_2_ID>';
```

Expected: 1 row, `status = 'pending'`, `retry_count = 0`.

### G6. Verify Zendesk UI

The ticket custom fields should be **unchanged** (handoff was blocked, no writes happened):

- [ ] Owner System: empty/unset or `zendesk`
- [ ] Sync State: empty/unset
- [ ] No `handled_in_bolddesk` tag added

### G7. Resolve and retry (optional — proves recovery to clean state)

> **SAFETY WARNING:** Option A below is a **test-only workaround**. Manually marking a failed_item as `resolved` when the comment was never actually migrated makes `deriveTicketSyncState` return `complete`, which unblocks handoff — for a ticket with **known missing data**. There is no reconciliation check at handoff time. In production, always use Option B (fix root cause and retry) unless you are explicitly accepting data loss for a specific item.

```sql
-- Option A: TEST-ONLY — Resolve manually (accepts data loss, unblocks handoff)
-- Use ONLY when you understand the comment was never migrated and accept it is missing.
UPDATE failed_items SET status = 'resolved'
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_2_ID>' AND status = 'pending';

-- Option B: PRODUCTION PATH — Let retry service handle it
-- Requires the underlying issue to be fixed first (see retry in scenario 3)
```

After resolving via either option:

```powershell
npm run dev -- pilot-status --ticket-id <TEST_TICKET_2_ID>
# Derived sync state: complete
npm run dev -- pilot-handoff --ticket-id <TEST_TICKET_2_ID>
# Status: handed_off
```

---

## H. Scenario 3 — Exhausted Failure

**Goal:** Force a terminal/permanent failure, run retry until exhausted, verify `sync_state=failed`, verify handoff blocked, verify operator remediation path.

### H0. Environment configuration

For faster testing, set low retry limits in `.env`:

```
RETRY_MAX_ATTEMPTS=2
RETRY_BACKOFF_BASE_MS=500
```

### H1. Set up a ticket with a failing comment

Use a **different test ticket** (or reset scenario 2). Migrate it first:

```powershell
npm run dev -- migrate-ticket --ticket-id <TEST_TICKET_3_ID>
```

Record the job ID:

```sql
SELECT id FROM migration_jobs
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_3_ID>'
ORDER BY id DESC LIMIT 1;
```

### H2. Seed a failed item that will fail permanently on retry

We need a comment that will fail when the retry service tries to re-migrate it. The most reliable approach: use a **bogus comment source ID** that doesn't actually exist in the Zendesk ticket. When `migrateCommentById` runs, it fetches the ticket, can't find the comment, and throws a `MigrationError` — which `isTransientError()` classifies as **permanent**.

```sql
INSERT INTO failed_items (job_id, entity_type, source_id, error, retry_count, last_attempt_at, status, metadata)
VALUES (
  <JOB_ID>,
  'comment',
  'FAKE_COMMENT_99999',
  'Initial simulated failure',
  0,
  NOW(),
  'pending',
  '{"ticketSourceId": "<TEST_TICKET_3_ID>"}'
);
```

### H3. Run retry — first attempt

```powershell
npm run dev -- retry --job-id <JOB_ID>
```

Expected output:

```
── RETRY SUMMARY ──
Job:           #<JOB_ID>
Attempted:     1
Resolved:      0
Still failing: 0
Exhausted:     1
  comment: 0/1 resolved, 1 exhausted

1 item(s) exhausted max retries — check dead-letter items with "reconcile --job-id <JOB_ID>".
```

Because `MigrationError` is classified as permanent (`isTransientError → false`), the item is immediately exhausted — `retry_count` goes to 1 and `status` becomes `exhausted` in one pass regardless of `RETRY_MAX_ATTEMPTS`.

> **Note:** If you want to see gradual exhaustion over multiple retry runs (the transient-error path), use the **alternative approach** in section H3-ALT below instead.

### H3-ALT. Alternative — force transient failures for gradual exhaustion

Instead of a bogus comment ID, break the BoldDesk connection so retries fail with a network/transient error:

```sql
-- Use a real comment source ID that exists in the Zendesk ticket
-- Delete its mapping so it needs to be re-migrated
DELETE FROM entity_mappings WHERE entity_type = 'comment' AND source_id = '<REAL_COMMENT_ID>';

INSERT INTO failed_items (job_id, entity_type, source_id, error, retry_count, last_attempt_at, status, metadata)
VALUES (
  <JOB_ID>,
  'comment',
  '<REAL_COMMENT_ID>',
  'Initial transient failure',
  0,
  NOW(),
  'pending',
  '{"ticketSourceId": "<TEST_TICKET_3_ID>"}'
);
```

Then temporarily break BoldDesk connectivity. Edit `.env`:

```
BOLDDESK_BASE_URL=http://localhost:1
```

Now run retry twice (with `RETRY_MAX_ATTEMPTS=2`):

**Run 1:**

```powershell
npm run dev -- retry --job-id <JOB_ID>
```

Expected: `Still failing: 1`, `Exhausted: 0` (retry_count goes from 0 to 1, error is transient → still pending).

**Run 2:**

```powershell
npm run dev -- retry --job-id <JOB_ID>
```

Expected: `Exhausted: 1` (retry_count goes from 1 to 2, which equals `RETRY_MAX_ATTEMPTS` → exhausted).

> **Important:** After testing, restore `BOLDDESK_BASE_URL` to the real value in `.env`.

### H4. Verify sync state is failed

```powershell
npm run dev -- pilot-status --ticket-id <TEST_TICKET_3_ID>
```

Expected:

```
Derived sync state:  failed
Unresolved failures: 1
```

### H5. Verify handoff is blocked

```powershell
npm run dev -- pilot-handoff --ticket-id <TEST_TICKET_3_ID>
```

Expected:

```
── PILOT HANDOFF ──
Status:          blocked
Sync state:      failed
Blocked reasons:
  - Derived sync state is "failed" (requires "complete"). Unresolved failed items: 1
```

### H6. Verify failed_items in database

```sql
SELECT id, entity_type, source_id, error, retry_count, status
FROM failed_items
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_3_ID>';
```

Expected: `status = 'exhausted'`, `retry_count >= 1`.

### H7. Verify retry returns nothing retryable

```powershell
npm run dev -- retry --job-id <JOB_ID>
```

Expected: `No retryable items found` (exhausted items are filtered out by `getRetryableItems`).

### H8. Run reconciliation report

```powershell
npm run dev -- reconcile --job-id <JOB_ID>
```

The report should show the ticket with a discrepancy (missing comment mapping).

### H9. Operator remediation path

> **DESIGN NOTE:** The current system has no reconciliation check at handoff time. `deriveTicketSyncState` returns `complete` when all failed_items are `resolved` — it does not verify the data actually exists in BoldDesk. This means Option A below will unblock handoff for a ticket with missing data and no system-level guard. This is an intentional operator-override capability, not a "normal" path.

**Option A — TEST-ONLY: Accept data loss and unblock handoff:**

This option is appropriate **only** when:
- You are testing the handoff gate mechanics (this runbook), OR
- You have manually verified the missing data is non-critical and explicitly accept the loss

```sql
UPDATE failed_items
SET status = 'resolved'
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_3_ID>'
  AND status = 'exhausted';
```

Then:

```powershell
npm run dev -- pilot-status --ticket-id <TEST_TICKET_3_ID>
# Derived sync state: complete (no more unresolved items)
npm run dev -- pilot-handoff --ticket-id <TEST_TICKET_3_ID>
# Status: handed_off
```

> **Production risk:** This hands off a ticket with known missing comments/attachments. There is no system check to prevent this. If you use this path in production, document the data loss in the audit log manually and verify the BoldDesk ticket is acceptable before proceeding.

**Option B — PRODUCTION PATH: Fix the root cause and retry:**

This is the safe path. Fix the underlying issue first, then reset and retry.

```sql
-- Reset the failed item for another retry pass
UPDATE failed_items
SET status = 'pending', retry_count = 0
WHERE metadata->>'ticketSourceId' = '<TEST_TICKET_3_ID>'
  AND status = 'exhausted';
```

Fix the underlying issue (restore correct BoldDesk URL, fix source data, etc.), then:

```powershell
npm run dev -- retry --job-id <JOB_ID>
# Should now resolve
npm run dev -- pilot-status --ticket-id <TEST_TICKET_3_ID>
# Derived sync state: complete
```

### H10. Audit log verification

```sql
SELECT action, detail, created_at FROM audit_log
WHERE source_id = '<TEST_TICKET_3_ID>'
ORDER BY created_at;
```

Expected actions over the scenario: `migrated`, `sync_state_transition` (if retry changed the state), `retry_started`, `retry_completed`.

---

## I. Verification Checklist

### Database tables

| Table | What to verify |
|---|---|
| `migration_jobs` | Job exists with correct `status` (`completed` / `completed_with_errors` / `failed`) |
| `entity_mappings` | `ticket`, `comment`, `attachment` rows exist with valid `destination_id` values |
| `failed_items` | Correct `status` (`pending` / `exhausted` / `resolved`), `retry_count`, `metadata.ticketSourceId` |
| `audit_log` | Actions logged: `migrated`, `pilot_handoff`, `pilot_handoff_blocked`, `retry_started`, `retry_completed`, `sync_state_transition` |

### Zendesk UI

| Check | When |
|---|---|
| Custom fields `Owner System`, `Sync State`, `BoldDesk Ticket ID` populated | After successful handoff |
| Custom fields unchanged | After blocked handoff |
| Tag `handled_in_bolddesk` present | After successful handoff |
| Internal note "This ticket is now managed in BoldDesk" | After successful handoff |

### BoldDesk UI/API

| Check | When |
|---|---|
| Ticket exists with correct subject and description | After migration |
| Public comments in chronological order | After migration |
| Internal notes present as private | After migration |
| ~~Attachments accessible~~ | **SKIP** — attachment-linking bug means attachments are not linked to comments (see section K). Do not verify attachments until the bug is fixed. |

### CLI output

| Check | When |
|---|---|
| `pilot-status` shows `Derived sync state: complete` | After clean migration |
| `pilot-status` shows `Derived sync state: partial` | After seeding pending failed_item |
| `pilot-status` shows `Derived sync state: failed` | After item is exhausted |
| `pilot-handoff` shows `Status: handed_off` | Clean path |
| `pilot-handoff` shows `Status: blocked` with reasons | Partial or failed sync state |
| `retry` shows exhausted count | After permanent or max-retry failure |

---

## J. Common Failure Modes / Troubleshooting

### Setup problems (not app defects)

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required environment variable: X` | `.env` file missing or variable not set | Check `.env` exists in repo root and all required vars are present |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not running | Start PostgreSQL or Docker container |
| `password authentication failed` | Wrong DB credentials | Check `DATABASE_URL` matches your PG user/password |
| `relation "migration_jobs" does not exist` | Migrations not applied | Run `npm run db:migrate` |
| `Zendesk API error: 401` | Bad Zendesk credentials | Verify `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`; ensure token access is enabled |
| `BoldDesk API error: 401` or `403` | Bad BoldDesk API key | Verify `BOLDDESK_API_KEY`; check permissions in BoldDesk admin |
| `Pilot custom field IDs not configured` | `ZD_FIELD_*` env vars are `0` or missing | Create the custom fields in Zendesk and set their numeric IDs |
| `Zendesk API error: 422` on pilot-handoff | Custom field dropdown values don't match what the code writes | Ensure the Owner System dropdown has `zendesk` and `bolddesk`; ensure the Sync State dropdown has `migrated`, `pilot_active`, and `sync_error` |
| `timeout of 30000ms exceeded` (Zendesk) | Network issue or Zendesk rate limiting | Check network; try again; consider increasing timeout in `zendesk.client.ts` |
| `timeout of 60000ms exceeded` (BoldDesk) | Network issue or large attachment | Check network; verify BoldDesk is reachable |
| Jest tests fail with module resolution errors | Dependencies not installed or stale | Run `npm install` again |

### App behavior that looks wrong but isn't

| Symptom | Explanation |
|---|---|
| `migrate-ticket` creates a new `migration_jobs` row each run | By design — single-ticket migrations create their own job for failed_item tracking |
| Handoff says "already_active" | Ticket was already handed off; this is idempotent success |
| Retry shows 0 retryable items | All items are either `resolved` or `exhausted`; pending items with `retry_count >= max` are also filtered |
| Reconciliation is slow | It re-fetches every mapped ticket from Zendesk API; expected for large datasets |
| `pilot-status` shows `Owner system: unknown` | The custom field has no value set yet (never handed off); this is normal |
| Comment count in reconciliation doesn't match | The first comment (ticket description) may or may not appear in Zendesk's comment list depending on API version |

### Distinguishing derived sync states (the handoff gate)

These are the **derived sync states** computed by `deriveTicketSyncState()` from database contents. This is the model that controls the handoff gate. These are NOT the Zendesk custom field values.

| Derived sync state | Meaning | What's in `failed_items` | Handoff? | Retry? |
|---|---|---|---|---|
| `pending` | Ticket not yet migrated (no `entity_mappings` row for ticket) | N/A | Blocked | Migrate first |
| `partial` | Ticket exists in BoldDesk, but retryable (`pending`) failed items remain | `status = 'pending'` rows | Blocked | Yes — run retry |
| `complete` | Ticket mapping exists and no unresolved failures | 0 unresolved rows (or all `resolved`) | Allowed | N/A |
| `failed` | At least one item has `status = 'exhausted'` | `status = 'exhausted'` rows | Blocked | No — operator must resolve or reset |

### Zendesk custom field values (display/coordination only)

These are written TO Zendesk AFTER the handoff gate passes or fails. The gate does NOT read them.

| Zendesk field value | Written when | By which code path |
|---|---|---|
| Owner System = `bolddesk` | Handoff succeeds | `pilot-handoff` |
| Owner System = `zendesk` | Rollback, or handoff write-back fails | `pilot-rollback`, error revert in `pilot-handoff` |
| Sync State = `pilot_active` | Handoff succeeds | `pilot-handoff` |
| Sync State = `migrated` | Rollback succeeds | `pilot-rollback` |
| Sync State = `sync_error` | Handoff write-back fails | Error revert in `pilot-handoff` |
| Sync State = (empty/null) | Default before any handoff | N/A — never written by app |

---

## K. Missing Gaps in Repo or Docs

### Blocking for pilot e2e testing

| Gap | Impact | Workaround |
|---|---|---|
| **Attachment-linking bug:** `addReply`/`addNote` in `bolddesk.connector.ts` do not pass uploaded attachment tokens in the `attachments` field of the BoldDesk API request | Attachments are uploaded to BoldDesk storage as orphans but never linked to comments. Migration reports success. Reconciliation reports them as "mapped". **Silent data loss.** | Scenario 1 must use a ticket with NO attachments. Do not test attachments until `addReply`/`addNote` are fixed to pass the tokens from `migrateAttachment`. |
| **No reconciliation at handoff time:** Handoff gate only checks `deriveTicketSyncState` (mapping + failed_items). It does not verify data actually exists in BoldDesk. | Manually resolving exhausted failed_items allows handoff of tickets with missing data. | Treat manual resolution as test-only. In production, always fix root cause and retry (Option B in H9). |
| No CLI command to inspect or manage `failed_items` directly | Must use raw SQL to seed, inspect, or resolve failed items for scenarios 2 and 3 | Use `psql` or a DB client |
| No "dry run" or "simulate failure" mode | Cannot force a comment failure from the CLI without DB manipulation or breaking config | Seed failed_items via SQL as documented above |

### Non-blocking but notable

| Gap | Impact | Recommendation |
|---|---|---|
| Migration runner has no tracking table | Re-applies all SQL files every run; the `DELETE` in `002` runs on every `db:migrate` | Add a `schema_migrations` tracking table |
| No `docker-compose.yml` | Developers must set up PostgreSQL manually | Add a compose file for one-command local setup |
| No health-check or connectivity-test CLI command | Must use manual curl/PowerShell to verify API keys work | Add a `migrate check-config` command |
| BoldDesk status IDs marked TODO in `bolddesk.types.ts` | IDs may not match target instance | Verify against your instance; update if needed |
| `docs/readme.md` lists migration/reconciliation as "skeleton" | Stale documentation; these are fully implemented | Update the doc |
| No structured log output to file | Logs go to stdout (pino); for audit trail need to redirect | Pipe output: `npm run dev -- run 2>&1 > migration.log` |
| Reconciliation re-fetches all tickets from Zendesk | Slow and rate-limit-sensitive for large datasets | Acceptable for pilot-scale testing |

---

## Reset between test runs

To reset the database and start fresh between scenarios:

```sql
-- Nuclear reset (deletes ALL migration data)
TRUNCATE failed_items, audit_log, entity_mappings, migration_jobs RESTART IDENTITY CASCADE;
```

To reset a single ticket's migration data:

```sql
-- Delete mappings for a specific ticket and its comments
DELETE FROM entity_mappings WHERE source_id = '<TICKET_ID>' AND entity_type = 'ticket';
DELETE FROM entity_mappings WHERE entity_type = 'comment' AND source_id IN (
  -- list the comment source_ids for this ticket
);
DELETE FROM failed_items WHERE metadata->>'ticketSourceId' = '<TICKET_ID>';
DELETE FROM failed_items WHERE entity_type = 'ticket' AND source_id = '<TICKET_ID>';
-- Note: the BoldDesk ticket will still exist; re-migration will create a duplicate
```

> **Warning:** Re-migrating a ticket without deleting the BoldDesk-side ticket will create a duplicate in BoldDesk. BoldDesk does not have a delete-ticket API in all plans. Plan accordingly for test resets.
