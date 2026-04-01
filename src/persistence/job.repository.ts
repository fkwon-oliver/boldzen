import { MigrationJob, FailedItem } from "../models";

export interface JobRepository {
  createJob(job: MigrationJob): Promise<MigrationJob>;
  updateJob(job: MigrationJob): Promise<void>;
  getJob(id: number): Promise<MigrationJob | null>;

  addFailedItem(item: FailedItem): Promise<void>;
  getFailedItems(jobId: number): Promise<FailedItem[]>;
  getRetryableItems(jobId: number, maxRetries: number): Promise<FailedItem[]>;
}
