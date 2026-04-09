# Pilot Operating Model — Zendesk / BoldDesk Coexistence

## Governing Principle

During pilot, **one system owns each ticket**. Ownership is machine-enforced.
Human memory is not a control. Every rule below must be backed by a field, tag,
trigger, or code path.

---

## 1. Zendesk Custom Fields (Admin Setup Required)

### `migration_owner_system` (dropdown)

| Value | Meaning |
|---|---|
| `zendesk` | Ticket is actively worked in Zendesk (default) |
| `bolddesk` | Ticket is owned by BoldDesk — Zendesk agents must not work it |

- **Field type**: dropdown (single-select)
- **Visibility**: agents (read-only in Zendesk once set to `bolddesk`; editable only by admin or API)
- **Default**: `zendesk`

### `migration_sync_state` (dropdown)

| Value | Meaning |
|---|---|
| `not_synced` | No migration activity |
| `migrated` | Historical migration complete — data is in BoldDesk |
| `pilot_active` | Ticket actively owned by BoldDesk during pilot |
| `sync_error` | Handoff or sync failed — needs manual triage |
| `cutover_complete` | Full cutover done — Zendesk record is archived |

- **Field type**: dropdown (single-select)
- **Visibility**: agents (read-only; editable only by admin or API)
- **Default**: `not_synced`

### `bolddesk_ticket_id` (text)

- Stores the BoldDesk ticket ID for cross-reference
- Set by migration tool during handoff
- Visible to agents for lookup

---

## 2. Zendesk Tag

### `handled_in_bolddesk`

Applied automatically by trigger when `migration_owner_system` = `bolddesk`.
Used for view filtering and automation conditions.

---

## 3. Source-of-Truth Rules

```
IF migration_owner_system = "zendesk"  → Zendesk is source of truth
IF migration_owner_system = "bolddesk" → BoldDesk is source of truth
IF migration_owner_system is blank     → Zendesk (pre-migration default)
```

There is no shared-ownership state. A ticket is owned by exactly one system.

### Transition Matrix

| From | To | Trigger | Who |
|---|---|---|---|
| zendesk | bolddesk | `migrate pilot-handoff --ticket-id <id>` | Migration tool / admin |
| bolddesk | zendesk | Manual admin escalation only | Admin with audit log entry |
| bolddesk | cutover_complete | Cutover script | Migration tool |

Ownership changes are **logged to `audit_log`** with before/after values.

---

## 4. Required Zendesk Triggers (Admin Setup)

### Trigger 1: Auto-tag on Ownership Change

```
Name:       "Migration: Tag BoldDesk-owned tickets"
Conditions: migration_owner_system = "bolddesk"
Actions:
  - Add tag: handled_in_bolddesk
  - Set Group: (BoldDesk Migration Holding group — no agents assigned)
```

### Trigger 2: Customer Reply on BoldDesk-Owned Ticket

```
Name:       "Migration: Customer reply on BoldDesk ticket"
Conditions:
  - Ticket updated via customer
  - Tag: handled_in_bolddesk
Actions:
  - Add tag: pending_bolddesk_sync
  - Add internal note: "Customer replied in Zendesk. This ticket is managed
    in BoldDesk (#{bolddesk_ticket_id}). Reply must be synced or manually
    forwarded."
  - Notify group: (migration-admins target or email)
```

### Trigger 3: Agent Attempts to Work BoldDesk-Owned Ticket

```
Name:       "Migration: Block agent work on BoldDesk tickets"
Conditions:
  - Ticket updated by agent (not system/admin)
  - Tag: handled_in_bolddesk
Actions:
  - Add internal note: "⚠ This ticket is managed in BoldDesk. Do not update
    in Zendesk. See BoldDesk ticket #{bolddesk_ticket_id}."
  - Notify agent with macro/warning
```

### Zendesk View: "BoldDesk Managed"

```
Conditions: Tag contains "handled_in_bolddesk"
Columns:    ID, Subject, Requester, BoldDesk Ticket ID, Sync State
Sort:       Updated at (descending)
```

Agents see this view as read-only reference. It is **not** in their working queues.

---

## 5. Agent Workflow Rules

