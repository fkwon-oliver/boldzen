export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

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

export interface FailedItem {
  id?: number;
  jobId: number;
  entityType: string;
  sourceId: string;
  error: string;
  retryCount: number;
  lastAttemptAt: string;
}
