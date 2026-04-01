#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "../config";
import { createLogger } from "../logger";
import { getPool, closePool } from "../persistence/pg/pg.client";
import { PgMappingRepository } from "../persistence/pg/pg.mapping.repository";
import { PgJobRepository } from "../persistence/pg/pg.job.repository";
import { PgAuditRepository } from "../persistence/pg/pg.audit.repository";
import { ZendeskConnector } from "../connectors/zendesk/zendesk.connector";
import { BoldDeskConnector } from "../connectors/bolddesk/bolddesk.connector";
import { MigrationService } from "../migration/migration.service";
import { ReconciliationService } from "../reconciliation/reconciliation.service";

const program = new Command();

program
  .name("migrate")
  .description("Zendesk to BoldDesk migration CLI")
  .version("0.1.0");

program
  .command("run")
  .description("Run historical migration")
  .action(async () => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const pool = getPool(config.database.url);

    const service = new MigrationService({
      source: new ZendeskConnector(config.zendesk),
      destination: new BoldDeskConnector(config.bolddesk),
      mappings: new PgMappingRepository(pool),
      jobs: new PgJobRepository(pool),
      audit: new PgAuditRepository(pool),
      logger,
    });

    try {
      const job = await service.runHistoricalMigration();
      logger.info({ jobId: job.id, status: job.status }, "Migration complete");
    } finally {
      await closePool();
    }
  });

program
  .command("reconcile")
  .description("Run reconciliation report for a job")
  .requiredOption("--job-id <id>", "Migration job ID")
  .action(async (opts) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const pool = getPool(config.database.url);

    const reconciler = new ReconciliationService({
      mappings: new PgMappingRepository(pool),
      jobs: new PgJobRepository(pool),
      logger,
    });

    try {
      const results = await reconciler.reconcile(parseInt(opts.jobId, 10));
      const report = await reconciler.generateReport(results);
      console.log(report);
    } finally {
      await closePool();
    }
  });

program
  .command("migrate-ticket")
  .description("Migrate a single ticket by Zendesk ID (for testing)")
  .requiredOption("--ticket-id <id>", "Zendesk ticket ID")
  .action(async (opts) => {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const pool = getPool(config.database.url);

    const service = new MigrationService({
      source: new ZendeskConnector(config.zendesk),
      destination: new BoldDeskConnector(config.bolddesk),
      mappings: new PgMappingRepository(pool),
      jobs: new PgJobRepository(pool),
      audit: new PgAuditRepository(pool),
      logger,
    });

    try {
      await service.migrateTicketById(opts.ticketId);
      logger.info({ ticketId: opts.ticketId }, "Single ticket migration complete");
    } finally {
      await closePool();
    }
  });

program.parse();
