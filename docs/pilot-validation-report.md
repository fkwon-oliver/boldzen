# Pilot Validation Report

**Project:** Zendesk to BoldDesk Migration Tool
**Date:** April 9, 2026
**Validated by:** Automated pilot execution against live Zendesk sandbox and BoldDesk instance

---

## 1. Overview

### Purpose

This report documents the results of a structured pilot validation of the Zendesk to BoldDesk migration tool. The goal was to verify that the migration, retry, and pilot ownership control systems behave correctly under success, partial failure, and terminal failure conditions.

### Scope

- **Source:** Zendesk (sandbox instance)
- **Destination:** BoldDesk (live instance)
- **Entities migrated:** Tickets, public replies, internal notes, attachments, contacts
- **Control systems tested:** `pilot-status`, `pilot-handoff`, `retry`, sync state derivation, audit logging

### What Was Validated

Three end-to-end scenarios were executed against real APIs:

| Scenario | Goal | Ticket |
|----------|------|--------|
| Scenario 1 — Clean Migration | Verify a complete ticket migrates with 0 failures | 50041, 50042, 50043 |
| Scenario 2 — Partial Failure | Verify a pending failure blocks handoff and is visible to status checks | 50042 |
| Scenario 3 — Exhausted Failure | Verify a terminal failure blocks handoff after retry exhaustion | 50043 |

---

## 2. Scenarios Executed

### Scenario 1 — Clean Migration

**Tickets:** 50041, 50042, 50043

Each ticket was migrated using `migrate-ticket --ticket-id <ID>`. All three completed with `Status: completed` and `Failed: 0`. The migration created the ticket in BoldDesk, migrated all comments (public replies and internal notes), uploaded attachments, and linked attachment tokens to the correct comments.

Post-migration, `pilot-status` reported `Derived sync state: complete` and `Unresolved failures: 0` for each ticket.

> **Note:** Successful handoff execution (`pilot-handoff` returning `handed_off`) was not tested during this validation cycle. Only the gating and blocking behaviors were validated. Handoff success testing is deferred to a dedicated Scenario 1 execution with explicit approval.

### Scenario 2 — Partial Failure

**Ticket:** 50042

After clean migration, a comment failure was simulated by deleting one comment mapping from the database and inserting a `failed_items` row with `status: pending` and `metadata.ticketSourceId: "50042"`.

Results:
- `pilot-status` correctly reported `Derived sync state: partial` with 1 unresolved failure.
- `pilot-handoff` correctly blocked with reason: *"Derived sync state is 'partial' (requires 'complete'). Unresolved failed items: 1"*.
- After cleanup (removing the simulated failure and restoring the mapping), `pilot-status` returned to `complete`.

A second verification was performed using real code paths: an attachment failure was injected into the migration code for ticket 50042. The system automatically recorded the failure in `failed_items` with correct `ticketSourceId` metadata — no manual database patching required. `pilot-status` and `pilot-handoff` both responded correctly.

### Scenario 3 — Exhausted Failure

**Ticket:** 50043

After clean migration, a bogus comment source ID (`FAKE_COMMENT_99999`) was seeded into `failed_items` with `status: pending`. This ID does not exist in the Zendesk ticket.

The `retry` command was executed. The retry service fetched the ticket from Zendesk, could not find the fake comment, and threw a `MigrationError`. Because `MigrationError` is classified as a permanent error (`isTransientError() → false`), the item was immediately exhausted in a single retry pass.

Results:
- Retry output: `Attempted: 1, Resolved: 0, Exhausted: 1`.
- `pilot-status` reported `Derived sync state: failed` with 1 unresolved failure.
- `pilot-handoff` blocked with reason: *"Derived sync state is 'failed' (requires 'complete'). Unresolved failed items: 1"*.
- A second `retry` run returned `Attempted: 0` — exhausted items are correctly filtered out.
- The `failed_items` row showed `status: exhausted`, `retry_count: 1`, and error message: *"Comment FAKE_COMMENT_99999 not found in ticket 50043"*.

---

## 3. Validated Behaviors

| # | Behavior | Ticket | Result |
|---|----------|--------|--------|
| 1 | Clean ticket migration (ticket + comments + attachments) | 50041, 50042, 50043 | Pass |
| 2 | Attachment upload to BoldDesk | 50042, 50043 | Pass |
| 3 | Attachment tokens linked to replies and notes | 50042, 50043 | Pass |
| 4 | Attachment failure degrades gracefully (comment text still posts) | 50042 (simulated) | Pass |
| 5 | Attachment failure recorded in `failed_items` with ticket context | 50042 (simulated) | Pass |
| 6 | `pilot-status` detects `partial` state from pending failures | 50042 | Pass |
| 7 | `pilot-status` detects `failed` state from exhausted items | 50043 | Pass |
| 8 | `pilot-handoff` blocks on `partial` sync state | 50042 | Pass |
| 9 | `pilot-handoff` blocks on `failed` sync state | 50043 | Pass |
| 10 | Retry classifies `MigrationError` as permanent and exhausts immediately | 50043 | Pass |
| 11 | Retry returns nothing when all items are exhausted | 50043 | Pass |
| 12 | Sync state transition logged in audit trail (`partial → failed`) | 50043 | Pass |
| 13 | `pilot_handoff_blocked` logged in audit trail with reasons | 50042, 50043 | Pass |