### Zendesk Agents

| Scenario | Required Action |
|---|---|
| Ticket has `handled_in_bolddesk` tag | Do not respond, update, or reassign |
| Customer reply appears on tagged ticket | Let trigger handle notification; do not respond |
| Need to escalate a BoldDesk ticket back | Contact admin — do not remove tag manually |
| New ticket arrives (no tag) | Work normally in Zendesk |

### BoldDesk Pilot Agents

| Scenario | Required Action |
|---|---|
| Ticket is handed off to BoldDesk | Work exclusively in BoldDesk |
| Customer reply arrives in BoldDesk | Respond in BoldDesk only |
| Customer reply detected in Zendesk (via sync alert) | Check sync status; escalate if not auto-forwarded |
| Need to return ticket to Zendesk | Request admin revert via defined process |

---

## 6. Ticket Sync State Model (Internal — Derived)

The migration tool tracks a **derived** sync state for each ticket, computed
deterministically from mapping data and failed-item records.  This is separate
from the Zendesk `migration_sync_state` custom field (which is set during
handoff/rollback).

| State | Meaning | Handoff eligible? |
|---|---|---|
| `pending` | Ticket not yet created in BoldDesk (no mapping) | No |
| `partial` | Ticket exists but retryable failures remain (comments/attachments still pending) | No |
| `complete` | All required data migrated and no unresolved failures | **Yes** |
| `failed` | One or more items exhausted retries — terminal until admin resolves | No |

### Derivation logic

```
if no ticket mapping exists         → pending
if any failed_item is exhausted     → failed
if any failed_item is pending       → partial
otherwise                           → complete
```

Failed items considered: entity_type = `ticket` with matching source_id, or
entity_type = `comment`/`attachment` with `metadata.ticketSourceId` matching.

### What "partial" means operationally

The ticket shell is in BoldDesk, but comments or attachments failed.  The
ticket is **not safe to hand off** because agents may see incomplete data.
Action: run retries (`migrate retry --job-id <id>`) until state becomes
`complete` or `failed`.

### What "failed" means operationally

At least one migration item exhausted its retries.  This is a terminal state
that requires admin intervention: inspect the `failed_items` table, fix the
root cause (missing user mapping, API error, etc.), then manually reset the
item status to `pending` and re-run retries.  Handoff is blocked until the
ticket reaches `complete`.

---

## 7. Handoff Procedure — Strict Gating (Option A)

### Gate conditions (all must pass)

Handoff is **blocked** unless:

1. Ticket is not closed in Zendesk
2. `migration_owner_system` is currently `zendesk` (or blank)
3. Derived sync state is `complete` (implies: ticket mapping exists, zero
   unresolved or exhausted `failed_items` linked to the ticket)

If any condition fails, the tool:
- Does **not** transfer ownership
- Logs an audit entry (`pilot_handoff_blocked`) with structured reasons
- Returns a `blocked` result with the specific reasons
- Leaves the ticket owned by Zendesk

### CLI: `migrate pilot-handoff --ticket-id <zendesk_id>`

Execution sequence:

