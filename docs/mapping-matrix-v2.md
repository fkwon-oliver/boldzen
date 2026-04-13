# Mapping Matrix v2

Reflects the implemented state of the migration tool as of 2026-04-13.
Everything in this document is derived from code, not speculation.
Unknowns are marked explicitly.

---

## 1. Ticket Field Mapping

| Zendesk Field | BoldDesk Field | Transform | Status | Notes |
|---|---|---|---|---|
| `subject` | `subject` | Direct | Implemented | |
| `description` / `html_body` (first comment) | `description` | Direct (HTML preferred) | Implemented | |
| `status` | `statusId` | Enum → numeric ID | Implemented | See status table below |
| `priority` | `priorityId` | Enum → numeric ID | Implemented | Defaults to medium if null. See priority table below |
| `requester_id` | `requesterEmailId` + `requesterName` | Lookup via user cache | Implemented | Resolved from Zendesk user fetch |
| `assignee_id` | `agentId` | Lookup via `agents.csv` | Implemented | Unassigned if agent not in CSV |
| `organization_id` | `contactGroupId` | Lookup via mapping DB | Implemented | Org migrated as BoldDesk Contact Group |
| `tags` | `tags` | Normalized + stripped | Implemented | Lowercased, deduped, tagger tags removed |
| `custom_fields[29599516755099]` (Topic) | `customFields[BOLDDESK_TOPIC_FIELD_KEY]` | Tag → display value | Implemented | Resolved via `data/topics.csv` |
| (derived from assignee) | `groupId` | Assignee email → group name → group ID | Implemented | Via `agents.csv` Group column + static map |
| `via.channel` | — | Not mapped | Excluded | Not sent to BoldDesk |
| `type` (problem/incident/question/task) | — | Not mapped | Excluded | No BoldDesk equivalent configured |
| `created_at` | — | Not mapped | **UNKNOWN** | Not set in createTicket payload. Unknown if BoldDesk captures API-creation time automatically |
| `updated_at` | — | Not mapped | **UNKNOWN** | Same as above |
| `id` (Zendesk ticket ID) | — | Stored in mapping DB only | Implemented | Not sent as a BoldDesk field |
| `followers` / `email_ccs` | — | Not mapped | Excluded (intentional) | |

### Static fields set on every ticket

| BoldDesk Field | Value | Source |
|---|---|---|
| `brandId` | `BOLDDESK_BRAND_ID` env var (default: 1) | Config |
| `ticketPortalValue` | `BOLDDESK_TICKET_PORTAL_VALUE` env var | Config |
| `isVisibleInCustomerPortal` | `true` | Hardcoded |
| `skipDependencyValidation` | `true` | Hardcoded |

---

## 2. Status Mapping

| Zendesk Status | BoldDesk Status Key | BoldDesk `statusId` |
|---|---|---|
| `new` | `new` | 1 |
| `open` | `open` | 2 |
| `pending` | `pending` | 3 |
| `hold` | `on_hold` | 4 |
| `solved` | `resolved` | 5 |
| `closed` | `closed` | 6 |

Unknown Zendesk status values throw an error (migration halts for that ticket).

---

## 3. Priority Mapping

| Zendesk Priority | BoldDesk Priority Key | BoldDesk `priorityId` |
|---|---|---|
| `low` | `low` | 1 |
| `normal` | `medium` | 2 |
| `high` | `high` | 3 |
| `urgent` | `urgent` | 4 |
| (null / undefined) | `medium` | 2 |

---

## 4. Topic Field

| Property | Value |
|---|---|
| Zendesk field type | Tagger (dropdown) |
| Zendesk field ID | `29599516755099` |
| BoldDesk target | Custom dropdown field |
| BoldDesk field key | Set via `BOLDDESK_TOPIC_FIELD_KEY` env var |
| Value source | `data/topics.csv` — tag column → value column |
| Transform | Zendesk stores the tag slug (e.g. `customer_support`); resolved to display label (e.g. `Customer Support (Question & Answer)`) |
| Fallback | If tag not in CSV, raw tag value is sent as-is |
| If field is null/empty | `customFields` key omitted from payload |
| If `BOLDDESK_TOPIC_FIELD_KEY` is not set | Topic value is resolved but not sent (no-op) |