---

## 4. System Behavior Summary

### On Success

When a ticket migrates cleanly:
1. The ticket, all comments (skipping the first comment, which becomes the BoldDesk ticket description), and all attachments are created in BoldDesk.
2. Entity mappings are saved for every migrated entity (ticket, comments, attachments).
3. `deriveTicketSyncState()` returns `complete` (mapping exists, no unresolved `failed_items`).
4. `pilot-handoff` gate passes — the ticket is eligible for ownership transfer.

### On Partial Failure

When a comment or attachment fails but the ticket itself was created:
1. The failing entity is recorded in `failed_items` with `status: pending` and `metadata.ticketSourceId` linking it to the parent ticket.
2. Successfully migrated entities are unaffected.
3. `deriveTicketSyncState()` returns `partial`.
4. `pilot-handoff` gate blocks with an explicit reason and count of unresolved items.
5. The `retry` command can re-attempt pending items.

### On Exhausted Failure

When retry exhausts all attempts for a failed item:
1. The `failed_items` row is updated to `status: exhausted`.
2. `deriveTicketSyncState()` returns `failed` (terminal state).
3. `pilot-handoff` gate blocks.
4. Further `retry` runs skip the exhausted item.
5. Operator remediation is required: either resolve the root cause and reset the item for retry, or explicitly mark it as `resolved` (accepting data loss).

### Gating Model

The handoff gate (`pilot-handoff`) makes its allow/block decision based solely on the **derived sync state**, which is computed at runtime from the `entity_mappings` and `failed_items` database tables. It does not read Zendesk custom fields to make this decision. Zendesk custom fields are written as outputs after the gate passes, not used as inputs.

| Derived Sync State | Condition | Handoff | Retry |
|---------------------|-----------|---------|-------|
| `pending` | No ticket mapping exists | Blocked | Migrate first |
| `partial` | Ticket mapped, pending `failed_items` remain | Blocked | Yes |
| `complete` | Ticket mapped, no unresolved failures | Allowed | N/A |
| `failed` | At least one `exhausted` `failed_items` row | Blocked | No — operator must resolve or reset |

---

## 5. Code Changes Implemented

All changes were made during this pilot stabilization cycle and are currently uncommitted.

### Fix 1: Attachment Upload Endpoint

| | |
|---|---|
| **File** | `src/connectors/bolddesk/bolddesk.connector.ts` |
| **Change** | Upload path changed from `/api/v1/tickets/attachment` to `/api/v1/attachments` |
| **Reason** | BoldDesk returned `405 Method Not Allowed` on the original endpoint |
| **Impact** | Attachments now upload successfully |

### Fix 2: Attachment Token Linking

| | |
|---|---|
| **Files** | `bolddesk.connector.ts`, `bolddesk.types.ts`, `destination.interface.ts` |
| **Change** | `addComment`, `addReply`, and `addNote` now accept and pass attachment tokens; `attachments` field type corrected from `string[]` to comma-separated `string`; added required `updateDetailsFromPortal: false` field |
| **Reason** | Uploaded attachments were orphaned in BoldDesk storage — never linked to comments |
| **Impact** | Attachments are now visibly linked to the correct reply or note in BoldDesk |

### Fix 3: Attachment Failure Recording with Ticket Context

| | |
|---|---|
| **File** | `src/migration/migration.service.ts` |
| **Change** | `migrateComment` now accepts `ticketSourceId` and `job`; attachment failures are recorded in `failed_items` with `{ ticketSourceId, commentSourceId }` metadata; failures no longer block comment text creation |
| **Reason** | Attachment failures were silently logged but invisible to `pilot-status`, `deriveTicketSyncState`, and the handoff gate |
| **Impact** | Real attachment failures are now detected by the pilot control system without manual database intervention |

---

## 6. Known Gaps and Limitations

### Pilot-Safe Gaps

These gaps are acceptable for controlled pilot testing with small ticket volumes.

| Gap | Severity | Impact |
|-----|----------|--------|
| Comment `destination_id` is always `undefined` | Low | BoldDesk reply/note endpoints don't return a usable ID. Reconciliation cannot verify individual comments by destination ID. Does not affect migration correctness. |
| Reconciliation counts the first comment (description) as unmapped | Low | Migration skips the first comment (`slice(1)`) since BoldDesk uses it as the ticket description. Reconciliation reports a 1-comment shortfall for every ticket. Cosmetic inaccuracy in reports only. |
| Reconciliation scope is global | Low | `reconcile --job-id` checks all mapped tickets, not just the job's ticket. Reports are noisy for single-ticket testing but functionally correct. |
| `ZD_FIELD_SYNC_STATE` has a leading zero in `.env` | Cosmetic | `parseInt` handles it correctly. No functional impact. Should be cleaned up for clarity. |
| Runbook section K references attachment-linking bug as blocking | Stale documentation | The bug is now fixed. The runbook should be updated to reflect current status. |

