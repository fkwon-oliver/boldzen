# Status and Ownership Rules

## Purpose

Define source-of-truth, ownership signaling, and pilot coexistence rules.

This document exists to prevent duplicate work and ambiguity during phased migration.

---

## Core Rule

If a ticket is marked as handled in BoldDesk, Zendesk is no longer the active working system for that ticket.

---

## Ownership Model

### Ownership Field
Create a Zendesk custom field:

`migration_owner_system`

Allowed values:
- `zendesk`
- `bolddesk`

### Sync State Field
Create a Zendesk custom field:

`migration_sync_state`

Allowed values:
- `not_synced`
- `queued_for_migration`
- `migrated`
- `pilot_active`
- `sync_error`
- `cutover_complete`

### Tag
Apply Zendesk tag:

`handled_in_bolddesk`

### Optional Visible Internal Note
When ownership transfers to BoldDesk, add an internal note such as:

> This ticket is now managed in BoldDesk. Zendesk is no longer the active working system for this ticket unless explicitly reassigned.

---

## Source-of-Truth Rules by Phase

### Phase 1: Historical Migration
- Zendesk is source of truth
- BoldDesk receives migrated historical records
- No active working ownership changes yet

### Phase 2: Pilot
- Zendesk remains intake/reference for most agents
- Pilot-owned tickets may move to BoldDesk as source of truth
- Tickets with `migration_owner_system=bolddesk` are no longer worked in Zendesk

### Phase 3: Full Cutover
- BoldDesk becomes source of truth for active tickets
- Zendesk becomes reference/read-only/limited mode based on cutover plan

### Phase 4: Decommission
- Zendesk no longer operational for active support work

---

## Pilot Handoff Rules

A ticket may be handed to BoldDesk only when:
- required baseline migration path is working
- ticket is eligible for pilot scope
- ownership flags can be written back to Zendesk
- handoff is logged

When handed off:
1. create or link ticket in BoldDesk
2. update Zendesk ownership field to `bolddesk`
3. update sync state to `pilot_active`
4. add `handled_in_bolddesk` tag
5. add internal note if required
6. optionally move to BoldDesk-managed view/queue in Zendesk

---

## Agent Rules

### Zendesk Agents
- do not work tickets tagged `handled_in_bolddesk`
- treat BoldDesk-owned tickets as read-only unless explicitly escalated back

### BoldDesk Pilot Users
- work only pilot-assigned tickets
- log exceptions when sync/visibility issues occur
- do not assume Zendesk activity is still authoritative once ownership transfers

---

## Exception Rules

### Sync Failure During Handoff
- set `migration_sync_state=sync_error`
- do not mark ticket as fully transferred
- log issue for manual triage

### Customer Reply Appears in Zendesk After Handoff
- preserve record
- follow defined sync/escalation rule
- do not let both teams respond independently

### Customer Reply Appears in Wrong System
- maintain one ownership system
- either sync it or escalate for manual resolution
- do not switch source of truth casually

### Attachment/Comment Transfer Failure
- log failure with ticket reference
- keep ticket out of “complete” state
- do not silently ignore

---

## Status Mapping Placeholder

Detailed status translation belongs in the implementation layer, but initial mapping should follow this logic:

| Zendesk | BoldDesk | Notes |
|---|---|---|
| new | open/new | confirm exact enum |
| open | open | |
| pending | pending / waiting on customer | |
| hold | on hold | |
| solved | resolved | |
| closed | closed | verify import behavior |

---

## Non-Negotiables

- no pilot without visible ownership controls
- no reliance on memory or Slack coordination
- no silent sync errors
- no ambiguous source-of-truth state