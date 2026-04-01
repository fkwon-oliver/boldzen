# Reconciliation Framework

## Purpose

Define how migration completeness and sync accuracy will be validated.

A migration is not considered complete just because records were created in BoldDesk.

---

## Principles

- validate counts and content
- verify ticket-level fidelity, not just batch totals
- categorize discrepancies explicitly
- preserve evidence for signoff
- do not hide unrecoverable mismatches

---

## Reconciliation Layers

## 1. Batch-Level Validation

For each migration job, validate:

- source ticket count extracted
- destination ticket count created
- success count
- partial count
- failed count
- retryable failure count
- non-retryable failure count

### Output
A batch summary report with:
- job id
- start/end time
- counts by entity
- failure categories
- reconciliation status

---

## 2. Ticket-Level Validation

For each migrated ticket, validate:

- ticket mapping exists
- requester/contact resolved or exception recorded
- organization resolved or exception recorded
- status mapped
- comment count matches expected count
- internal note count matches expected count
- attachment count matches expected count
- tags mapped within acceptable tolerance
- chronology preserved
- destination references persisted

### Minimum Result States
- `matched`
- `matched_with_exceptions`
- `partial`
- `failed`

---

## 3. Entity-Level Validation

### Users / Contacts
- source user mapped or exception logged
- duplicate contacts not unintentionally created
- email-based dedupe behavior understood

### Organizations
- source org mapped or exception logged
- hierarchy behavior documented where not supported directly

### Attachments
- file uploaded successfully
- attached to correct ticket/conversation item
- filename preserved
- size/type optionally verified

---

## Discrepancy Categories

Use consistent categories:

- `missing_destination_ticket`
- `missing_contact_mapping`
- `missing_org_mapping`
- `status_mapping_failure`
- `comment_count_mismatch`
- `internal_note_count_mismatch`
- `attachment_count_mismatch`
- `attachment_upload_failure`
- `chronology_mismatch`
- `body_transform_issue`
- `api_error`
- `validation_error`
- `unsupported_feature`

---

## Sampling Rules

Even when automated reconciliation exists, manually sample:

- high-comment tickets
- tickets with internal notes
- tickets with multiple attachments
- tickets with complex org/contact relationships
- closed/solved historical tickets
- tickets with edge-case formatting or HTML

Suggested minimum sample sizes:
- 10 tickets for early MVP validation
- 25 tickets before pilot
- 50+ tickets before cutover readiness

---

## Signoff Criteria

Do not call a migration batch complete until:

- discrepancies are quantified
- all failures are categorized
- retryable items have a path to resolution
- unrecoverable losses are explicitly accepted
- reconciliation output is stored and reviewable

---

## CLI / Reporting Expectations

The tool should output:

- migration job summary
- discrepancy counts by category
- failed ticket list
- failed attachment list
- missing mapping list
- optional per-ticket reconciliation detail

---

## Definition of Success

A good reconciliation process:
- catches silent failures
- makes partial migrations obvious
- gives operations confidence
- supports pilot and cutover decisions