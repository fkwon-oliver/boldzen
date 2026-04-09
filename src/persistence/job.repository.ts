import { MigrationJob, FailedItem, FailedItemStatus } from "../models";

export interface JobRepository {
  createJob(job: MigrationJob): Promise<MigrationJob>;
  updateJob(job: MigrationJob): Promise<void>;
  getJob(id: number): Promise<MigrationJob | null>;

  addFailedItem(item: FailedItem): Promise<void>;
  updateFailedItem(item: FailedItem): Promise<void>;
  updateFailedItemStatus(id: number, status: FailedItemStatus): Promise<void>;
  getFailedItems(jobId: number): Promise<FailedItem[]>;
  getRetryableItems(jobId: number, maxRetries: number): Promise<FailedItem[]>;

  /**
   * Return all failed items related to a specific ticket (across all jobs):
   *   - entity_type='ticket' with matching source_id
   *   - entity_type='comment' or 'attachment' with metadata.ticketSourceId matching
   */
  getFailedItemsForTicket(ticketSourceId: string): Promise<FailedItem[]>;
}
