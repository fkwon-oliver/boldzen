import { Pool } from "pg";
import { AuditRepository, AuditEntry } from "../audit.repository";

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (job_id, entity_type, source_id, action, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.jobId ?? null,
        entry.entityType ?? null,
        entry.sourceId ?? null,
        entry.action,
        entry.detail ? JSON.stringify(entry.detail) : null,
      ],
    );
  }

  async getByJob(jobId: number): Promise<AuditEntry[]> {
    const result = await this.pool.query(
      `SELECT job_id, entity_type, source_id, action, detail
       FROM audit_log WHERE job_id = $1 ORDER BY created_at`,
      [jobId],
    );
    return result.rows.map((row) => ({
      jobId: row.job_id as number,
      entityType: row.entity_type as string,
      sourceId: row.source_id as string,
      action: row.action as string,
      detail: row.detail as Record<string, unknown>,
    }));
  }
}
