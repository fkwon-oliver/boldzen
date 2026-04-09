import { RetryService, RetryDependencies, RetryConfig } from "@/retry/retry.service";
import { MigrationService } from "@/migration/migration.service";
import { MappingRepository } from "@/persistence/mapping.repository";
import { JobRepository } from "@/persistence/job.repository";
import { AuditRepository } from "@/persistence/audit.repository";
import { FailedItem, MigrationJob, FailedItemStatus } from "@/models";
import { ConnectorError, MappingNotFoundError } from "@/errors";

// ── Factories ──────────────────────────────────────────────

function makeFailedItem(overrides: Partial<FailedItem> = {}): FailedItem {
  return {
    id: 1,
    jobId: 100,
    entityType: "ticket",
    sourceId: "t1",
    error: "API error",
    retryCount: 0,
    lastAttemptAt: "2024-01-01T00:00:00Z",
    status: "pending",
    metadata: {},
    ...overrides,
  };
}

function makeJob(overrides: Partial<MigrationJob> = {}): MigrationJob {
  return {
    id: 100,
    name: "historical-migration",
    status: "completed_with_errors",
    totalItems: 10,
    processedItems: 9,
    failedItems: 1,
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: "2024-01-01T01:00:00Z",
    metadata: {},
    ...overrides,
  };
}

// ── Mock builders ──────────────────────────────────────────

function mockMigration(): jest.Mocked<
  Pick<MigrationService, "migrateOrganizationById" | "migrateUserById" | "migrateTicketById" | "migrateCommentById">
> {
  return {
    migrateOrganizationById: jest.fn(),
    migrateUserById: jest.fn(),
    migrateTicketById: jest.fn(),
    migrateCommentById: jest.fn(),
  };
}

function mockJobs(): jest.Mocked<JobRepository> {
  return {
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getJob: jest.fn().mockResolvedValue(makeJob()),
    addFailedItem: jest.fn(),
    updateFailedItem: jest.fn(),
    updateFailedItemStatus: jest.fn(),
    getFailedItems: jest.fn().mockResolvedValue([]),
    getRetryableItems: jest.fn().mockResolvedValue([]),
    getFailedItemsForTicket: jest.fn().mockResolvedValue([]),
  };
}

function mockMappings(): jest.Mocked<MappingRepository> {
  return {
    save: jest.fn(),
    findBySource: jest.fn().mockResolvedValue(null),
    findAllByType: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(true),
  };
}

function mockAudit(): jest.Mocked<AuditRepository> {
  return {
    log: jest.fn(),
    getByJob: jest.fn().mockResolvedValue([]),
  };
}

function mockLogger(): any {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoffBaseMs: 0, // no delay in tests
};

