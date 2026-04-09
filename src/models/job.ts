export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

/**
 * Ticket-level migration readiness for pilot handoff.
 *
 * pending  — migration queued/started, ticket not yet created in BoldDesk
 * partial  — ticket exists in BoldDesk but retryable failures remain (comments, attachments)
 * complete — all required data migrated; ticket is eligible for pilot handoff
 * failed   — one or more critical items exhausted retries; handoff blocked until resolved
 */
export type TicketSyncState = "pending" | "partial" | "complete" | "failed";

export interface MigrationJob {
  id?: number;
  name: string;
  status: JobStatus;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

export type FailedItemStatus = "pending" | "resolved" | "exhausted";

export interface FailedItem {
  id?: number;
  jobId: number;
  entityType: string;
  sourceId: string;
  error: string;
  retryCount: number;
  lastAttemptAt: string;
  status?: FailedItemStatus;
  metadata?: Record<string, unknown>;
}