### Topic Values (21)

| Display Value | Zendesk Tag |
|---|---|
| Customer Support (Question & Answer) | `customer_support` |
| Technical Support (Account updates) | `technical_support` |
| Exam Support | `exam_support` |
| IT Requests | `it_request` |
| Refunds | `refunds` |
| Reminders | `reminders` |
| Nullifications | `nullifications` |
| Suspended Students | `banned_students` |
| Content | `content` |
| Special Accommodations | `special_accommodations_` |
| Mutual Funds Requests | `mutual_funds_results` |
| Voicemails | `voicemails` |
| Payment Receipts | `payment_receipts_` |
| Book Orders | `book_orders` |
| Reports | `reports` |
| GC - Questions redirected to GC | `gc_-_questions_redirected_to_gc` |
| GC - Requests from GC | `gc_-_requests_from_gc` |
| GC - Non-compliant | `gc_-_non-compliant_` |
| TICO - Certificates prior to Jan 2019 | `tico_-_certificates_prior_to_jan_2019` |
| TICO - Questions redirected to TICO | `tico_-_questions_redirected_to_tico` |
| SpeedPass Refund Escalation | `speedpass_refund_escalation` |

---

## 5. Tag Stripping Rules

Zendesk tagger fields (Topic and Organization) auto-inject their selected value into the ticket's `tags` array. This creates duplication because those values are already mapped to structured fields.

### What is stripped

All tags matching entries in the `tag` column of:
- `data/topics.csv` — 21 values
- `data/organizations.csv` — 42 values

Total: **63 tagger-injected tag values** removed before sending to BoldDesk.

Matching is case-insensitive after lowercasing.

### What is preserved

Any tag NOT in the tagger set passes through. These are manually applied tags.

### Processing order

1. Lowercase and trim each tag
2. Skip empty strings
3. Skip if tag is in the tagger strip set
4. Skip if already seen (dedup)
5. Remaining tags are sent to BoldDesk

### Organization tagger tags stripped (42)

`call_-_wfg`, `call_-_georgian_college_`, `call_-_tico_moodle`, `call_-_tico`, `call_-_oliver_s_hllqp`, `call_-_altig`, `call_-_primerica`, `call_-_experior`, `call_-_bmo`, `call_-_sunlife`, `call_-_combined`, `call_-_max_financial`, `call_-_oliver_s_retail`, `call_-_wfg_historic`, `call_-_safeselling/safebyoliver`, `call_-_thia`, `call_-_real_trading`, `call_-_4pillars`, `call_-_ipc`, `wfg`, `georgian_college`, `tico_moodle`, `tico`, `oliver_solutions`, `altig`, `primerica`, `experior`, `sunlife`, `bmo`, `combined`, `max_financial`, `oliver_s_retail`, `wfg_historic`, `thia`, `safe_selling`, `real_trading`, `4pillars`, `ipc`, `oliver_s_-_internal`, `amf`, `unknown`, `spam`

---

## 6. Comment / Note Mapping

| Zendesk Field | BoldDesk Field | Transform | Status |
|---|---|---|---|
| `html_body` / `plain_body` / `body` | `description` | HTML preferred, falls back to plain | Implemented |
| `public: true` | Public reply (POST `.../updates`) | Direct | Implemented |
| `public: false` | Internal note (POST `.../notes`, `isPublicNote: false`) | Direct | Implemented |
| `author_id` | — | Not mapped | **Not sent** — comment created by API caller identity |
| `created_at` | — | Not mapped | **UNKNOWN** — BoldDesk records API-time, not original time |
| `attachments` | `attachments` (comma-separated tokens) | Upload then bind | Implemented |

### Comment handling sequence

1. First comment (index 0) is used as the ticket `description` and its attachments are uploaded and included in the `createTicket` payload.
2. All subsequent comments (index 1+) are migrated individually as replies or notes, each with their own attachment uploads.
3. Each comment has an idempotency check via the mapping DB.

### Static fields set on every reply

