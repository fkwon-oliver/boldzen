import { RetryService, RetryDependencies, RetryConfig } from "@/retry/retry.service";
import { MigrationService } from "@/migration/migration.service";
import { MappingRepository } from "@/persistence/mapping.repository";
import { JobRepository } from "@/persistence/job.repository";
import { AuditRepository } from "@/persistence/audit.repository";
import { FailedItem, MigrationJob } from "@/models";
import { ConnectorError, MappingNotFoundError } from "@/errors";

// ── Factories ──────────────────────────────────────────────

function makeFailedItem(overrides: Partial<FailedItem> = {}): FailedItem {
  return {
    id: 1,
    jobId: 100,
    entityType: "comment",
    sourceId: "c1",
    error: "API error",
    retryCount: 0,
    lastAttemptAt: "2024-01-01T00:00:00Z",
    status: "pending",
    metadata: { ticketSourceId: "t1" },
    ...overrides,
  };
}

function makeJob(): MigrationJob {
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

function mockMappings(): jest.Mocked<MappingRepository> {
  return {
    save: jest.fn(),
    findBySource: jest.fn().mockResolvedValue(null),
    findAllByType: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(true),
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
  backoffBaseMs: 0,
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

describe("RetryService — sync-state interaction", () => {
  it("logs sync_state_transition when retry resolves last blocker → complete", async () => {
    const item = makeFailedItem({
      id: 1,
      entityType: "comment",
      sourceId: "c1",
      metadata: { ticketSourceId: "t1" },
    });

    const jobs = mockJobs();
    jobs.getRetryableItems.mockResolvedValue([item]);

    // Before retry: ticket has this pending item → partial
    // After retry: item is resolved → complete
    // getFailedItemsForTicket is called twice:
    //   1) before retry pass (snapshot) — returns [pending item]
    //   2) after retry pass (recompute) — returns [resolved item]
    jobs.getFailedItemsForTicket
      .mockResolvedValueOnce([item]) // before
      .mockResolvedValueOnce([{ ...item, status: "resolved" as const }]); // after

    const mappings = mockMappings();
    mappings.exists.mockResolvedValue(true);

    const migration = mockMigration();
    migration.migrateCommentById.mockResolvedValue(undefined);

    const audit = mockAudit();
    const deps = buildDeps({ jobs, mappings, migration: migration as unknown as MigrationService, audit });
    const svc = new RetryService(deps);

    await svc.retryFailedItems(100);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync_state_transition",
        sourceId: "t1",
        detail: { from: "partial", to: "complete" },
      }),
    );
  });

  it("logs sync_state_transition when retry exhausts → failed", async () => {
    const item = makeFailedItem({
      id: 1,
      entityType: "comment",
      sourceId: "c1",
      retryCount: 2, // next attempt = 3 → exhausted (maxRetries=3)
      metadata: { ticketSourceId: "t1" },
    });

    const jobs = mockJobs();
    jobs.getRetryableItems.mockResolvedValue([item]);

    // Before: partial (pending item)
    // After: failed (exhausted item)
    jobs.getFailedItemsForTicket
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, status: "exhausted" as const, retryCount: 3 }]);

    const mappings = mockMappings();
    mappings.exists.mockResolvedValue(true);

    const migration = mockMigration();
    migration.migrateCommentById.mockRejectedValue(
      new ConnectorError("Server error", "bolddesk", 500),
    );

    const audit = mockAudit();
    const deps = buildDeps({ jobs, mappings, migration: migration as unknown as MigrationService, audit });
    const svc = new RetryService(deps);

    await svc.retryFailedItems(100);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync_state_transition",
        sourceId: "t1",
        detail: { from: "partial", to: "failed" },
      }),
    );
  });

  it("does not log sync_state_transition when state does not change", async () => {
    const items = [
      makeFailedItem({ id: 1, sourceId: "c1", metadata: { ticketSourceId: "t1" } }),
      makeFailedItem({ id: 2, sourceId: "c2", metadata: { ticketSourceId: "t1" } }),
    ];

    const jobs = mockJobs();
    jobs.getRetryableItems.mockResolvedValue(items);

    // Only one of two items resolves — state stays partial
    jobs.getFailedItemsForTicket
      .mockResolvedValueOnce(items) // before: partial
      .mockResolvedValueOnce([
        { ...items[0], status: "resolved" as const },
        items[1], // still pending
      ]); // after: still partial

    const mappings = mockMappings();
    mappings.exists.mockResolvedValue(true);

    const migration = mockMigration();
    migration.migrateCommentById
      .mockResolvedValueOnce(undefined) // c1 succeeds
      .mockRejectedValueOnce(new ConnectorError("429", "bolddesk", 429)); // c2 fails

    const audit = mockAudit();
    const deps = buildDeps({ jobs, mappings, migration: migration as unknown as MigrationService, audit });
    const svc = new RetryService(deps);

    await svc.retryFailedItems(100);

    const transitionCalls = audit.log.mock.calls.filter(
      (call) => call[0]?.action === "sync_state_transition",
    );
    expect(transitionCalls).toHaveLength(0);
  });

  it("retry does not create ambiguous ownership transitions", async () => {
    // Retry service processes items but never writes Zendesk ownership fields
    const item = makeFailedItem({
      id: 1,
      entityType: "comment",
      sourceId: "c1",
      metadata: { ticketSourceId: "t1" },
    });

    const jobs = mockJobs();
    jobs.getRetryableItems.mockResolvedValue([item]);
    jobs.getFailedItemsForTicket
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, status: "resolved" as const }]);

    const mappings = mockMappings();
    mappings.exists.mockResolvedValue(true);

    const migration = mockMigration();
    migration.migrateCommentById.mockResolvedValue(undefined);

    const deps = buildDeps({ jobs, mappings, migration: migration as unknown as MigrationService });
    const svc = new RetryService(deps);

    await svc.retryFailedItems(100);

    // RetryService has no access to ZendeskConnector.updateTicket — it cannot
    // change ownership.  The only ownership mutation path is PilotOwnershipService.
    // This test verifies that migration.migrateCommentById is the only migration
    // call made — no pilot/ownership-related calls.
    expect(migration.migrateCommentById).toHaveBeenCalledTimes(1);
    expect(migration.migrateTicketById).not.toHaveBeenCalled();
  });

  it("computeTicketSyncState returns correct state via public method", async () => {
    const jobs = mockJobs();
    jobs.getFailedItemsForTicket.mockResolvedValue([
      makeFailedItem({ status: "pending" }),
    ]);

    const mappings = mockMappings();
    mappings.exists.mockResolvedValue(true);

    const deps = buildDeps({ jobs, mappings });
    const svc = new RetryService(deps);

    const state = await svc.computeTicketSyncState("t1");
    expect(state).toBe("partial");
  });
});
