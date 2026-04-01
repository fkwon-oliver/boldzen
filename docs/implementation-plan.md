# Implementation Plan

## Objective

Build a lean, production-conscious migration tool to support:

1. historical Zendesk to BoldDesk migration
2. controlled pilot coexistence
3. reconciliation, logging, and retryability
4. eventual full cutover support

---

## Guiding Rule

Do not build sync first.

Build in this order:
1. mapping
2. extraction
3. transformation
4. loading
5. reconciliation
6. pilot controls
7. limited sync

---

## Phase 0: Discovery and Mapping

### Deliverables
- Zendesk entity inventory
- BoldDesk entity inventory
- mapping matrix
- status mapping rules
- ownership model
- unsupported data list
- representative ticket sample set

### Exit Criteria
- at least 20 representative Zendesk tickets reviewed
- comment/internal note structure understood
- attachment handling assumptions documented
- initial field mapping agreed

---

## Phase 1: Historical Migration MVP

### Deliverables
- Zendesk connector
- BoldDesk connector
- internal normalized models
- PostgreSQL schema for mappings and jobs
- one-batch historical backfill flow
- per-ticket logging
- basic reconciliation report

### MVP Scope
- users / contacts
- organizations
- tickets
- comments
- internal notes
- attachments
- tags
- key metadata

### Exit Criteria
- 10 to 20 representative tickets migrated successfully
- chronology preserved
- private vs public comment behavior preserved
- attachment path validated
- reconciliation output generated

---

## Phase 2: Historical Migration Hardening

### Deliverables
- retry logic
- resumable jobs
- dead-letter / failed-item handling
- batch processing
- idempotency safeguards
- improved reconciliation

### Exit Criteria
- repeated runs do not create duplicates
- failed items can be retried safely
- discrepancies are visible and categorized

---

## Phase 3: Pilot Coexistence Controls

### Deliverables
- Zendesk ownership fields/tags defined
- handoff workflow documented
- source-of-truth rules implemented
- limited sync logic for pilot-owned tickets
- internal note or visible flag applied on handoff

### Exit Criteria
- a ticket can be handed from Zendesk to BoldDesk without ambiguity
- Zendesk users can clearly see not to work the ticket
- pilot users can operate in BoldDesk without duplicate handling risk

---

## Phase 4: Cutover Readiness

### Deliverables
- final delta migration approach
- cutover checklist
- freeze window plan
- hypercare issue process
- decommission criteria

### Exit Criteria
- reconciliation within acceptable tolerance
- pilot metrics stable
- source-of-truth rules proven
- rollback path understood

---

## Engineering Work Order

### 1. Scaffolding
- repo structure
- config
- models
- connector interfaces
- db schema

### 2. Source Connector
- tickets
- comments
- users
- orgs
- attachments

### 3. Destination Connector
- contacts
- orgs
- tickets
- conversation items
- attachments

### 4. Normalization / Transformation
- status mapping
- tag normalization
- public vs internal comment transformation
- metadata preservation

### 5. Historical Ticket Flow
- resolve orgs and users
- create ticket shell
- add conversation items in chronological order
- upload and bind attachments
- persist mappings
- reconcile

### 6. Hardening
- retries
- checkpoints
- failed-item tracking
- CLI controls

### 7. Pilot Controls
- ownership flags
- sync state handling
- handoff logic

---

## Definition of Done

A migration increment is not done unless it includes:
- logging
- mapping persistence
- error handling
- reconciliation
- explicit assumptions