| Field | Value |
|---|---|
| `skipEmailNotification` | `true` |
| `dontAppendOnBehalfOfRequesterMessage` | `true` |
| `updateDetailsFromPortal` | `false` |

### Static fields set on every note

| Field | Value |
|---|---|
| `skipEmailNotification` | `true` |
| `isPublicNote` | `false` |

---

## 7. Attachment Mapping

| Zendesk Field | BoldDesk Field | Status |
|---|---|---|
| `content_url` | Upload source (downloaded with auth) | Implemented |
| `file_name` | Multipart filename | Implemented |
| `content_type` | Multipart content type | Implemented |
| `size` | — | Not sent (stored in normalized model only) |
| `id` | Mapping DB (source → token) | Implemented |

Upload returns a token string. Tokens are joined with `,` and sent in the `attachments` field of ticket/comment payloads.

**UNKNOWN**: Whether BoldDesk actually expects comma-separated tokens or only a single token per request. Current implementation joins with `,`. Needs live verification for multi-attachment tickets.

---

## 8. User / Contact Mapping

| Zendesk Field | BoldDesk Field | Status |
|---|---|---|
| `name` | `name` | Implemented (falls back to email if empty) |
| `email` | `email` | Implemented (lowercased) |
| `phone` | `phone` | Implemented (optional) |
| `id` | Mapping DB only | Implemented |
| `role` | — | Not sent to BoldDesk |
| `active` / `suspended` | — | Not sent to BoldDesk |
| `organization_id` | — | Not sent at contact level; resolved at ticket level |

Contacts are deduplicated by email (find-or-create).

---

## 9. Organization → Contact Group Mapping

| Zendesk Field | BoldDesk Field | Status |
|---|---|---|
| `name` | `name` | Implemented |
| `details` + `notes` | `description` (concatenated) | Implemented |
| `id` | Mapping DB only | Implemented |
| `domain_names` | — | Not sent |
| `tags` | — | Not sent |

Contact groups are deduplicated by name (find-or-create).

---

## 10. Agent / Assignee Mapping

| Source | Mechanism | Status |
|---|---|---|
| `data/agents.csv` | email → `bolddesk_id` static lookup | Implemented |
| API fallback | Optional runtime fetch (not wired in CLI) | Not active |

### Current agent mappings (7)

| Name | Email | BoldDesk ID | Group |
|---|---|---|---|
| Oliver Admin | product@oliversolutions.com | 1000 | Student Experience Center |
| Memory Dube | mdube@oliversolutions.com | 1007 | Student Experience Center |
| Sali Zhang | szhang@oliversolutions.com | 1008 | Student Experience Center |
| Savannah Szydlowska | sszydlowska@oliversolutions.com | 1009 | Student Experience Center |
| Nicole Connors | nconnors@oliversolutions.com | 1010 | Student Experience Center |
| Tara Haddad | thaddad@oliversolutions.com | 1011 | Student Experience Center |
| Manimala Asvin | masvin@oliversolutions.com | 1012 | Content Team |

### Group mapping (static, hardcoded in CLI)

| Group Name | BoldDesk Group ID |
|---|---|
| Student Experience Center | 3 |
| Content Team | 4 |

Group is derived from the assignee's email → agents.csv Group column → static group ID map. If the assignee is not in the CSV, both `agentId` and `groupId` are omitted from the payload.

---

## 11. What is Migrated vs Excluded

### Migrated

| Entity | Scope |
|---|---|
| Tickets | All fields listed in section 1 |
| Comments | Public replies and internal notes, with HTML body and attachments |
| Attachments | All comment attachments (downloaded and re-uploaded) |
| Users | As BoldDesk contacts (name, email, phone) |
| Organizations | As BoldDesk contact groups (name, description) |
| Assignees | Mapped to BoldDesk agent IDs via CSV |
| Groups | Derived from assignee email |
| Topic | Zendesk custom field → BoldDesk custom dropdown |
| Tags | Manual tags only (tagger-injected values stripped) |
| Mapping persistence | All source→destination ID pairs stored in PostgreSQL |
| Audit trail | All migration events logged |

### Explicitly Excluded

