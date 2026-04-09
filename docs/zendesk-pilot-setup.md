# Zendesk Admin Setup — Pilot Coexistence

This document lists every Zendesk configuration change required before running
pilot handoffs. Complete all steps, then record the custom field IDs in `.env`.

---

## 1. Custom Ticket Fields

Create these in **Zendesk Admin → Manage → Ticket Fields**.

### Field: `migration_owner_system`

| Setting | Value |
|---|---|
| Type | Drop-down |
| Title | Migration Owner System |
| Required | No |
| Visible to agents | Yes (read-only recommended via field permissions) |
| Visible to end users | No |
| Options | `zendesk`, `bolddesk` |
| Default | `zendesk` |

After creation, record the **field ID** → set `ZD_FIELD_OWNER_SYSTEM` in `.env`.

### Field: `migration_sync_state`

| Setting | Value |
|---|---|
| Type | Drop-down |
| Title | Migration Sync State |
| Required | No |
| Visible to agents | Yes (read-only recommended) |
| Visible to end users | No |
| Options | `not_synced`, `migrated`, `pilot_active`, `sync_error`, `cutover_complete` |
| Default | `not_synced` |

After creation, record the **field ID** → set `ZD_FIELD_SYNC_STATE` in `.env`.

### Field: `bolddesk_ticket_id`

| Setting | Value |
|---|---|
| Type | Text |
| Title | BoldDesk Ticket ID |
| Required | No |
| Visible to agents | Yes (read-only) |
| Visible to end users | No |

After creation, record the **field ID** → set `ZD_FIELD_BOLDDESK_TICKET_ID` in `.env`.

---

## 2. Group

Create a group to hold BoldDesk-owned tickets out of normal queues.

| Setting | Value |
|---|---|
| Name | BoldDesk Migration Holding |
| Agents | None (or a single migration admin account) |

This group receives tickets after handoff so they don't appear in agent queues.

---

## 3. Triggers

Create in **Zendesk Admin → Business Rules → Triggers**.

### Trigger: Auto-tag BoldDesk-owned tickets

```
Name:        Migration: Tag BoldDesk-owned tickets

Conditions (ALL):
  - Ticket: migration_owner_system IS bolddesk

Actions:
  - Add tags:       handled_in_bolddesk
  - Group:          BoldDesk Migration Holding
```

### Trigger: Customer reply on BoldDesk-owned ticket

```
Name:        Migration: Customer reply on BoldDesk ticket

Conditions (ALL):
  - Ticket: Updated by end user
  - Ticket: Tags contain handled_in_bolddesk

Actions:
  - Add tags:       pending_bolddesk_sync
  - Add internal note:
      "⚠ Customer replied in Zendesk. This ticket is managed in BoldDesk
       (see BoldDesk Ticket ID field). Reply must be synced or manually
       forwarded to BoldDesk."
  - Notify by email: (migration admin group/email)
```

### Trigger: Agent warning on BoldDesk-owned ticket

```
Name:        Migration: Block agent work on BoldDesk tickets

Conditions (ALL):
  - Ticket: Updated by agent
  - Ticket: Tags contain handled_in_bolddesk
  - Current user is not: (migration admin account)

Actions:
  - Add internal note:
      "⚠ This ticket is managed in BoldDesk. Do not update in Zendesk.
       Refer to BoldDesk Ticket ID field for the destination ticket."
```

---

## 4. Views

### View: BoldDesk Managed

```
Name:        BoldDesk Managed (Read-Only)

Conditions (ALL):
  - Tags contain handled_in_bolddesk

Columns:
  - Ticket ID
  - Subject
  - Requester
  - BoldDesk Ticket ID (custom field)
  - Migration Sync State (custom field)
  - Updated

Sort: Updated (descending)
Group: Available to all agents (read-only reference)
```

### View: Pending BoldDesk Sync

```
Name:        Pending BoldDesk Sync

Conditions (ALL):
  - Tags contain pending_bolddesk_sync

Columns:
  - Ticket ID
  - Subject
  - Requester
  - BoldDesk Ticket ID
  - Updated

Sort: Updated (descending)
Group: Available to migration admins only
```

---

## 5. Verification Checklist

Run through before any pilot handoffs:

- [ ] `migration_owner_system` field exists, ID recorded in `.env`
- [ ] `migration_sync_state` field exists, ID recorded in `.env`
- [ ] `bolddesk_ticket_id` field exists, ID recorded in `.env`
- [ ] "BoldDesk Migration Holding" group created
- [ ] Trigger "Auto-tag BoldDesk-owned tickets" is active
- [ ] Trigger "Customer reply on BoldDesk ticket" is active
- [ ] Trigger "Block agent work on BoldDesk tickets" is active
- [ ] View "BoldDesk Managed" is visible to agents
- [ ] View "Pending BoldDesk Sync" is visible to migration admins
- [ ] Test: run `migrate pilot-handoff --ticket-id <test_id>` on a test ticket
- [ ] Test: verify Zendesk fields updated, tag applied, internal note added
- [ ] Test: verify customer reply trigger fires on test ticket
- [ ] Test: run `migrate pilot-rollback --ticket-id <test_id>` to confirm revert
