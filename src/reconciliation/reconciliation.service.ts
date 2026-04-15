import { SourceConnector } from "../connectors/source.interface";
import { MappingRepository } from "../persistence/mapping.repository";
import { JobRepository } from "../persistence/job.repository";
import {
  MappedEntityType,
  NormalizedTicket,
  FailedItem,
} from "../models";
import { Logger } from "../logger";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ReconciliationStatus =
  | "matched"
  | "matched_with_exceptions"
  | "partial"
  | "failed";

export interface EntityReconciliationResult {
  entityType: MappedEntityType;
  totalSource: number;
  totalMapped: number;
  missingSourceIds: string[];
}

export interface Discrepancy {
  category: string;
  ticketSourceId: string;
  sourceId?: string;
  detail: string;
}

export interface TicketReconciliationDetail {
  ticketSourceId: string;
  status: ReconciliationStatus;
  expectedComments: number;
  mappedComments: number;
  expectedAttachments: number;
  mappedAttachments: number;
  discrepancies: Discrepancy[];
}

export interface BatchReconciliationResult {
  jobId: number;
  jobStatus: string;
  startedAt?: string;
  completedAt?: string;
  entityResults: EntityReconciliationResult[];
  ticketDetails: TicketReconciliationDetail[];
  failedItems: FailedItem[];
  overallStatus: ReconciliationStatus;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReconciliationDependencies {
  source: SourceConnector;
  mappings: MappingRepository;
  jobs: JobRepository;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationDependencies) {}

  async reconcile(jobId: number): Promise<BatchReconciliationResult> {
    const { jobs, logger } = this.deps;

    logger.info({ jobId }, "Reconciliation started");

    const job = await jobs.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const failedItems = await jobs.getFailedItems(jobId);

    const entityResults = await this.reconcileEntities();
    const ticketDetails = await this.reconcileTickets();

    const overallStatus = this.computeOverallStatus(
      entityResults,
      ticketDetails,
      failedItems,
    );

    const result: BatchReconciliationResult = {
      jobId,
      jobStatus: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      entityResults,
      ticketDetails,
      failedItems,
      overallStatus,
    };

    logger.info(
      { jobId, overallStatus, entityTypes: entityResults.length },
      "Reconciliation complete",
    );

    return result;
  }

  // -----------------------------------------------------------------------
  // Batch-level: entity counts
  // -----------------------------------------------------------------------

  private async reconcileEntities(): Promise<EntityReconciliationResult[]> {
    const types: MappedEntityType[] = [
      "organization",
      "user",
      "ticket",
    ];

    const results: EntityReconciliationResult[] = [];

    for (const entityType of types) {
      const sourceIds = await this.collectSourceIds(entityType);
      const mappings = await this.deps.mappings.findAllByType(entityType);
      const mappedSourceIds = new Set(mappings.map((m) => m.sourceId));

      const missingSourceIds = sourceIds.filter(
        (id) => !mappedSourceIds.has(id),
      );

      results.push({
        entityType,
        totalSource: sourceIds.length,
        totalMapped: mappings.length,
        missingSourceIds,
      });
    }

    return results;
  }

  private async collectSourceIds(
    entityType: MappedEntityType,
  ): Promise<string[]> {
    const { source } = this.deps;
    const ids: string[] = [];
    let cursor: string | undefined;

    switch (entityType) {
      case "organization":
        do {
          const page = await source.fetchOrganizations(cursor);
          ids.push(...page.data.map((o) => o.sourceId));
          cursor = page.nextCursor;
        } while (cursor);
        break;

      case "user":
        do {
          const page = await source.fetchUsers(cursor);
          ids.push(...page.data.map((u) => u.sourceId));
          cursor = page.nextCursor;
        } while (cursor);
        break;

      case "ticket":
        do {
          const page = await source.fetchTickets(cursor);
          ids.push(...page.data.map((t) => t.sourceId));
          cursor = page.nextCursor;
        } while (cursor);
        break;
    }

    return ids;
  }

  // -----------------------------------------------------------------------
  // Ticket-level: comment / attachment fidelity
  // -----------------------------------------------------------------------

