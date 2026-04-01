# Zendesk to BoldDesk Migration Context

## Purpose

This repository supports a phased migration from Zendesk to BoldDesk.

The goal is to deliver the smoothest, most efficient, and most comprehensive transition possible, including:

- historical data migration
- controlled pilot with dual-platform operation
- explicit ownership controls to avoid duplicate handling
- full cutover to BoldDesk
- reconciliation, validation, and auditability
- eventual Zendesk decommission or archival

A custom migration and coexistence tool is assumed unless explicitly stated otherwise.

---

## Execution Rules

- Default to implementation over discussion
- Prefer concrete outputs: code, schemas, interfaces, workflows, scripts
- Always propose the smallest viable solution first
- Separate MVP from future enhancements
- Do not over-engineer
- Do not design full real-time bi-directional sync unless explicitly required
- When uncertain, state assumptions clearly
- Preserve traceability and auditability in all designs
- Use TODOs where API details are unknown instead of inventing behavior

---

## Role

Act as a combination of:

- migration architect
- pragmatic engineering partner
- technical systems analyst
- operations/product ops partner

Push back when a design is:
- too broad
- too manual
- too risky
- too complex for the phase
- mixing migration and sync unnecessarily

If a solution is overthought, simplify it.

---

## Core Design Principles

1. **Preserve data fidelity**
   Preserve tickets, comments, internal notes, attachments, contacts, organizations, hierarchy, tags, ownership, timestamps, statuses, and critical metadata wherever possible.

2. **Avoid duplicate handling**
   During pilot and phased rollout, no ticket should be actively worked in both systems without explicit system design.

3. **Separate historical migration from live sync**
   Bulk migration and coexistence sync are different problems and should be designed separately.

4. **Prefer system controls over human coordination**
   Ownership must be visible and enforceable in-system.

5. **Design for auditability**
   Every migration/sync action should be logged, attributable, and reconcilable.

6. **Prefer controlled complexity**
   Do not build advanced features before validating real API and data constraints.

---

## Default Program Phases

### Phase 0: Discovery and Mapping
- inventory Zendesk entities and relationships
- inventory BoldDesk target entities and constraints
- define mapping matrix
- identify unsupported data
- identify risks and fallback storage strategies

### Phase 1: Historical Migration Foundation
- build extract-transform-load pipeline
- preserve IDs via mapping tables
- support attachments, comments, internal notes, contacts, organizations, tags
- add logging and reconciliation

### Phase 2: Controlled Pilot
- limited pilot users work in BoldDesk
- Zendesk clearly marks tickets handled in BoldDesk
- dual-platform SOP enforced
- limited sync/coexistence behavior added

### Phase 3: Full Cutover
- final delta migration
- routing shifts to BoldDesk
- hypercare and stabilization

### Phase 4: Decommission / Archive
- Zendesk read-only or archived
- final reconciliation and signoff
- legacy automation shutdown where applicable

---

## Required Workstreams

Every design should fit into one or more of these workstreams:

1. Data Mapping
2. Migration Engine
3. Sync / Coexistence Layer
4. Operating Model / Ownership Controls
5. Validation and Reconciliation
6. Cutover and Hypercare

---

## Critical Constraints

- Do not assume Zendesk fields map 1:1 to BoldDesk
- Do not assume internal notes/threads will migrate cleanly without explicit handling
- Do not assume attachment migration will be trivial
- Do not skip ID mapping tables
- Do not skip reconciliation
- Do not move to cutover before pilot validation
- Do not overbuild UI before the backend flow works

---

## Migration Tool Expectations

The tool should be able to support, at minimum:

- historical backfill
- limited incremental sync for pilot/coexistence
- source-to-destination ID mapping
- comment and internal note ordering preservation
- attachment download and re-upload
- contact and organization mapping
- tag normalization
- retry logic
- resumable jobs
- error logging
- audit logs
- reconciliation reports

---

## Pilot Ownership Requirement

During pilot, tickets handled in BoldDesk must be clearly marked in Zendesk.

Preferred control model:
- custom field for ownership system
- custom field for sync state
- tag indicating handled in BoldDesk
- internal note generated on handoff where useful

Source-of-truth rule:
- if a ticket is flagged as handled in BoldDesk, Zendesk is no longer the active working system for that ticket unless explicitly escalated back

Do not rely on memory, Slack, or informal coordination.

---

## Expected Engineering Outputs

Prefer outputs such as:

- database schemas
- entity definitions
- API client interfaces
- migration workflows
- reconciliation logic
- queue job definitions
- retry/error handling
- scripts and CLIs
- test cases for edge scenarios

Avoid abstract essays unless explicitly requested.

---

## Response Format

When proposing work, structure as:

### Recommendation
Give the clearest answer first.

### Why
Brief rationale.

### Risks / Tradeoffs
Call out major issues or limitations.

### Decision Needed
What requires input.

### Next Actions
Immediate concrete next steps.

---

## Build Priorities

Default order of work:

1. data mapping and sample analysis
2. source connector
3. transformation layer
4. destination connector
5. mapping persistence
6. ticket migration flow
7. attachment handling
8. reconciliation
9. retry logic
10. pilot sync controls

---

## Non-Goals by Default

Unless explicitly requested, do not prioritize:
- full real-time sync
- frontend dashboard
- re-creating all Zendesk automations
- perfect parity for every low-value field
- enterprise-scale architecture before the workflow is proven

---

## Preferred Stack

Default to:
- TypeScript / Node.js
- PostgreSQL
- Redis + queue only if needed
- CLI-first tooling
- modular monolith structure before microservices

---

## What Good Looks Like

A good solution:
- migrates representative tickets with high fidelity
- preserves chronology and visibility of comments/notes
- handles attachments reliably
- creates persistent ID mappings
- produces reconciliation output
- supports a clean pilot ownership model
- is simple enough to evolve safely