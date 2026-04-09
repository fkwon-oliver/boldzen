import { Pool } from "pg";
import { JobRepository } from "../job.repository";
import { MigrationJob, FailedItem, FailedItemStatus } from "../../models";

export class PgJobRepository implements JobRepository {
  constructor(private readonly pool: Pool) {}

  async createJob(job: MigrationJob): Promise<MigrationJob> {
    const result = await this.pool.query(
      `INSERT INTO migration_jobs (name, status, total_items, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, started_at`,
      [job.name, job.status, job.totalItems, JSON.stringify(job.metadata)],
    );
    return { ...job, id: result.rows[0].id };
  }

  async updateJob(job: MigrationJob): Promise<void> {
    await this.pool.query(
      `UPDATE migration_jobs
       SET status = $2, processed_items = $3, failed_items = $4,
           started_at = $5, completed_at = $6, metadata = $7
       WHERE id = $1`,
      [
        job.id,
        job.status,
        job.processedItems,
        job.failedItems,
        job.startedAt,
        job.completedAt,
        JSON.stringify(job.metadata),
      ],
    );
  }

  async getJob(id: number): Promise<MigrationJob | null> {
    const result = await this.pool.query(
      `SELECT * FROM migration_jobs WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return this.toJob(result.rows[0]);
  }

  async addFailedItem(item: FailedItem): Promise<void> {
    await this.pool.query(
      `INSERT INTO failed_items (job_id, entity_type, source_id, error, retry_count, last_attempt_at, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (job_id, entity_type, source_id)
       DO UPDATE SET error = EXCLUDED.error,
                     retry_count = EXCLUDED.retry_count,
                     last_attempt_at = EXCLUDED.last_attempt_at,
                     status = EXCLUDED.status,
                     metadata = EXCLUDED.metadata`,
      [
        item.jobId,
        item.entityType,
        item.sourceId,
        item.error,
        item.retryCount,
        item.lastAttemptAt,
        item.status ?? "pending",
        JSON.stringify(item.metadata ?? {}),
      ],
    );
  }

  async updateFailedItem(item: FailedItem): Promise<void> {
    await this.pool.query(
      `UPDATE failed_items
       SET error = $2, retry_count = $3, last_attempt_at = $4, status = $5, metadata = $6
       WHERE id = $1`,
      [
        item.id,
        item.error,
        item.retryCount,
        item.lastAttemptAt,
        item.status ?? "pending",
        JSON.stringify(item.metadata ?? {}),
      ],
    );
  }

  async updateFailedItemStatus(id: number, status: FailedItemStatus): Promise<void> {
    await this.pool.query(
      `UPDATE failed_items SET status = $2 WHERE id = $1`,
      [id, status],
    );
  }

  async getFailedItems(jobId: number): Promise<FailedItem[]> {
    const result = await this.pool.query(
      `SELECT * FROM failed_items WHERE job_id = $1 ORDER BY id`,
      [jobId],
    );
    return result.rows.map(this.toFailedItem);
  }

  async getRetryableItems(jobId: number, maxRetries: number): Promise<FailedItem[]> {
    const result = await this.pool.query(
      `SELECT * FROM failed_items
       WHERE job_id = $1 AND status = 'pending' AND retry_count < $2
       ORDER BY id`,
      [jobId, maxRetries],
    );
    return result.rows.map(this.toFailedItem);
  }

  async getFailedItemsForTicket(ticketSourceId: string): Promise<FailedItem[]> {
    const result = await this.pool.query(
      `SELECT * FROM failed_items
       WHERE (entity_type = 'ticket' AND source_id = $1)
          OR (metadata->>'ticketSourceId' = $1)
       ORDER BY id`,
      [ticketSourceId],
    );
    return result.rows.map(this.toFailedItem);
  }

  private toJob(row: Record<string, unknown>): MigrationJob {
    return {
      id: row.id as number,
      name: row.name as string,
      status: row.status as MigrationJob["status"],
      totalItems: row.total_items as number,
      processedItems: row.processed_items as number,
      failedItems: row.failed_items as number,
      startedAt: row.started_at ? (row.started_at as Date).toISOString() : undefined,
      completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  }

  private toFailedItem(row: Record<string, unknown>): FailedItem {
    return {
      id: row.id as number,
      jobId: row.job_id as number,
      entityType: row.entity_type as string,
      sourceId: row.source_id as string,
      error: row.error as string,
      retryCount: row.retry_count as number,
      lastAttemptAt: (row.last_attempt_at as Date).toISOString(),
      status: (row.status as FailedItemStatus) ?? "pending",
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  }
}
