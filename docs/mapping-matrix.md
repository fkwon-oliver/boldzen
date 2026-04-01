# Mapping Matrix

## Purpose

This document tracks how Zendesk entities and fields map to BoldDesk.

Rules:
- do not assume 1:1 parity
- if mapping is unknown, mark as `TBD`
- if not supported, define fallback behavior
- preserve original Zendesk IDs for reconciliation

---

## Ticket Mapping

| Zendesk Field | BoldDesk Field | Mapping Type | Required | Rule | Notes |
|---|---|---:|---:|---|---|
| id | external_source_id or custom field | Direct | Yes | preserve original ID | critical for reconciliation |
| subject | subject | Direct | Yes | trim if needed | |
| description | description or first public message | Conditional | Yes | preserve original first body | confirm BoldDesk behavior |
| status | status | Transform | Yes | see status mapping doc | |
| priority | priority | Transform | No | normalize enums | |
| type | type | Transform | No | map only if supported | |
| requester_id | contact/requester | Lookup | Yes | resolve via user mapping | |
| assignee_id | assignee | Lookup | No | resolve via agent mapping | may be null |
| organization_id | company/org | Lookup | No | resolve via org mapping | |
| tags | tags/labels | Transform | No | dedupe and normalize | |
| created_at | metadata/custom field | Conditional | Yes | preserve if direct set not possible | |
| updated_at | metadata/custom field | Conditional | Yes | preserve if direct set not possible | |
| custom_fields | custom fields | Transform | No | field-by-field review | |
| via/channel | source/channel | Transform | No | normalize | |

---

## Comment / Note Mapping

| Zendesk Field | BoldDesk Field | Mapping Type | Required | Rule | Notes |
|---|---|---:|---:|---|---|
| id | external_comment_id or metadata | Direct | Yes | preserve original ID | needed for sync/reconciliation |
| body/html_body/plain_body | body | Transform | Yes | preserve body safely | sanitize unsupported html |
| public=true | public reply | Direct | Yes | map to public visibility | |
| public=false | internal note | Transform | Yes | map to private/internal visibility | critical |
| author_id | author | Lookup | Yes | resolve via user mapping | fallback service user if needed |
| created_at | created_at or metadata | Conditional | Yes | preserve chronology | |
| attachments | attachments | Transform | No | upload then bind to comment/note | order matters |

---

## Attachment Mapping

| Zendesk Field | BoldDesk Field | Required | Rule | Notes |
|---|---|---:|---|---|
| attachment id | external_attachment_id or metadata | Yes | preserve original ID | |
| url | upload input | Yes | download with auth then upload | watch expiring URLs |
| file_name | filename | Yes | preserve | sanitize if required |
| content_type | mime type | No | preserve where possible | |
| size | size metadata | No | preserve for validation | |
| comment_id | parent conversation item | Yes | attach to correct parent | critical |

---

## User / Contact Mapping

| Zendesk Field | BoldDesk Field | Mapping Type | Required | Rule | Notes |
|---|---|---:|---:|---|---|
| id | external_source_id | Direct | Yes | preserve original ID | |
| name | name | Direct | Yes | normalize blank values | |
| email | email | Direct/Lookup | Yes | lowercase and dedupe | primary dedupe field |
| phone | phone | Direct | No | normalize format | |
| role | role/type | Transform | Yes | map requester/end-user/agent/admin | |
| organization_id | org link | Lookup | No | resolve via org mapping | |
| active/suspended | status | Transform | No | only if needed operationally | |

---

## Organization Mapping

| Zendesk Field | BoldDesk Field | Mapping Type | Required | Rule | Notes |
|---|---|---:|---:|---|---|
| id | external_source_id | Direct | Yes | preserve original ID | |
| name | name | Direct | Yes | dedupe carefully | |
| notes/details | description/metadata | Transform | No | preserve if useful | |
| domain_names | domains/custom field | Transform | No | normalize array | |
| parent/hierarchy | parent org or metadata | Conditional | No | preserve hierarchy if supported, else metadata | likely not 1:1 |
| tags | labels/custom field | Transform | No | normalize | |

---

## Unmapped / Unsupported Data

Track anything that does not map cleanly here.

| Entity | Source Field | Issue | Proposed Fallback | Decision |
|---|---|---|---|---|
| Ticket | TBD | TBD | store in metadata | TBD |
| Comment | TBD | TBD | append note or raw metadata | TBD |
| Org | TBD | TBD | custom field | TBD |

---

## Open Questions

- Can BoldDesk preserve original timestamps directly?
- Can BoldDesk distinguish internal vs public comments in the same way Zendesk does?
- How are attachments associated to individual replies/notes?
- What are BoldDesk limits for body length, file size, and batch creation?
- How should merged Zendesk tickets be represented?