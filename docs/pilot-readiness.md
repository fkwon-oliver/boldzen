# Pilot Readiness — Final Assessment

## Safety Invariant Confirmation

Four invariants were traced through every code path. All hold.

### 1. No handoff unless derived sync state = complete

| Code path | Gate check | Verified |
|---|---|---|
| `handoff()` normal flow | `syncState !== "complete"` → blocked, no Zendesk mutation | Yes |
| `handoff()` already_active | Re-derives state; if degraded → warns + audit; no new write | Yes |
| `handoff()` gate blocked | Returns `blocked`; `updateTicket` never called | Yes |
| `handoff()` gate passed | Only reachable when `blockedReasons` is empty, which requires `syncState === "complete"` | Yes |

### 2. No incomplete ticket can appear safe for handoff

| Component | Mechanism | Verified |
|---|---|---|
| `deriveTicketSyncState` | Returns `complete` only when mapping exists AND zero unresolved items | Yes |
| `migrateTicketById` | Creates bookkeeping job; comment failures persisted via `recordFailure` | Yes |
| `migrateTicketFull` | Comment failures recorded to `failed_items` when job is present (always true now) | Yes |
| `getFailedItemsForTicket` | Finds ticket + comment failures across all jobs via `metadata->>'ticketSourceId'` | Yes |

### 3. Ownership fails safe to Zendesk on handoff/write-back failure

| Failure mode | Behavior | Verified |
|---|---|---|
| Zendesk PUT throws | Fallback resets `owner_system=zendesk` + `sync_state=sync_error` | Yes |
| Zendesk PUT succeeds but response lost | Fallback explicitly resets `owner_system=zendesk` | Yes |
| Fallback itself fails | Original PUT never succeeded → Zendesk retains pre-handoff values | Yes |
| Gate blocked | No `updateTicket` call at all | Yes |

### 4. Exhausted critical failures always block handoff

| Component | Mechanism | Verified |
|---|---|---|
| `deriveTicketSyncState` | `exhausted` check runs before `pending` check; any exhausted → `failed` | Yes |
| `RetryService` | Exhaustion persisted to DB via `updateFailedItem` with `status: "exhausted"` | Yes |
| `handoff()` | `syncState === "failed"` → blocked | Yes |

---

## State Transition Tables

### Ownership State (`migration_owner_system` in Zendesk)

```
zendesk ──[pilot-handoff succeeds]──→ bolddesk
zendesk ──[pilot-handoff blocked]──→ zendesk (no change)
zendesk ──[pilot-handoff write fails]──→ zendesk (reverted via fallback)
bolddesk ──[pilot-rollback succeeds]──→ zendesk
bolddesk ──[pilot-rollback fails]──→ bolddesk (no change, logged)
```

No other transitions exist. Ownership changes require explicit CLI commands.
RetryService has no access to `updateTicket` and cannot change ownership.

### Derived Sync State (computed from `entity_mappings` + `failed_items`)

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
  (no mapping) ─→ pending                                         │
                    │                                              │
        [ticket created in BoldDesk]                               │
                    │                                              │
                    ├── comments all succeed ──→ complete           │
                    │                             │                │
                    ├── comment fails ──→ partial  │                │
                    │                     │        │                │
                    │     [retry succeeds] │   [new failure]        │
                    │         └────────→──┘        │                │
                    │     [retry exhausts]          │                │
                    │         └────────→ failed     │                │
                    │                     │        │                │
                    │     [admin resets item to pending]            │
                    │         └────────→ partial ──┘                │
                    │                                              │
                    └──────────────────────────────────────────────┘
