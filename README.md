# Zendesk → BoldDesk Migration Tool

Lean migration tool for a phased transition from Zendesk to BoldDesk.  
Supports historical backfill, pilot coexistence, reconciliation, and eventual cutover.

## Quick Start

```bash
# Install
npm install

# Copy and configure environment
cp .env.example .env

# Apply database schema
npm run db:migrate

# Run historical migration
npm run dev -- run

# Migrate a single ticket (testing)
npm run dev -- migrate-ticket --ticket-id 12345

# Run reconciliation
npm run dev -- reconcile --job-id 1
```

## Architecture

Modular monolith. TypeScript / Node.js. PostgreSQL for state. CLI-first.

```
src/
├── models/              Normalized domain models (source-agnostic)
├── connectors/
│   ├── source.interface.ts    SourceConnector contract
│   ├── destination.interface.ts DestinationConnector contract
│   ├── zendesk/               Zendesk API wrapper + raw types
│   └── bolddesk/              BoldDesk API wrapper + raw types
├── transform/           Deterministic mappers (status, priority, tags, comments)
├── persistence/
│   ├── *.repository.ts        Repository interfaces
│   └── pg/                    PostgreSQL implementations
├── migration/           Orchestration (historical backfill flow)
├── reconciliation/      Post-migration verification
├── cli/                 CLI entry points (commander)
├── config.ts            Environment-driven configuration
├── logger.ts            Structured logging (pino)
└── errors.ts            Typed error classes

db/                      PostgreSQL schema migrations
tests/                   Unit and integration tests
docs/                    Design docs, mapping matrix, ownership rules
```

### Data Flow

```
Zendesk API
    │
    ▼
SourceConnector          fetch + normalize → NormalizedTicket/User/Org
    │
    ▼
Transform Layer          status mapping, tag normalization, comment visibility
    │
    ▼
DestinationConnector     create entities in BoldDesk
    │
    ▼
MappingRepository        persist source_id → destination_id
    │
    ▼
ReconciliationService    compare source counts vs mapped counts
```

### Key Domain Models

| Model | Purpose |
|---|---|
| `NormalizedTicket` | Source-agnostic ticket with comments, tags, metadata |
| `NormalizedComment` | Public reply or internal note with attachments |
| `NormalizedUser` | Contact / agent / admin |
| `NormalizedOrganization` | Company / org grouping |
| `NormalizedAttachment` | File bound to a specific comment |
| `EntityMapping` | source_id → destination_id per entity type |
| `MigrationJob` | Tracks a migration run (status, counts, timing) |
| `FailedItem` | Dead-letter entry for items that failed |

### Database Tables

| Table | Role |
|---|---|
| `entity_mappings` | Source → destination ID for every migrated entity |
| `migration_jobs` | Each migration run with status and progress |
| `failed_items` | Items that failed with error and retry count |
| `audit_log` | Significant migration events |

## Execution Order

Build and implement in this order. Do not skip ahead.

1. **Domain models and interfaces** — define normalized shapes first
2. **Source connector (Zendesk)** — paginated extraction of users, orgs, tickets, comments, attachments
3. **Transformation layer** — status/priority mapping, tag normalization, comment visibility
4. **Destination connector (BoldDesk)** — create contacts, orgs, tickets, conversation items, attachments
5. **Mapping persistence** — store source → destination ID mappings in PostgreSQL
6. **Historical migration flow** — orchestrate: resolve orgs/users → create ticket → add comments chronologically → handle attachments → persist mappings
7. **Attachment handling** — download from Zendesk (auth, expiring URLs) → upload to BoldDesk → bind to comment
8. **Reconciliation** — compare source vs mapped counts, detect mismatches, generate report
9. **Retry logic** — dead-letter tracking, resumable jobs, idempotent reruns
10. **Pilot ownership controls** — Zendesk custom fields, tags, internal notes for handoff
11. **Limited sync** — only after historical migration and pilot controls are proven

## Design Rules

- Historical migration and live sync are **separate problems**
- Do not assume Zendesk maps 1:1 to BoldDesk
- Preserve source IDs for reconciliation
- Public replies and internal notes must be handled explicitly
- Attachments are first-class entities, not afterthoughts
- Design for idempotency and resumability
- No migration is complete without reconciliation

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

Priority test areas: status mapping, comment visibility, chronology preservation,
attachment workflow, idempotent reruns, reconciliation mismatch detection.

## Environment Variables

See `.env.example` for all required and optional configuration.
