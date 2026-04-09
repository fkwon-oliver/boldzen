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
import { RetryService } from "../retry/retry.service";
import { PilotOwnershipService } from "../pilot/pilot.service";

function buildServices(config: ReturnType<typeof loadConfig>) {
  const logger = createLogger(config.logLevel);
  const pool = getPool(config.database.url);
  const source = new ZendeskConnector(config.zendesk);
  const destination = new BoldDeskConnector(config.bolddesk);
  const mappings = new PgMappingRepository(pool);
  const jobs = new PgJobRepository(pool);
  const audit = new PgAuditRepository(pool);

  const migration = new MigrationService({
    source, destination, mappings, jobs, audit, logger,
  });

  const retry = new RetryService({
    migration, mappings, jobs, audit, logger, config: config.retry,
  });

  const reconciliation = new ReconciliationService({
    source, mappings, jobs, logger,
  });

  const pilot = new PilotOwnershipService(
    source, mappings, jobs, audit, migration, config.pilot, logger,
  );

  return { logger, migration, retry, reconciliation, pilot };
}

const program = new Command();

program
  .name("migrate")
  .description("Zendesk to BoldDesk migration CLI")
  .version("0.1.0");

program
  .command("run")
  .description("Run historical migration (idempotent — safe to re-run)")
  .action(async () => {
    const config = loadConfig();
    const { logger, migration } = buildServices(config);

    try {
      const job = await migration.runHistoricalMigration();
      logger.info({ jobId: job.id, status: job.status }, "Migration complete");
    } finally {
      await closePool();
    }
  });

program
  .command("retry")
  .description("Retry failed items from a previous migration job")
  .requiredOption("--job-id <id>", "Migration job ID to retry")
  .action(async (opts) => {
    const config = loadConfig();
    const { logger, retry } = buildServices(config);

    try {
      const result = await retry.retryFailedItems(parseInt(opts.jobId, 10));

      console.log("\n── RETRY SUMMARY ──");
      console.log(`Job:           #${result.jobId}`);
      console.log(`Attempted:     ${result.totalAttempted}`);
      console.log(`Resolved:      ${result.resolved}`);
      console.log(`Still failing: ${result.stillFailing}`);
      console.log(`Exhausted:     ${result.exhausted}`);

      for (const [type, s] of Object.entries(result.byEntityType)) {
        console.log(`  ${type}: ${s.resolved}/${s.attempted} resolved, ${s.exhausted} exhausted`);
      }

      if (result.stillFailing > 0) {
        console.log(`\nRe-run "retry --job-id ${opts.jobId}" to attempt remaining items.`);
      }
      if (result.exhausted > 0) {
        console.log(`\n${result.exhausted} item(s) exhausted max retries — check dead-letter items with "reconcile --job-id ${opts.jobId}".`);
      }
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
    const { reconciliation } = buildServices(config);

    try {
      const result = await reconciliation.reconcile(parseInt(opts.jobId, 10));
      const report = await reconciliation.generateReport(result);
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
    const { logger, migration } = buildServices(config);
    const pool = getPool(config.database.url);
    const jobs = new PgJobRepository(pool);

    try {
      const job = await migration.migrateTicketById(opts.ticketId);

      console.log("\n── MIGRATE TICKET ──");
      console.log(`Zendesk ticket: #${opts.ticketId}`);
      console.log(`Job:            #${job.id}`);
      console.log(`Status:         ${job.status}`);
      console.log(`Processed:      ${job.processedItems}`);
      console.log(`Failed:         ${job.failedItems}`);

      if (job.failedItems > 0) {
        const failedItems = await jobs.getFailedItems(job.id!);
        console.log("\nFailed items:");
        for (const item of failedItems) {
          console.log(`  [${item.entityType}] ${item.sourceId}: ${item.error}`);
        }
      }

      if (job.status === "failed") {
        process.exitCode = 1;
      }
    } finally {
      await closePool();
    }
  });

program
  .command("pilot-handoff")
  .description("Hand off a ticket to BoldDesk ownership (sets Zendesk fields + tags)")
  .requiredOption("--ticket-id <id>", "Zendesk ticket ID")
  .action(async (opts) => {
    const config = loadConfig();
    const { logger, pilot } = buildServices(config);

    try {
      const result = await pilot.handoff(opts.ticketId);

      console.log("\n── PILOT HANDOFF ──");
      console.log(`Zendesk ticket: #${result.ticketSourceId}`);
      console.log(`BoldDesk ticket: #${result.ticketDestId || "(none)"}`);
      console.log(`Status:          ${result.status}`);
      if (result.syncState) console.log(`Sync state:      ${result.syncState}`);
      if (result.blockedReasons?.length) {
        console.log("Blocked reasons:");
        for (const r of result.blockedReasons) console.log(`  - ${r}`);
      }
      if (result.error) console.log(`Error:           ${result.error}`);
    } finally {
      await closePool();
    }
  });

program
  .command("pilot-rollback")
  .description("Return a ticket from BoldDesk ownership back to Zendesk")
  .requiredOption("--ticket-id <id>", "Zendesk ticket ID")
  .action(async (opts) => {
    const config = loadConfig();
    const { logger, pilot } = buildServices(config);

    try {
      const result = await pilot.rollback(opts.ticketId);

      console.log("\n── PILOT ROLLBACK ──");
      console.log(`Zendesk ticket: #${result.ticketSourceId}`);
      console.log(`Status:          ${result.status}`);
      if (result.error) console.log(`Error:           ${result.error}`);
    } finally {
      await closePool();
    }
  });

program
  .command("pilot-status")
  .description("Check pilot ownership status of a ticket")
  .requiredOption("--ticket-id <id>", "Zendesk ticket ID")
  .action(async (opts) => {
    const config = loadConfig();
    const { pilot } = buildServices(config);

    try {
      const result = await pilot.status(opts.ticketId);

      console.log("\n── PILOT STATUS ──");
      console.log(`Zendesk ticket:      #${result.ticketSourceId}`);
      console.log(`Owner system:        ${result.ownerSystem}`);
      console.log(`Derived sync state:  ${result.derivedSyncState}`);
      console.log(`Zendesk sync field:  ${result.zendeskSyncField}`);
      console.log(`BoldDesk ticket:     ${result.bolddeskTicketId ?? "(none)"}`);
      console.log(`Migration mapping:   ${result.hasMigrationMapping ? "yes" : "no"}`);
      console.log(`Unresolved failures: ${result.unresolvedFailedItems}`);
    } finally {
      await closePool();
    }
  });

program.parse();