```

| From | To | Trigger |
|---|---|---|
| pending | complete | Ticket + all comments/attachments migrated, zero failures |
| pending | partial | Ticket created but comment/attachment fails |
| partial | complete | Retry resolves last pending item |
| partial | failed | Retry exhausts a pending item |
| partial | partial | Retry resolves some but not all items |
| failed | partial | Admin resets exhausted item to `pending` in DB |
| complete | partial | New migration job records failure for this ticket (rare edge case) |

Only `complete` permits handoff. All others block.

### Retry Outcome → Sync State Effect

| Retry outcome | failed_items change | Derived sync state effect |
|---|---|---|
| Item resolves | `status` → `resolved` | Removes one blocker; may transition partial→complete |
| Item fails, retryable | `retryCount++`, stays `pending` | No state change |
| Item fails, exhausted | `status` → `exhausted` | Transitions partial→failed |
| Item fails, permanent (non-transient) | `status` → `exhausted` immediately | Transitions partial→failed |

---

## Pilot Readiness Checklist

### Zendesk Admin Setup

- [ ] Custom field `migration_owner_system` created, ID recorded in `ZD_FIELD_OWNER_SYSTEM`
- [ ] Custom field `migration_sync_state` created, ID recorded in `ZD_FIELD_SYNC_STATE`
- [ ] Custom field `bolddesk_ticket_id` created, ID recorded in `ZD_FIELD_BOLDDESK_TICKET_ID`
- [ ] Group "BoldDesk Migration Holding" created (no agents assigned)
- [ ] Trigger: "Auto-tag BoldDesk-owned tickets" active
- [ ] Trigger: "Customer reply on BoldDesk ticket" active
- [ ] Trigger: "Block agent work on BoldDesk tickets" active
- [ ] View: "BoldDesk Managed" visible to agents
- [ ] View: "Pending BoldDesk Sync" visible to migration admins

### Infrastructure

- [ ] PostgreSQL database accessible with schema migrations applied (`001_initial_schema.sql`, `002_retry_support.sql`)
- [ ] `.env` configured with all required variables (Zendesk, BoldDesk, database, pilot field IDs)
- [ ] `npx tsc --noEmit` passes (zero errors)
- [ ] `npx jest` passes (164 tests, 14 suites, zero failures)

### Historical Migration

- [ ] `migrate run` executed against pilot ticket set
- [ ] `migrate reconcile --job-id <id>` reviewed — ticket/comment/attachment counts match
- [ ] Failed items triaged: retries run until each ticket reaches `complete` or `failed`

### Handoff Validation (Test Ticket)

- [ ] `migrate pilot-status --ticket-id <test>` shows `derivedSyncState: complete`
- [ ] `migrate pilot-handoff --ticket-id <test>` returns `handed_off`
- [ ] Zendesk ticket shows: `owner=bolddesk`, `sync=pilot_active`, tag `handled_in_bolddesk`
- [ ] Internal note visible on Zendesk ticket
- [ ] Ticket appears in "BoldDesk Managed" view
- [ ] BoldDesk ticket accessible and data matches

### Rollback Validation (Test Ticket)

- [ ] `migrate pilot-rollback --ticket-id <test>` returns `rolled_back`
- [ ] Zendesk ticket shows: `owner=zendesk`, `sync=migrated`, tag removed
- [ ] Ticket leaves "BoldDesk Managed" view

### Gate Validation

- [ ] Attempt handoff on ticket with `partial` state → confirm `blocked`
- [ ] Attempt handoff on ticket with `failed` state → confirm `blocked`
- [ ] Attempt handoff on closed ticket → confirm `blocked`
- [ ] Check `audit_log` contains `pilot_handoff_blocked` entries for each

### Agent Readiness

- [ ] Zendesk agents briefed: do not work `handled_in_bolddesk` tickets
- [ ] BoldDesk pilot agents briefed: work only handed-off tickets
- [ ] Escalation path documented: who to contact for ownership conflicts
- [ ] Migration admin on-call identified for first 48h

---

## Operator Runbook

### Scenario: Handoff Blocked

**Symptom**: `migrate pilot-handoff --ticket-id <id>` returns `status: blocked`.

**Step 1** — Read the blocked reasons in the CLI output.

**Step 2** — Run `migrate pilot-status --ticket-id <id>` to see derived state and failure count.

**Step 3** — Diagnose by derived state:

| Derived state | Meaning | Action |
|---|---|---|
| `pending` | Ticket not yet migrated to BoldDesk | Run `migrate migrate-ticket --ticket-id <id>`, then retry |
| `partial` | Retryable failures remain | Run `migrate retry --job-id <id>` for the relevant job; re-check status |
| `failed` | Exhausted items exist | See "Exhausted Retry" below |

**Step 4** — If blocked because ticket is closed: this ticket cannot be handed off. If needed, reopen in Zendesk first.

**Step 5** — If blocked because `owner=bolddesk` but `sync!=pilot_active`: a previous handoff attempt left the ticket in an inconsistent state. Manually set `migration_owner_system=zendesk` in Zendesk Admin, then retry handoff.

---

### Scenario: `sync_error` State

**Symptom**: Zendesk ticket shows `migration_sync_state=sync_error`.

**Cause**: A handoff write-back failed. The tool reverted ownership to `zendesk` and set `sync_error` to flag the issue.

**Step 1** — Check `audit_log` for `pilot_handoff_failed` entries for this ticket.

**Step 2** — Verify Zendesk fields:
- `migration_owner_system` should be `zendesk` (reverted by fallback)
- If it shows `bolddesk`, manually reset to `zendesk` in Zendesk Admin

**Step 3** — Investigate the root cause (API error, auth issue, field ID mismatch).

**Step 4** — Fix the root cause, then re-run `migrate pilot-handoff --ticket-id <id>`.

**Step 5** — After successful handoff, the `sync_error` state is replaced by `pilot_active`.

---

### Scenario: Exhausted Retry

**Symptom**: `migrate retry --job-id <id>` reports exhausted items. `pilot-status` shows `derivedSyncState: failed`.

**Step 1** — Identify the exhausted items:

```sql
SELECT * FROM failed_items
WHERE status = 'exhausted'
  AND (
    (entity_type = 'ticket' AND source_id = '<ticket_id>')
    OR (metadata->>'ticketSourceId' = '<ticket_id>')
  );
