import { MigrationService } from "../migration/migration.service";
import { MappingRepository } from "../persistence/mapping.repository";
import { JobRepository } from "../persistence/job.repository";
import { AuditRepository } from "../persistence/audit.repository";
import { FailedItem, TicketSyncState } from "../models";
import { isTransientError, MigrationError } from "../errors";
import { Logger } from "../logger";
import { deriveTicketSyncState } from "../pilot/sync-state";

// ---------------------------------------------------------------------------
// Config + result types
// ---------------------------------------------------------------------------

export interface RetryConfig {
  maxRetries: number;
  backoffBaseMs: number;
}

export interface RetryEntitySummary {
  attempted: number;
  resolved: number;
  exhausted: number;
  stillFailing: number;
}

export interface RetryResult {
  jobId: number;
  totalAttempted: number;
  resolved: number;
  exhausted: number;
  stillFailing: number;
  byEntityType: Record<string, RetryEntitySummary>;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface RetryDependencies {
  migration: MigrationService;
  mappings: MappingRepository;
  jobs: JobRepository;
  audit: AuditRepository;
  logger: Logger;
  config: RetryConfig;
}

// ---------------------------------------------------------------------------
// Retry entity-type ordering — respects migration dependency chain
// ---------------------------------------------------------------------------

const ENTITY_ORDER = ["organization", "user", "ticket", "comment"];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RetryService {
  constructor(private readonly deps: RetryDependencies) {}

  async retryFailedItems(jobId: number): Promise<RetryResult> {
    const { jobs, audit, logger, config } = this.deps;

    const job = await jobs.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const items = await jobs.getRetryableItems(jobId, config.maxRetries);
    if (items.length === 0) {
      logger.info({ jobId }, "No retryable items found");
      return this.emptyResult(jobId);
    }

    logger.info({ jobId, count: items.length }, "Retry pass starting");
    await audit.log({
      jobId,
      action: "retry_started",
      detail: { itemCount: items.length },
    });

    // Track per-ticket sync-state snapshots so we can detect transitions
    const ticketSyncBefore = new Map<string, TicketSyncState>();
    const affectedTicketIds = this.collectAffectedTicketIds(items);
    for (const ticketId of affectedTicketIds) {
      ticketSyncBefore.set(ticketId, await this.computeTicketSyncState(ticketId));
    }

    const grouped = this.groupByEntityType(items);
    const result = this.emptyResult(jobId);

    for (const entityType of ENTITY_ORDER) {
      const entityItems = grouped.get(entityType);
      if (!entityItems || entityItems.length === 0) continue;

      const summary: RetryEntitySummary = {
        attempted: 0, resolved: 0, exhausted: 0, stillFailing: 0,
      };

      for (const item of entityItems) {
        summary.attempted++;
        result.totalAttempted++;

        try {
          await this.retryItem(item);
          await jobs.updateFailedItemStatus(item.id!, "resolved");

          summary.resolved++;
          result.resolved++;
          logger.info(
            { entityType, sourceId: item.sourceId },
            "Retry succeeded",
          );
        } catch (err) {
          const newCount = item.retryCount + 1;
          const isExhausted =
            newCount >= config.maxRetries || !isTransientError(err);

          await jobs.updateFailedItem({
            ...item,
            retryCount: newCount,
            lastAttemptAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
            status: isExhausted ? "exhausted" : "pending",
          });

          if (isExhausted) {
            summary.exhausted++;
            result.exhausted++;
            logger.warn(
              { entityType, sourceId: item.sourceId, retryCount: newCount },
              "Retry exhausted — moved to dead letter",
            );
          } else {
            summary.stillFailing++;
            result.stillFailing++;
            logger.warn(
              { entityType, sourceId: item.sourceId, retryCount: newCount },
              "Retry failed, eligible for another attempt",
            );
          }
        }

        // Throttle between items
        if (config.backoffBaseMs > 0) {
          await this.sleep(config.backoffBaseMs);
        }
      }

      result.byEntityType[entityType] = summary;
    }

    // Log sync-state transitions for affected tickets
    for (const ticketId of affectedTicketIds) {
      const before = ticketSyncBefore.get(ticketId)!;
      const after = await this.computeTicketSyncState(ticketId);
      if (before !== after) {
        logger.info(
          { ticketId, before, after },
          "Ticket sync state changed after retry pass",
        );
        await audit.log({
          jobId,
          entityType: "ticket",
          sourceId: ticketId,
          action: "sync_state_transition",
          detail: { from: before, to: after },
        });
      }
    }

    await audit.log({
      jobId,
      action: "retry_completed",
      detail: {
        totalAttempted: result.totalAttempted,
        resolved: result.resolved,
        exhausted: result.exhausted,
        stillFailing: result.stillFailing,
      },
    });

    logger.info(result, "Retry pass complete");
    return result;
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  private async retryItem(item: FailedItem): Promise<void> {
    const { migration } = this.deps;

    switch (item.entityType) {
      case "organization":
        return migration.migrateOrganizationById(item.sourceId);

      case "user":
        return migration.migrateUserById(item.sourceId);

      case "ticket":
        await migration.migrateTicketById(item.sourceId);
        return;

      case "comment": {
        const ticketSourceId = item.metadata?.ticketSourceId as string | undefined;
        if (!ticketSourceId) {
          throw new MigrationError(
            `Missing ticketSourceId in metadata for comment ${item.sourceId}`,
            "comment",
            item.sourceId,
          );
        }
        return migration.migrateCommentById(item.sourceId, ticketSourceId);
      }

      default:
        throw new Error(`Unknown entity type for retry: ${item.entityType}`);
    }
  }

  // -------------------------------------------------------------------------
  // Sync-state helpers
  // -------------------------------------------------------------------------

  private collectAffectedTicketIds(items: FailedItem[]): Set<string> {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.entityType === "ticket") {
        ids.add(item.sourceId);
      } else if (item.metadata?.ticketSourceId) {
        ids.add(item.metadata.ticketSourceId as string);
      }
    }
    return ids;
  }

  async computeTicketSyncState(ticketSourceId: string): Promise<TicketSyncState> {
    const { mappings, jobs } = this.deps;
    const hasMapping = await mappings.exists("ticket", ticketSourceId);
    const failedItems = await jobs.getFailedItemsForTicket(ticketSourceId);
    return deriveTicketSyncState({ hasTicketMapping: hasMapping, failedItems });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private groupByEntityType(items: FailedItem[]): Map<string, FailedItem[]> {
    const map = new Map<string, FailedItem[]>();
    for (const item of items) {
      const list = map.get(item.entityType) ?? [];
      list.push(item);
      map.set(item.entityType, list);
    }
    return map;
  }

  private emptyResult(jobId: number): RetryResult {
    return {
      jobId,
      totalAttempted: 0,
      resolved: 0,
      exhausted: 0,
      stillFailing: 0,
      byEntityType: {},
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