  private async reconcileTickets(): Promise<TicketReconciliationDetail[]> {
    const { source, mappings, logger } = this.deps;

    const ticketMappings = await mappings.findAllByType("ticket");
    const commentMappings = await mappings.findAllByType("comment");
    const attachmentMappings = await mappings.findAllByType("attachment");

    const commentMappedIds = new Set(commentMappings.map((m) => m.sourceId));
    const attachmentMappedIds = new Set(
      attachmentMappings.map((m) => m.sourceId),
    );

    const details: TicketReconciliationDetail[] = [];

    for (const tm of ticketMappings) {
      let ticket: NormalizedTicket;
      try {
        ticket = await source.fetchTicketById(tm.sourceId);
      } catch (err) {
        details.push({
          ticketSourceId: tm.sourceId,
          status: "failed",
          expectedComments: -1,
          mappedComments: 0,
          expectedAttachments: -1,
          mappedAttachments: 0,
          discrepancies: [
            {
              category: "api_error",
              ticketSourceId: tm.sourceId,
              detail: `Failed to re-fetch ticket from source: ${err}`,
            },
          ],
        });
        continue;
      }

      const discrepancies: Discrepancy[] = [];

      const expectedComments = ticket.comments.length;
      const mappedComments = ticket.comments.filter((c) =>
        commentMappedIds.has(c.sourceId),
      ).length;

      if (mappedComments < expectedComments) {
        const missing = ticket.comments
          .filter((c) => !commentMappedIds.has(c.sourceId))
          .map((c) => c.sourceId);

        const publicMissing = ticket.comments.filter(
          (c) => !commentMappedIds.has(c.sourceId) && c.isPublic,
        ).length;
        const privateMissing = ticket.comments.filter(
          (c) => !commentMappedIds.has(c.sourceId) && !c.isPublic,
        ).length;

        if (publicMissing > 0) {
          discrepancies.push({
            category: "comment_count_mismatch",
            ticketSourceId: tm.sourceId,
            detail: `${publicMissing} public comment(s) not mapped: ${missing.join(", ")}`,
          });
        }
        if (privateMissing > 0) {
          discrepancies.push({
            category: "internal_note_count_mismatch",
            ticketSourceId: tm.sourceId,
            detail: `${privateMissing} internal note(s) not mapped`,
          });
        }
      }

      const allAttachments = ticket.comments.flatMap((c) => c.attachments);
      const expectedAttachments = allAttachments.length;
      const mappedAttachments = allAttachments.filter((a) =>
        attachmentMappedIds.has(a.sourceId),
      ).length;

      if (mappedAttachments < expectedAttachments) {
        const missingAtt = allAttachments
          .filter((a) => !attachmentMappedIds.has(a.sourceId))
          .map((a) => a.sourceId);

        discrepancies.push({
          category: "attachment_count_mismatch",
          ticketSourceId: tm.sourceId,
          detail: `${expectedAttachments - mappedAttachments} attachment(s) not mapped: ${missingAtt.join(", ")}`,
        });
      }

      let status: ReconciliationStatus;
      if (discrepancies.length === 0) {
        status = "matched";
      } else if (mappedComments > 0 || mappedAttachments > 0) {
        status = mappedComments === 0 && mappedAttachments === 0
          ? "failed"
          : "partial";
      } else {
        status = "failed";
      }

      details.push({
        ticketSourceId: tm.sourceId,
        status,
        expectedComments,
        mappedComments,
        expectedAttachments,
        mappedAttachments,
        discrepancies,
      });
    }

    return details;
  }

  // -----------------------------------------------------------------------
  // Overall status
  // -----------------------------------------------------------------------

