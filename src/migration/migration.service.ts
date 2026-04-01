import { SourceConnector } from "../connectors/source.interface";
import { DestinationConnector } from "../connectors/destination.interface";
import { MappingRepository } from "../persistence/mapping.repository";
import { JobRepository } from "../persistence/job.repository";
import { AuditRepository } from "../persistence/audit.repository";
import { MigrationJob } from "../models";
import { Logger } from "../logger";

export interface MigrationDependencies {
  source: SourceConnector;
  destination: DestinationConnector;
  mappings: MappingRepository;
  jobs: JobRepository;
  audit: AuditRepository;
  logger: Logger;
}

export class MigrationService {
  constructor(private readonly deps: MigrationDependencies) {}

  async runHistoricalMigration(): Promise<MigrationJob> {
    const { jobs, audit, logger } = this.deps;

    const job = await jobs.createJob({
      name: "historical-migration",
      status: "running",
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
      startedAt: new Date().toISOString(),
      metadata: {},
    });

    logger.info({ jobId: job.id }, "Historical migration started");
    await audit.log({ jobId: job.id!, action: "migration_started" });

    try {
      await this.migrateOrganizations(job);
      await this.migrateUsers(job);
      await this.migrateTickets(job);

      job.status = "completed";
      job.completedAt = new Date().toISOString();
    } catch (err) {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      logger.error({ jobId: job.id, err }, "Migration failed");
      await audit.log({
        jobId: job.id!,
        action: "migration_failed",
        detail: { error: String(err) },
      });
    }

    await jobs.updateJob(job);
    logger.info({ jobId: job.id, status: job.status }, "Migration finished");
    return job;
  }

  private async migrateOrganizations(_job: MigrationJob): Promise<void> {
    // TODO: paginate through source.fetchOrganizations
    // For each org: check mapping exists (idempotent), transform, create in dest, persist mapping
    throw new Error("Not implemented");
  }

  private async migrateUsers(_job: MigrationJob): Promise<void> {
    // TODO: paginate through source.fetchUsers
    // For each user: check mapping, transform, create contact in dest, persist mapping
    throw new Error("Not implemented");
  }

  private async migrateTickets(_job: MigrationJob): Promise<void> {
    // TODO: paginate through source.fetchTickets
    // For each ticket: resolve user/org mappings, create ticket shell, add comments chronologically, handle attachments
    throw new Error("Not implemented");
  }

  async migrateTicketById(_ticketId: string): Promise<void> {
    // TODO: single-ticket migration for testing / retries
    throw new Error("Not implemented");
  }
}
