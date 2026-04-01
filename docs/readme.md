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

## Suggested Structure

```text
docs/
src/
tests/