  private computeOverallStatus(
    entityResults: EntityReconciliationResult[],
    ticketDetails: TicketReconciliationDetail[],
    failedItems: FailedItem[],
  ): ReconciliationStatus {
    const hasMissingEntities = entityResults.some(
      (r) => r.missingSourceIds.length > 0,
    );
    const hasTicketIssues = ticketDetails.some((t) => t.status !== "matched");
    const hasFailedItems = failedItems.length > 0;

    if (!hasMissingEntities && !hasTicketIssues && !hasFailedItems) {
      return "matched";
    }

    const allTicketsFailed =
      ticketDetails.length > 0 &&
      ticketDetails.every((t) => t.status === "failed");
    const allEntitiesMissing = entityResults.every(
      (r) =>
        r.totalSource > 0 && r.missingSourceIds.length === r.totalSource,
    );

    if (allTicketsFailed || allEntitiesMissing) {
      return "failed";
    }

    if (hasTicketIssues || hasFailedItems) {
      return "partial";
    }

    return "matched_with_exceptions";
  }

  // -----------------------------------------------------------------------
  // Report generation
  // -----------------------------------------------------------------------

  async generateReport(result: BatchReconciliationResult): Promise<string> {
    const lines: string[] = [];
    const hr = "─".repeat(60);

    lines.push(hr);
    lines.push(`RECONCILIATION REPORT — Job #${result.jobId}`);
    lines.push(hr);
    lines.push(`Status:     ${result.overallStatus.toUpperCase()}`);
    lines.push(`Job Status: ${result.jobStatus}`);
    if (result.startedAt) lines.push(`Started:    ${result.startedAt}`);
    if (result.completedAt) lines.push(`Completed:  ${result.completedAt}`);
    lines.push("");

    // Entity counts
    lines.push("ENTITY COUNTS");
    lines.push(hr);
    for (const er of result.entityResults) {
      const gap = er.totalSource - er.totalMapped;
      const marker = gap > 0 ? ` ⚠ ${gap} missing` : " ✓";
      lines.push(
        `  ${er.entityType.padEnd(15)} source: ${String(er.totalSource).padStart(6)}  mapped: ${String(er.totalMapped).padStart(6)}${marker}`,
      );
    }
    lines.push("");

    // Failed items
    if (result.failedItems.length > 0) {
      lines.push(`FAILED ITEMS (${result.failedItems.length})`);
      lines.push(hr);
      const grouped = this.groupBy(result.failedItems, (f) => f.entityType);
      for (const [type, items] of Object.entries(grouped)) {
        lines.push(`  ${type}: ${items.length}`);
        for (const item of items.slice(0, 10)) {
          lines.push(`    - ${item.sourceId}: ${item.error}`);
        }
        if (items.length > 10) {
          lines.push(`    ... and ${items.length - 10} more`);
        }
      }
      lines.push("");
    }

    // Ticket-level detail
    const problemTickets = result.ticketDetails.filter(
      (t) => t.status !== "matched",
    );
    if (problemTickets.length > 0) {
      lines.push(
        `TICKET DISCREPANCIES (${problemTickets.length} of ${result.ticketDetails.length} tickets)`,
      );
      lines.push(hr);
      for (const td of problemTickets) {
        lines.push(
          `  Ticket ${td.ticketSourceId} [${td.status}]  comments: ${td.mappedComments}/${td.expectedComments}  attachments: ${td.mappedAttachments}/${td.expectedAttachments}`,
        );
        for (const d of td.discrepancies) {
          lines.push(`    [${d.category}] ${d.detail}`);
        }
      }
      lines.push("");
    }

    // Summary
    const matched = result.ticketDetails.filter(
      (t) => t.status === "matched",
    ).length;
    const partial = result.ticketDetails.filter(
      (t) => t.status === "partial",
    ).length;
    const failed = result.ticketDetails.filter(
      (t) => t.status === "failed",
    ).length;

    lines.push("TICKET SUMMARY");
    lines.push(hr);
    lines.push(`  Total:   ${result.ticketDetails.length}`);
    lines.push(`  Matched: ${matched}`);
    lines.push(`  Partial: ${partial}`);
    lines.push(`  Failed:  ${failed}`);
    lines.push(hr);

    return lines.join("\n");
  }

  private groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
    const result: Record<string, T[]> = {};
    for (const item of items) {
      const key = keyFn(item);
      (result[key] ??= []).push(item);
    }
    return result;
  }
}
