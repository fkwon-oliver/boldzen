export interface AuditEntry {
  jobId?: number;
  entityType?: string;
  sourceId?: string;
  action: string;
  detail?: Record<string, unknown>;
}

export interface AuditRepository {
  log(entry: AuditEntry): Promise<void>;
  getByJob(jobId: number): Promise<AuditEntry[]>;
}
