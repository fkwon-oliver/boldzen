import { MappingRepository } from "../persistence/mapping.repository";
import { JobRepository } from "../persistence/job.repository";
import { Logger } from "../logger";

export interface ReconciliationResult {
  entityType: string;
  totalSource: number;
  totalMapped: number;
  missing: string[];
  mismatches: string[];
}

export interface ReconciliationDependencies {
  mappings: MappingRepository;
  jobs: JobRepository;
  logger: Logger;
}

export class ReconciliationService {
  constructor(private readonly deps: ReconciliationDependencies) {}

  async reconcile(jobId: number): Promise<ReconciliationResult[]> {
    // TODO: for each entity type, compare source counts vs mapping counts
    // TODO: report missing mappings, mismatches, and failed items
    this.deps.logger.info({ jobId }, "Reconciliation started");
    throw new Error("Not implemented");
  }

  async generateReport(results: ReconciliationResult[]): Promise<string> {
    // TODO: format reconciliation results as readable text/CSV
    throw new Error("Not implemented");
  }
}
