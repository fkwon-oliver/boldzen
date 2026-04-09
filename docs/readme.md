# Zendesk → BoldDesk Migrator

## Overview

This repository contains a migration tool intended to support a phased transition from Zendesk to BoldDesk.

The tool is expected to support:

- historical backfill
- controlled pilot coexistence
- source-to-destination ID mappings
- comments and internal note migration
- attachment migration
- contact and organization migration
- reconciliation and auditability

This project should be built incrementally and pragmatically.

Do not over-engineer early versions.

---

## Core Design Rules

- historical migration and live sync are separate problems
- preserve Zendesk IDs for reconciliation
- public replies and internal notes must be handled explicitly
- attachments are high-risk and must not be treated as an afterthought
- ownership controls are mandatory during pilot
- migration is not done without reconciliation

---

## Repository Priorities

Build in this order:

1. domain models and interfaces
2. source connector
3. destination connector
4. mapping persistence
5. historical migration flow
6. attachment support
7. reconciliation
8. retry logic
9. pilot ownership controls
10. limited sync

---

## Structure

```text
src/
├── models/              Normalized domain models (source-agnostic)
│   ├── user.ts
│   ├── organization.ts
│   ├── ticket.ts
│   ├── comment.ts
│   ├── attachment.ts
│   ├── mapping.ts
│   └── job.ts
├── connectors/
│   ├── source.interface.ts       SourceConnector contract
│   ├── destination.interface.ts  DestinationConnector contract
│   ├── zendesk/                  Zendesk API wrapper + raw types
│   │   ├── zendesk.client.ts
│   │   ├── zendesk.types.ts
│   │   ├── zendesk.normalizers.ts
│   │   └── zendesk.connector.ts
│   └── bolddesk/                 BoldDesk API wrapper + raw types
│       ├── bolddesk.types.ts
│       └── bolddesk.connector.ts
├── transform/           Deterministic mappers and normalizers
│   ├── status.mapper.ts
│   ├── priority.mapper.ts
│   ├── comment.transformer.ts
│   └── tag.normalizer.ts
├── persistence/
│   ├── mapping.repository.ts     MappingRepository interface
│   ├── job.repository.ts         JobRepository interface
│   ├── audit.repository.ts       AuditRepository interface
│   ├── run-migrations.ts         DB schema runner
│   └── pg/                       PostgreSQL implementations
│       ├── pg.client.ts
│       ├── pg.mapping.repository.ts
│       ├── pg.job.repository.ts
│       └── pg.audit.repository.ts
├── migration/           Orchestration (historical backfill flow)
│   └── migration.service.ts
├── reconciliation/      Post-migration verification
│   └── reconciliation.service.ts
├── cli/                 CLI entry points (commander)
│   └── index.ts
├── config.ts            Environment-driven configuration
├── logger.ts            Structured logging (pino)
└── errors.ts            Typed error classes

db/                      PostgreSQL schema migrations
tests/                   Unit and integration tests
docs/                    Design docs, mapping matrix, ownership rules
```

---

## Current Implementation Status

| Component | Status |
|---|---|
| Domain models | Complete |
| Zendesk connector + types + normalizers | Complete |
| Connector interfaces (source + destination) | Complete |
| Transform layer (status, priority, comment, tags) | Complete |
| BoldDesk types | Stub (pending API confirmation) |
| BoldDesk connector | Stub (all methods throw "Not implemented") |
| Persistence interfaces | Complete |
| PostgreSQL repository implementations | Complete |
| DB schema (mappings, jobs, failed items, audit) | Complete |
| Migration service | Skeleton (entity methods are stubs) |
| Reconciliation service | Skeleton (stub) |
| CLI | Complete (run, reconcile, migrate-ticket) |
| Config / Logger / Errors | Complete |
| Tests | 69 passing (transforms + Zendesk connector/normalizers) |
