import { SourceConnector } from "../connectors/source.interface";
import {
  DestinationConnector,
  TicketCreationContext,
} from "../connectors/destination.interface";
import { MappingRepository } from "../persistence/mapping.repository";
import { JobRepository } from "../persistence/job.repository";
import { AuditRepository } from "../persistence/audit.repository";
import {
  MigrationJob,
  NormalizedTicket,
  NormalizedComment,
  NormalizedAttachment,
  NormalizedUser,
  NormalizedOrganization,
  MappedEntityType,
} from "../models";
import { MigrationError, MappingNotFoundError } from "../errors";
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
  private userCache = new Map<string, { email: string; name: string }>();

  constructor(private readonly deps: MigrationDependencies) {}

  // -------------------------------------------------------------------------
  // Full historical migration
  // -------------------------------------------------------------------------

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

      job.status = job.failedItems > 0 ? "completed_with_errors" : "completed";
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

  // -------------------------------------------------------------------------
  // Organizations
  // -------------------------------------------------------------------------

  private async migrateOrganizations(job: MigrationJob): Promise<void> {
    const { source, logger } = this.deps;
    let cursor: string | undefined;

    do {
      const page = await source.fetchOrganizations(cursor);
      job.totalItems += page.data.length;

      for (const org of page.data) {
        try {
          await this.migrateOrganization(org);
          job.processedItems++;
        } catch (err) {
          job.failedItems++;
          await this.recordFailure(job, "organization", org.sourceId, err);
          logger.warn(
            { sourceId: org.sourceId, err },
            "Organization migration failed",
          );
        }
      }

      await this.deps.jobs.updateJob(job);
      cursor = page.nextCursor;
    } while (cursor);

    logger.info(
      { processed: job.processedItems, failed: job.failedItems },
      "Organizations migration pass complete",
    );
  }

  private async migrateOrganization(org: NormalizedOrganization): Promise<string> {
    const { destination, mappings } = this.deps;

    const existing = await mappings.findBySource("organization", org.sourceId);
    if (existing) return existing.destinationId;

    let destOrg = await destination.findOrganizationByName(org.name);
    if (!destOrg) {
      destOrg = await destination.createOrganization(org);
    }

    await mappings.save({
      entityType: "organization",
      sourceId: org.sourceId,
      destinationId: destOrg.destinationId,
      createdAt: new Date().toISOString(),
    });

    await this.deps.audit.log({
      entityType: "organization",
      sourceId: org.sourceId,
      action: "migrated",
      detail: { destinationId: destOrg.destinationId },
    });

    return destOrg.destinationId;
  }

  // -------------------------------------------------------------------------
  // Users / Contacts
  // -------------------------------------------------------------------------

  private async migrateUsers(job: MigrationJob): Promise<void> {
    const { source, logger } = this.deps;
    let cursor: string | undefined;

    do {
      const page = await source.fetchUsers(cursor);
      job.totalItems += page.data.length;

      for (const user of page.data) {
        this.userCache.set(user.sourceId, { email: user.email, name: user.name });

        try {
          await this.migrateUser(user);
          job.processedItems++;
        } catch (err) {
          job.failedItems++;
          await this.recordFailure(job, "user", user.sourceId, err);
          logger.warn(
            { sourceId: user.sourceId, err },
            "User migration failed",
          );
        }
      }

      await this.deps.jobs.updateJob(job);
      cursor = page.nextCursor;
    } while (cursor);

    logger.info(
      { cached: this.userCache.size },
      "Users migration pass complete",
    );
  }

  private async migrateUser(user: NormalizedUser): Promise<string> {
    const { destination, mappings } = this.deps;

    const existing = await mappings.findBySource("user", user.sourceId);
    if (existing) return existing.destinationId;

    let destContact = await destination.findContactByEmail(user.email);
    if (!destContact) {
      destContact = await destination.createContact(user);
    }

    await mappings.save({
      entityType: "user",
      sourceId: user.sourceId,
      destinationId: destContact.destinationId,
      createdAt: new Date().toISOString(),
    });

    await this.deps.audit.log({
      entityType: "user",
      sourceId: user.sourceId,
      action: "migrated",
      detail: { destinationId: destContact.destinationId },
    });

    return destContact.destinationId;
  }

  // -------------------------------------------------------------------------
  // Tickets (including comments + attachments)
  // -------------------------------------------------------------------------

  private async migrateTickets(job: MigrationJob): Promise<void> {
    const { source, logger } = this.deps;
    let cursor: string | undefined;

    do {
      const page = await source.fetchTickets(cursor);
      job.totalItems += page.data.length;

      for (const ticketShell of page.data) {
        try {
          await this.migrateTicketFull(ticketShell.sourceId, job);
          job.processedItems++;
        } catch (err) {
          job.failedItems++;
          await this.recordFailure(job, "ticket", ticketShell.sourceId, err);
          logger.warn(
            { sourceId: ticketShell.sourceId, err },
            "Ticket migration failed",
          );
        }
      }

      await this.deps.jobs.updateJob(job);
      cursor = page.nextCursor;
    } while (cursor);

    logger.info("Tickets migration pass complete");
  }

  async migrateTicketById(ticketId: string): Promise<MigrationJob> {
    const { jobs } = this.deps;

    // Single-ticket migrations still need a job so comment/attachment failures
    // are persisted to failed_items and visible to the handoff gate.
    const job = await jobs.createJob({
      name: `single-ticket-${ticketId}`,
      status: "running",
      totalItems: 1,
      processedItems: 0,
      failedItems: 0,
      startedAt: new Date().toISOString(),
      metadata: { ticketSourceId: ticketId },
    });

    try {
      await this.migrateTicketFull(ticketId, job);
      job.processedItems++;
      job.status = job.failedItems > 0 ? "completed_with_errors" : "completed";
    } catch (err) {
      job.failedItems++;
      await this.recordFailure(job, "ticket", ticketId, err);
      job.status = "failed";
    }

    job.completedAt = new Date().toISOString();
    await jobs.updateJob(job);
    return job;
  }

  /**
   * Migrate a ticket and all its comments/attachments.
   * Resumable: if the ticket was already created (mapping exists), still processes
   * comments — each has its own idempotency check.
   */
  private async migrateTicketFull(
    ticketSourceId: string,
    job?: MigrationJob,
  ): Promise<void> {
    const { source, destination, mappings, audit, logger } = this.deps;

    const ticket = await source.fetchTicketById(ticketSourceId);

    let ticketDestId: string;
    const existingMapping = await mappings.findBySource("ticket", ticketSourceId);

    if (existingMapping) {
      ticketDestId = existingMapping.destinationId;
      logger.debug({ ticketSourceId }, "Ticket already created, processing comments");
    } else {
      const context = await this.buildTicketContext(ticket);
      const created = await destination.createTicket(ticket, context);
      ticketDestId = created.destinationId;

      await mappings.save({
        entityType: "ticket",
        sourceId: ticketSourceId,
        destinationId: ticketDestId,
        createdAt: new Date().toISOString(),
      });

      await audit.log({
        jobId: job?.id,
        entityType: "ticket",
        sourceId: ticketSourceId,
        action: "migrated",
        detail: {
          destinationId: ticketDestId,
          commentCount: ticket.comments.length,
        },
      });

      logger.info({ ticketSourceId, ticketDestId }, "Ticket created");
    }

    const commentsToMigrate = ticket.comments.length > 0
      ? ticket.comments.slice(1)
      : [];

    for (const comment of commentsToMigrate) {
      try {
        await this.migrateComment(ticketDestId, comment);
      } catch (err) {
        if (job) {
          job.failedItems++;
          await this.recordFailure(
            job, "comment", comment.sourceId, err,
            { ticketSourceId },
          );
        }
        logger.warn(
          { commentSourceId: comment.sourceId, ticketSourceId, err },
          "Comment migration failed",
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public retry entry points (used by RetryService)
  // -------------------------------------------------------------------------

  async migrateOrganizationById(sourceId: string): Promise<void> {
    const org = await this.deps.source.fetchOrganizationById(sourceId);
    await this.migrateOrganization(org);
  }

  async migrateUserById(sourceId: string): Promise<void> {
    const user = await this.deps.source.fetchUserById(sourceId);
    await this.migrateUser(user);
  }

  async migrateCommentById(
    commentSourceId: string,
    ticketSourceId: string,
  ): Promise<void> {
    const ticketMapping = await this.deps.mappings.findBySource("ticket", ticketSourceId);
    if (!ticketMapping) {
      throw new MappingNotFoundError("ticket", ticketSourceId);
    }

    const ticket = await this.deps.source.fetchTicketById(ticketSourceId);
    const comment = ticket.comments.find((c) => c.sourceId === commentSourceId);
    if (!comment) {
      throw new MigrationError(
        `Comment ${commentSourceId} not found in ticket ${ticketSourceId}`,
        "comment",
        commentSourceId,
      );
    }

    await this.migrateComment(ticketMapping.destinationId, comment);
  }

  // -------------------------------------------------------------------------
  // Internal: ticket context, comments, attachments
  // -------------------------------------------------------------------------

  private async buildTicketContext(
    ticket: NormalizedTicket,
  ): Promise<TicketCreationContext> {
    const requester = await this.resolveUser(ticket.requesterSourceId);

    let contactGroupDestId: string | undefined;
    if (ticket.organizationSourceId) {
      const orgMapping = await this.deps.mappings.findBySource(
        "organization",
        ticket.organizationSourceId,
      );
      if (orgMapping) contactGroupDestId = orgMapping.destinationId;
    }

    let assigneeEmail: string | undefined;
    if (ticket.assigneeSourceId) {
      assigneeEmail = (await this.resolveUser(ticket.assigneeSourceId)).email;
    }

    return {
      requesterEmail: requester.email,
      requesterName: requester.name,
      contactGroupDestId,
      assigneeEmail,
    };
  }

  private async resolveUser(userSourceId: string): Promise<{ email: string; name: string }> {
    const cached = this.userCache.get(userSourceId);
    if (cached) return cached;

    let cursor: string | undefined;
    do {
      const page = await this.deps.source.fetchUsers(cursor);
      for (const u of page.data) {
        this.userCache.set(u.sourceId, { email: u.email, name: u.name });
      }
      cursor = page.nextCursor;
    } while (cursor && !this.userCache.has(userSourceId));

    const resolved = this.userCache.get(userSourceId);
    if (!resolved) {
      throw new MappingNotFoundError("user", userSourceId);
    }
    return resolved;
  }

  private async migrateComment(
    ticketDestId: string,
    comment: NormalizedComment,
  ): Promise<void> {
    const { destination, mappings } = this.deps;

    if (await mappings.exists("comment", comment.sourceId)) return;

    for (const attachment of comment.attachments) {
      await this.migrateAttachment(attachment);
    }

    const created = await destination.addComment(ticketDestId, comment);

    await mappings.save({
      entityType: "comment",
      sourceId: comment.sourceId,
      destinationId: created.destinationId,
      createdAt: new Date().toISOString(),
    });
  }

  private async migrateAttachment(
    attachment: NormalizedAttachment,
  ): Promise<string> {
    const { source, destination, mappings, logger } = this.deps;

    const existing = await mappings.findBySource("attachment", attachment.sourceId);
    if (existing) return existing.destinationId;

    const fileBuffer = await source.downloadAttachment(attachment.sourceUrl);

    const created = await destination.uploadAttachment(attachment, fileBuffer);

    await mappings.save({
      entityType: "attachment",
      sourceId: attachment.sourceId,
      destinationId: created.destinationId,
      createdAt: new Date().toISOString(),
    });

    logger.info(
      { attachmentSourceId: attachment.sourceId, token: created.destinationId },
      "Attachment uploaded",
    );

    return created.destinationId;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async recordFailure(
    job: MigrationJob,
    entityType: string,
    sourceId: string,
    err: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.jobs.addFailedItem({
      jobId: job.id!,
      entityType,
      sourceId,
      error: err instanceof Error ? err.message : String(err),
      retryCount: 0,
      lastAttemptAt: new Date().toISOString(),
      status: "pending",
      metadata: metadata ?? {},
    });
  }
}