1. **Gate check**: evaluate all four conditions above
2. **If blocked**: return structured `blocked` result (no mutation)
3. **If already active** (owner=bolddesk, sync=pilot_active): idempotent skip
4. **Write back to Zendesk**:
   - Set `migration_owner_system` = `bolddesk`
   - Set `migration_sync_state` = `pilot_active`
   - Set `bolddesk_ticket_id` = `<BoldDesk ticket ID>`
   - Add tag: `handled_in_bolddesk`
   - Add internal note: "This ticket is now managed in BoldDesk
     (ticket #{bolddesk_id}). Do not work this ticket in Zendesk."
5. **Audit**: `action = pilot_handoff`
6. **On write-back failure**: set `migration_sync_state` = `sync_error`, log
   error, do NOT mark as handed off

### Rollback: `migrate pilot-rollback --ticket-id <zendesk_id>`

1. Set `migration_owner_system` = `zendesk`
2. Set `migration_sync_state` = `migrated` (data still in BoldDesk, just not active)
3. Remove tag: `handled_in_bolddesk`
4. Add internal note: "Ticket returned to Zendesk ownership."
5. Audit: `action = pilot_rollback`

### Status: `migrate pilot-status --ticket-id <zendesk_id>`

Shows derived sync state, Zendesk field values, mapping status, and unresolved
failure count.  Use this to diagnose why a handoff is blocked.

---

## 8. Retry ↔ Ownership Interaction Rules

- Retries continue for failed items linked to a ticket **before** handoff.
  This is the normal path: migrate → retry failures → reach `complete` → hand off.
- If a ticket is already owned by BoldDesk (`pilot_active`), retries **do not
  mutate ownership state**.  The retry service processes failed items but does
  not change Zendesk custom fields.
- After each retry pass, the tool re-derives sync state for affected tickets
  and logs any transitions (`sync_state_transition` audit entry).
- If a retry succeeds and clears the last outstanding issue, derived state
  moves to `complete` automatically.
- If retries exhaust for a ticket-critical item, derived state moves to
  `failed` automatically.
- Ownership remains Zendesk unless a subsequent `pilot-handoff` command
  explicitly promotes it after reaching `complete`.

---

## 9. Reply Routing

### Customer replies in Zendesk on a BoldDesk-owned ticket

```
Zendesk Trigger fires → adds tag "pending_bolddesk_sync"
                       → adds internal note with BoldDesk ticket ref
                       → notifies migration admin group

Migration admin either:
  a) Runs sync tool to forward reply to BoldDesk (future: automated)
  b) Manually copies reply to BoldDesk and clears pending tag
  c) Escalates if content requires Zendesk ownership revert
```

The customer **never** gets a response from both systems. The BoldDesk agent
responds after the reply is visible in BoldDesk.

### Customer replies in BoldDesk on a BoldDesk-owned ticket

Normal workflow. No Zendesk action needed. BoldDesk is source of truth.

### Agent accidentally updates a BoldDesk-owned ticket in Zendesk

Trigger fires → internal note warning. Agent update is **not propagated** to
BoldDesk. Admin reviews and cleans up if needed.

### Customer replies in Zendesk on a Zendesk-owned ticket

Normal workflow. No BoldDesk action needed.

---

## 10. Exception Handling

### Sync Error During Handoff

| Field | Value |
|---|---|
| `migration_sync_state` | `sync_error` |
| `migration_owner_system` | remains `zendesk` (handoff incomplete) |
| Action | Log to `failed_items` + audit; manual triage required |

The ticket is **not** treated as handed off. Zendesk agents continue owning it.

### Partial Handoff (ticket created in BoldDesk, but Zendesk write-back failed)

- BoldDesk ticket exists but Zendesk doesn't know
- **Recovery**: re-run `pilot-handoff` (idempotent) to retry write-back
- If repeated failure: manual Zendesk field update + audit log

### Cross-System Update Conflict

If both systems have new activity on the same ticket:
1. BoldDesk version is authoritative (it's the owner)
2. Zendesk activity is treated as a "late arrival" — forwarded, not merged
3. Admin reviews the Zendesk update and decides: forward to BoldDesk or discard

### Attachment/Comment Transfer Failure During Pilot

Same as historical migration: logged to `failed_items`, ticket stays in
incomplete state, retry service can re-attempt.

---

## 11. Status Mapping (Reference)

| Zendesk | BoldDesk | Notes |
|---|---|---|
| new | Open | BoldDesk uses status IDs — confirm per instance |
| open | Open | |
| pending | Waiting on Customer | |
| hold | On Hold | |
| solved | Resolved | |
| closed | Closed | Verify: BoldDesk may not allow direct create-as-closed |

---

## 12. Non-Negotiables

1. No pilot without `migration_owner_system` field live in Zendesk
2. No pilot without Trigger 1 (auto-tag) active
3. No pilot without the "BoldDesk Managed" view configured
4. No ticket has two active owners
5. No agent workflow depends on memory or Slack messages
6. No silent sync errors — every failure is logged and visible
7. No ownership change without audit trail
8. No customer gets duplicate responses from both systems
9. No handoff without derived sync state = `complete` (Option A: strict gating)
10. No retry pass silently changes ownership — ownership transitions require explicit handoff