```

**Step 2** — Read the `error` column to understand the failure.

**Step 3** — Fix the root cause:
- Missing user mapping → migrate the user first
- BoldDesk API 400 → check the payload (field mapping, required fields)
- Persistent API error → check BoldDesk connectivity/auth

**Step 4** — Reset the item for retry:

```sql
UPDATE failed_items
SET status = 'pending', retry_count = 0
WHERE id = <item_id>;
```

**Step 5** — Re-run `migrate retry --job-id <job_id>`.

**Step 6** — Verify with `migrate pilot-status --ticket-id <id>` — expect `complete`.

**Step 7** — Proceed with `migrate pilot-handoff --ticket-id <id>`.

---

### Scenario: Rollback

**When to rollback**: pilot agent reports data issues, customer escalation, or operational decision to return ticket to Zendesk.

**Step 1** — Run `migrate pilot-rollback --ticket-id <id>`.

**Step 2** — Verify result is `rolled_back`.

**Step 3** — Confirm in Zendesk:
- `migration_owner_system` = `zendesk`
- `migration_sync_state` = `migrated`
- Tag `handled_in_bolddesk` removed
- Internal note confirms rollback

**Step 4** — Notify the BoldDesk pilot agent to stop working the ticket.

**Step 5** — If rollback fails (`status: failed`), check the error. The ticket remains owned by BoldDesk in Zendesk. Manually update fields in Zendesk Admin if the API is persistently down.

**Caution**: Data created in BoldDesk after handoff is NOT synced back to Zendesk. The Zendesk agent resumes from the last known state before handoff. Any BoldDesk-side replies must be manually copied or accepted as orphaned.

---

## Deferred Risks (Non-Blocking for Pilot)

| Risk | Impact | Mitigation for now | When to address |
|---|---|---|---|
| No concurrency guard on `pilot-handoff` | Two simultaneous handoff calls could race; second would see `already_active` | Single operator runs CLI; inherently serialized | If scaling to automated batch handoff |
| Rollback sets Zendesk `sync_state=migrated` even if derived state is `failed` | Cosmetically misleading in Zendesk views (handoff gate uses derived state, not this field) | Operators use `pilot-status` for truth, not raw Zendesk fields | Post-pilot cleanup pass |
| `getFailedItemsForTicket` depends on `metadata.ticketSourceId` | Future entity types recorded without this key would be invisible to the gate | Current code always includes it for comments; attachments bubble up as comment failures | If adding standalone attachment failure tracking |
| Uploaded attachment tokens not linked to BoldDesk ticket/comment payloads | Attachments uploaded but may not be attached to the correct comment in BoldDesk | Verify during test-ticket migration; fix in BoldDesk connector if needed | Before scaling past pilot |
| `BOLDDESK_STATUS_IDS` / `BOLDDESK_PRIORITY_IDS` are placeholder values | Ticket status/priority may not map correctly to the BoldDesk instance | Confirm values in BoldDesk Admin and update `bolddesk.types.ts` | Before first real handoff |
| No automated customer-reply forwarding from Zendesk to BoldDesk | Customer replies on handed-off tickets require manual admin forwarding | Zendesk trigger alerts admins; manual process documented | After pilot validates the ownership model works |
| No `migrate reset-failed` CLI command | Admin must write SQL to reset exhausted items | SQL in runbook above | Quality-of-life improvement post-pilot |