### Production Gaps

These gaps require resolution before production-scale migration.

| Gap | Severity | Impact |
|-----|----------|--------|
| Attachment retry not supported | Medium | `RetryService` has no `"attachment"` entity type in its dispatch table. Attachment `failed_items` block handoff but cannot be retried via the `retry` command. Operators must resolve manually or the retry handler must be extended. |
| No handoff-time data verification | Medium | The handoff gate checks only the derived sync state (mapping + `failed_items`). It does not verify that data actually exists in BoldDesk. Manually resolving exhausted `failed_items` allows handoff of tickets with missing data. This is an intentional operator-override capability but has no guardrail. |
| Successful handoff not yet validated end-to-end | Medium | `pilot-handoff` returning `handed_off` (with Zendesk custom field writes, tag application, and internal note) has not been tested in this validation cycle. The blocking path is proven; the success path is untested. |
| `pilot-rollback` not yet validated | Medium | Rollback (returning a ticket from BoldDesk ownership to Zendesk) has not been tested. |

---

## 7. Audit and Observability

### What Is Logged

The system produces structured JSON logs (pino) to stdout for all significant events:

| Event | Log Level | Key Fields |
|-------|-----------|------------|
| Ticket created | `info` | `ticketSourceId`, `ticketDestId` |
| Comment migration failed | `warn` | `commentSourceId`, `ticketSourceId`, error |
| Attachment uploaded | `info` | `attachmentSourceId`, token |
| Attachment upload failed | `warn` | `attachmentSourceId`, `ticketSourceId`, error |
| Retry exhausted | `warn` | `entityType`, `sourceId`, `retryCount` |
| Sync state transition | `info` | `ticketId`, `before`, `after` |
| Handoff blocked | `warn` | `ticketId`, `syncState`, `blockedReasons` |

### What Is Tracked in the Database

| Table | What It Records |
|-------|-----------------|
| `entity_mappings` | Source-to-destination ID mappings for tickets, comments, attachments, users, organizations |
| `failed_items` | Failed entity migrations with error, retry count, status (`pending`/`exhausted`/`resolved`), and `metadata.ticketSourceId` for ticket-scoped lookup |
| `migration_jobs` | Job-level tracking: status, processed/failed counts, timestamps |
| `audit_log` | Action-level audit trail: `migrated`, `pilot_handoff`, `pilot_handoff_blocked`, `pilot_rollback`, `sync_state_transition`, `retry_started`, `retry_completed` |

### Known Observability Limitations

- `retry_started` and `retry_completed` audit entries are keyed by `jobId` only, not by `source_id`. Querying the audit log for a specific ticket requires filtering by both `source_id` and `jobId`.
- Attachment failures during comment retry (via `migrateCommentById`) are logged but not recorded in `failed_items` because the retry path does not pass a `job` reference. The retry service marks the overall comment as still-failing, which is functionally correct but less granular.

---

## 8. Conclusions

### What Is Now Proven

- The migration pipeline creates tickets, comments, and attachments in BoldDesk with correct data.
- Attachment tokens are linked to the correct reply or note.
- The derived sync state model (`pending → partial → complete → failed`) works correctly and gates handoff reliably.
- The retry system correctly classifies permanent vs. transient errors and exhausts items as designed.
- The audit trail captures migration events, sync state transitions, and blocked handoffs.
- Failure metadata (`ticketSourceId`) is automatically populated, enabling the pilot control system to detect failures without manual database intervention.

### What Is Safe to Proceed With

- Single-ticket migration for pilot testing with manual operator oversight.
- Controlled testing of the `pilot-handoff` success path (Scenario 1 completion).
- Controlled testing of `pilot-rollback`.

### What Is Not Yet Production-Ready

- Attachment retry (no automated retry path for failed attachments).
- Handoff without operator verification of BoldDesk content.
- Bulk/historical migration at scale (not tested beyond single tickets).
- Reconciliation accuracy (first-comment offset, global scope).

---

## 9. Next Steps

### Immediate (Before Resuming Pilot)

1. **Commit current fixes** — 4 files with attachment handling and metadata fixes.
2. **Complete Scenario 1** — Execute successful handoff end-to-end and verify Zendesk custom field writes.
3. **Test pilot-rollback** — Verify ownership can be returned to Zendesk.
4. **Update runbook** — Remove stale attachment-linking bug references (section K).

### Short-Term Hardening

5. **Add attachment retry support** — Extend `RetryService` with an `"attachment"` entity type handler.
6. **Fix reconciliation comment offset** — Adjust expected comment count to account for the first-comment skip.
7. **Clean up `.env`** — Remove leading zero from `ZD_FIELD_SYNC_STATE`.

### Production Readiness

8. **Full field mapping audit** — Extract and validate all Zendesk field types, custom fields, and dropdown values against BoldDesk constraints.
9. **Bulk migration testing** — Run historical migration against a representative sample (50–100 tickets).
10. **Handoff-time data verification** — Optionally add a BoldDesk content check before allowing handoff.
11. **Operational tooling** — Add CLI commands for `failed_items` inspection and management (currently requires raw SQL).