function buildDeps(overrides: Partial<RetryDependencies> = {}): RetryDependencies {
  return {
    migration: mockMigration() as unknown as MigrationService,
    mappings: mockMappings(),
    jobs: mockJobs(),
    audit: mockAudit(),
    logger: mockLogger(),
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe("RetryService", () => {
  describe("retryFailedItems", () => {
    it("returns empty result when no retryable items exist", async () => {
      const deps = buildDeps();
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.totalAttempted).toBe(0);
      expect(result.resolved).toBe(0);
    });

    it("throws when job does not exist", async () => {
      const jobs = mockJobs();
      jobs.getJob.mockResolvedValue(null);
      const deps = buildDeps({ jobs });
      const svc = new RetryService(deps);

      await expect(svc.retryFailedItems(999)).rejects.toThrow("Job 999 not found");
    });

    it("retries a failed ticket and marks it resolved on success", async () => {
      const item = makeFailedItem({ entityType: "ticket", sourceId: "t1" });
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateTicketById.mockResolvedValue(makeJob());

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.totalAttempted).toBe(1);
      expect(result.resolved).toBe(1);
      expect(result.exhausted).toBe(0);
      expect(migration.migrateTicketById).toHaveBeenCalledWith("t1");
      expect(jobs.updateFailedItemStatus).toHaveBeenCalledWith(1, "resolved");
    });

    it("retries a failed organization", async () => {
      const item = makeFailedItem({ id: 2, entityType: "organization", sourceId: "o5" });
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateOrganizationById.mockResolvedValue(undefined);

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.resolved).toBe(1);
      expect(migration.migrateOrganizationById).toHaveBeenCalledWith("o5");
    });

    it("retries a failed user", async () => {
      const item = makeFailedItem({ id: 3, entityType: "user", sourceId: "u7" });
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateUserById.mockResolvedValue(undefined);

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.resolved).toBe(1);
      expect(migration.migrateUserById).toHaveBeenCalledWith("u7");
    });

    it("retries a failed comment using ticketSourceId from metadata", async () => {
      const item = makeFailedItem({
        id: 4,
        entityType: "comment",
        sourceId: "c3",
        metadata: { ticketSourceId: "t2" },
      });

      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateCommentById.mockResolvedValue(undefined);

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.resolved).toBe(1);
      expect(migration.migrateCommentById).toHaveBeenCalledWith("c3", "t2");
    });

    it("increments retry count and keeps pending on transient failure", async () => {
      const item = makeFailedItem({ retryCount: 0 });
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateTicketById.mockRejectedValue(
        new ConnectorError("Rate limited", "bolddesk", 429),
      );

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.stillFailing).toBe(1);
      expect(result.exhausted).toBe(0);
      expect(jobs.updateFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({
          retryCount: 1,
          status: "pending",
        }),
      );
    });

    it("marks item exhausted when max retries reached", async () => {
      const item = makeFailedItem({ retryCount: 2 }); // maxRetries = 3, so next attempt = 3 → exhausted
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateTicketById.mockRejectedValue(
        new ConnectorError("Server error", "bolddesk", 500),
      );

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.exhausted).toBe(1);
      expect(result.stillFailing).toBe(0);
      expect(jobs.updateFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({
          retryCount: 3,
          status: "exhausted",
        }),
      );
    });

    it("marks item exhausted immediately on permanent (non-transient) error", async () => {
      const item = makeFailedItem({ retryCount: 0 });
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      migration.migrateTicketById.mockRejectedValue(
        new MappingNotFoundError("user", "u99"),
      );

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.exhausted).toBe(1);
      expect(jobs.updateFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({ status: "exhausted" }),
      );
    });

    it("processes entities in dependency order (org → user → ticket → comment)", async () => {
      const callOrder: string[] = [];

      const items = [
        makeFailedItem({ id: 1, entityType: "comment", sourceId: "c1", metadata: { ticketSourceId: "t1" } }),
        makeFailedItem({ id: 2, entityType: "ticket", sourceId: "t1" }),
        makeFailedItem({ id: 3, entityType: "user", sourceId: "u1" }),
        makeFailedItem({ id: 4, entityType: "organization", sourceId: "o1" }),
      ];

      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue(items);

      const migration = mockMigration();
      migration.migrateOrganizationById.mockImplementation(async () => { callOrder.push("organization"); });
      migration.migrateUserById.mockImplementation(async () => { callOrder.push("user"); });
      migration.migrateTicketById.mockImplementation(async () => { callOrder.push("ticket"); return makeJob(); });
      migration.migrateCommentById.mockImplementation(async () => { callOrder.push("comment"); });

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      await svc.retryFailedItems(100);

      expect(callOrder).toEqual(["organization", "user", "ticket", "comment"]);
    });

    it("handles mixed successes and failures in one pass", async () => {
      const items = [
        makeFailedItem({ id: 1, entityType: "ticket", sourceId: "t1" }),
        makeFailedItem({ id: 2, entityType: "ticket", sourceId: "t2" }),
        makeFailedItem({ id: 3, entityType: "ticket", sourceId: "t3" }),
      ];

      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue(items);

      const migration = mockMigration();
      migration.migrateTicketById
        .mockResolvedValueOnce(makeJob()) // t1 succeeds
        .mockRejectedValueOnce(new ConnectorError("500", "bolddesk", 500)) // t2 fails
        .mockResolvedValueOnce(makeJob()); // t3 succeeds

      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      expect(result.resolved).toBe(2);
      expect(result.stillFailing).toBe(1);
      expect(result.byEntityType["ticket"]).toEqual(
        expect.objectContaining({ attempted: 3, resolved: 2, stillFailing: 1 }),
      );
    });

    it("audits retry start and completion", async () => {
      const items = [makeFailedItem()];
      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue(items);

      const migration = mockMigration();
      migration.migrateTicketById.mockResolvedValue(makeJob());

      const audit = mockAudit();
      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService, audit });
      const svc = new RetryService(deps);

      await svc.retryFailedItems(100);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "retry_started" }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "retry_completed" }),
      );
    });

    it("fails comment retry when metadata lacks ticketSourceId", async () => {
      const item = makeFailedItem({
        id: 5,
        entityType: "comment",
        sourceId: "c1",
        metadata: {},
      });

      const jobs = mockJobs();
      jobs.getRetryableItems.mockResolvedValue([item]);

      const migration = mockMigration();
      const deps = buildDeps({ jobs, migration: migration as unknown as MigrationService });
      const svc = new RetryService(deps);

      const result = await svc.retryFailedItems(100);

      // Should fail with an error about missing metadata — not transient, so exhausted
      expect(result.exhausted).toBe(1);
      expect(jobs.updateFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Missing ticketSourceId"),
        }),
      );
    });
  });
});