| Entity / Field | Reason |
|---|---|
| Followers / email CCs | Intentional — no BoldDesk equivalent needed |
| Ticket type (problem/incident/question/task) | No corresponding BoldDesk field configured |
| Channel (`via`) | Not mapped — informational only |
| User role, active/suspended status | Not relevant for BoldDesk contacts |
| Organization domain_names | Not supported by BoldDesk contact groups |
| Organization tags | Redundant with contact group name |
| Comment author identity | BoldDesk API creates under caller identity; original author not preserved |

---

## 12. Remaining Gaps and Unknowns

| # | Item | Impact | Status |
|---|---|---|---|
| 1 | **Original timestamps not preserved** — `created_at` and `updated_at` are not sent in ticket or comment payloads. BoldDesk records API-time. | Ticket and comment dates in BoldDesk will reflect migration time, not original Zendesk time. | UNKNOWN — needs investigation of BoldDesk API for timestamp override support |
| 2 | **Comment author not preserved** — replies/notes are created under the API key's identity, not the original Zendesk author. | All migrated comments will appear to be from the migration service account. | UNKNOWN — needs investigation of BoldDesk `updatedByuserIdorEmailId` field behavior |
| 3 | **Multi-attachment token format** — current implementation joins upload tokens with `,`. | Could fail silently if BoldDesk expects a different format for multi-attachment payloads. | UNKNOWN — needs live verification with multi-attachment tickets |
| 4 | **`BOLDDESK_TOPIC_FIELD_KEY` not yet confirmed** — env var placeholder is `cf_topic`. | Topic values will not be sent until the actual BoldDesk custom field key is configured. | Needs admin to confirm the exact field key from BoldDesk admin UI |
| 5 | **BoldDesk status/priority IDs are assumed defaults** — hardcoded as 1–6 / 1–4. | If the BoldDesk instance has custom status/priority configurations, IDs may differ. | Needs verification against live instance |
| 6 | **Zendesk ticket ID not stored in BoldDesk** — source ID is only in the mapping DB. | No way to cross-reference from BoldDesk UI back to Zendesk without querying the DB. | Consider adding as a BoldDesk custom field in future |
| 7 | **Other Zendesk custom fields** — only Topic (field `29599516755099`) is mapped. Any other custom fields are read into the normalized model but not sent. | Data loss for non-Topic custom fields. | Needs field-by-field review if additional fields are required |
| 8 | **Merged tickets** — no special handling. | Merged tickets in Zendesk will be migrated as standalone tickets. | Accepted for MVP |
| 9 | **Group mapping is hardcoded** — only 2 groups defined in CLI. | If new groups are added in BoldDesk, code must be updated. | Consider moving to CSV or env config |

---

## 13. Configuration Reference

| Env Var | Purpose | Required |
|---|---|---|
| `ZENDESK_SUBDOMAIN` | Zendesk instance | Yes |
| `ZENDESK_EMAIL` | Zendesk API auth email | Yes |
| `ZENDESK_API_TOKEN` | Zendesk API token | Yes |
| `BOLDDESK_BASE_URL` | BoldDesk instance URL | Yes |
| `BOLDDESK_API_KEY` | BoldDesk API key | Yes |
| `BOLDDESK_BRAND_ID` | BoldDesk brand ID | No (default: 1) |
| `BOLDDESK_TICKET_PORTAL_VALUE` | BoldDesk portal slug | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `MIGRATION_BATCH_SIZE` | Tickets per batch | No (default: 50) |
| `TOPICS_CSV_PATH` | Path to topics.csv | No (default: `data/topics.csv`) |
| `ORGS_CSV_PATH` | Path to organizations.csv | No (default: `data/organizations.csv`) |
| `BOLDDESK_TOPIC_FIELD_KEY` | BoldDesk custom field key for Topic | No (topic not sent if empty) |

### Data files

| File | Purpose | Row count |
|---|---|---|
| `data/agents.csv` | Agent email → BoldDesk ID + Group | 7 agents |
| `data/topics.csv` | Topic display value ↔ tagger tag | 21 topics |
| `data/organizations.csv` | Organization display value ↔ tagger tag | 42 organizations |
