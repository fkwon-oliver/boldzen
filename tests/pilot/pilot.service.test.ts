import { PilotOwnershipService, PilotConfig } from "@/pilot/pilot.service";
import { ZendeskConnector } from "@/connectors/zendesk/zendesk.connector";
import { MappingRepository } from "@/persistence/mapping.repository";
import { JobRepository } from "@/persistence/job.repository";
import { AuditRepository } from "@/persistence/audit.repository";
import { MigrationService } from "@/migration/migration.service";
import {
  NormalizedTicket,
  EntityMapping,
  FailedItem,
  FailedItemStatus,
} from "@/models";

// ── Factories ──────────────────────────────────────────────

const FIELD_OWNER = 100;
const FIELD_SYNC = 101;
const FIELD_BD_ID = 102;

const PILOT_CONFIG: PilotConfig = {
  ownerSystemFieldId: FIELD_OWNER,
  syncStateFieldId: FIELD_SYNC,
  bolddeskTicketIdFieldId: FIELD_BD_ID,
  handoffTag: "handled_in_bolddesk",
  pendingSyncTag: "pending_bolddesk_sync",
};

function makeTicket(overrides: Partial<NormalizedTicket> = {}): NormalizedTicket {
  return {
    sourceId: "t1",
    subject: "Test",
    description: "Test ticket",
    status: "open",
    requesterSourceId: "u1",
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    comments: [],
    customFields: {
      [String(FIELD_OWNER)]: "zendesk",
      [String(FIELD_SYNC)]: "not_synced",
    },
    ...overrides,
  };
}

function makeMapping(sourceId: string, destId: string): EntityMapping {
  return {
    id: 1,
    entityType: "ticket",
    sourceId,
    destinationId: destId,
    createdAt: "2024-01-01T00:00:00Z",
  };
}

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

// ── Mock builders ──────────────────────────────────────────

function mockSource(): jest.Mocked<
  Pick<ZendeskConnector, "fetchTicketById" | "updateTicket">
> {
  return {
    fetchTicketById: jest.fn().mockResolvedValue(makeTicket()),
    updateTicket: jest.fn().mockResolvedValue(undefined),
  };
}

function mockMappings(): jest.Mocked<MappingRepository> {
  return {
    save: jest.fn(),
    findBySource: jest.fn().mockResolvedValue(null),
    findAllByType: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(false),
  };
}

function mockJobs(): jest.Mocked<JobRepository> {
  return {
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getJob: jest.fn(),
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

function mockMigration(): jest.Mocked<Pick<MigrationService, "migrateTicketById">> {
  return {
    migrateTicketById: jest.fn(),
  };
}

function mockLogger(): any {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function buildService(overrides: {
  source?: any;
  mappings?: any;
  jobs?: any;
  audit?: any;
  migration?: any;
} = {}) {
  const source = overrides.source ?? mockSource();
  const mappings = overrides.mappings ?? mockMappings();
  const jobs = overrides.jobs ?? mockJobs();
  const audit = overrides.audit ?? mockAudit();
  const migration = overrides.migration ?? mockMigration();
  const logger = mockLogger();

  const svc = new PilotOwnershipService(
    source as unknown as ZendeskConnector,
    mappings,
    jobs,
    audit,
    migration as unknown as MigrationService,
    PILOT_CONFIG,
    logger,
  );

  return { svc, source, mappings, jobs, audit, migration, logger };
}

// ── Tests ──────────────────────────────────────────────────

describe("PilotOwnershipService", () => {
  // ---------------------------------------------------------------
  // Handoff gating: blocked when sync state is not complete
  // ---------------------------------------------------------------

  describe("handoff — strict gating", () => {
    it("blocks handoff when ticket has no migration mapping (pending)", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(null);

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const { svc, audit } = buildService({ mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("blocked");
      expect(result.syncState).toBe("pending");
      expect(result.blockedReasons).toBeDefined();
      expect(result.blockedReasons!.some((r) => r.includes("pending"))).toBe(true);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "pilot_handoff_blocked" }),
      );
    });

    it("blocks handoff when ticket has pending (retryable) failures — partial", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([
        makeFailedItem({ status: "pending" }),
      ]);

      const { svc } = buildService({ mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("blocked");
      expect(result.syncState).toBe("partial");
      expect(result.blockedReasons!.some((r) => r.includes("partial"))).toBe(true);
    });

    it("blocks handoff when ticket has exhausted failures — failed", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([
        makeFailedItem({ status: "exhausted", retryCount: 3 }),
      ]);

      const { svc } = buildService({ mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("blocked");
      expect(result.syncState).toBe("failed");
    });

    it("blocks handoff when ticket is closed", async () => {
      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(
        makeTicket({ status: "closed" }),
      );

      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const { svc } = buildService({ source, mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("blocked");
      expect(result.blockedReasons!.some((r) => r.includes("closed"))).toBe(true);
    });

    it("allows handoff when sync state is complete", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(makeTicket());

      const { svc, audit } = buildService({ source, mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("handed_off");
      expect(result.ticketDestId).toBe("bd-1");
      expect(result.syncState).toBe("complete");
      expect(source.updateTicket).toHaveBeenCalledWith("t1", expect.objectContaining({
        additional_tags: ["handled_in_bolddesk"],
      }));
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "pilot_handoff" }),
      );
    });

    it("blocks handoff when owner is already bolddesk but sync is not pilot_active", async () => {
      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(
        makeTicket({
          customFields: {
            [String(FIELD_OWNER)]: "bolddesk",
            [String(FIELD_SYNC)]: "sync_error",
          },
        }),
      );

      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const { svc } = buildService({ source, mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("blocked");
      expect(result.blockedReasons!.some((r) => r.includes("already owned by bolddesk"))).toBe(true);
    });

    it("allows handoff when all failures are resolved (derived complete)", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([
        makeFailedItem({ id: 1, status: "resolved" }),
        makeFailedItem({ id: 2, status: "resolved" }),
      ]);

      const { svc } = buildService({ mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("handed_off");
    });
  });

  // ---------------------------------------------------------------
  // Ownership remains Zendesk when gate fails
  // ---------------------------------------------------------------

  describe("ownership safety", () => {
    it("does not call updateTicket when handoff is blocked", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(null);

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const source = mockSource();
      const { svc } = buildService({ source, mappings, jobs });

      await svc.handoff("t1");

      expect(source.updateTicket).not.toHaveBeenCalled();
    });

    it("does not modify ownership on write-back failure", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const source = mockSource();
      source.updateTicket
        .mockRejectedValueOnce(new Error("API down"))
        .mockResolvedValueOnce(undefined); // sync_error fallback

      const { svc, audit } = buildService({ source, mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("failed");
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "pilot_handoff_failed" }),
      );
    });

    it("reverts owner_system to zendesk in sync_error fallback", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const source = mockSource();
      source.updateTicket
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce(undefined);

      const { svc } = buildService({ source, mappings, jobs });

      await svc.handoff("t1");

      // The sync_error fallback call should reset owner AND set sync_error
      const fallbackCall = source.updateTicket.mock.calls[1];
      expect(fallbackCall).toBeDefined();
      const fallbackFields = fallbackCall[1].custom_fields;
      expect(fallbackFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: FIELD_OWNER, value: "zendesk" }),
          expect.objectContaining({ id: FIELD_SYNC, value: "sync_error" }),
        ]),
      );
    });
  });

  // ---------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------

  describe("idempotency", () => {
    it("returns already_active when ticket is already owned by bolddesk with pilot_active", async () => {
      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(
        makeTicket({
          customFields: {
            [String(FIELD_OWNER)]: "bolddesk",
            [String(FIELD_SYNC)]: "pilot_active",
          },
        }),
      );

      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const { svc } = buildService({ source, mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("already_active");
      expect(result.syncState).toBe("complete");
      expect(source.updateTicket).not.toHaveBeenCalled();
    });

    it("returns already_active but warns when derived state has degraded", async () => {
      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(
        makeTicket({
          customFields: {
            [String(FIELD_OWNER)]: "bolddesk",
            [String(FIELD_SYNC)]: "pilot_active",
          },
        }),
      );

      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([
        makeFailedItem({ status: "pending" }),
      ]);

      const { svc, audit, logger } = buildService({ source, mappings, jobs });

      const result = await svc.handoff("t1");

      expect(result.status).toBe("already_active");
      expect(result.syncState).toBe("partial");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ syncState: "partial" }),
        expect.stringContaining("degraded"),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "pilot_handoff_degraded" }),
      );
    });
  });

  // ---------------------------------------------------------------
  // Status shows derived sync state
  // ---------------------------------------------------------------

  describe("status", () => {
    it("returns derived sync state from mapping + failed items", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([
        makeFailedItem({ status: "pending" }),
      ]);

      const { svc } = buildService({ mappings, jobs });

      const result = await svc.status("t1");

      expect(result.derivedSyncState).toBe("partial");
      expect(result.unresolvedFailedItems).toBe(1);
      expect(result.hasMigrationMapping).toBe(true);
    });

    it("shows complete when no failures remain", async () => {
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(makeMapping("t1", "bd-1"));

      const jobs = mockJobs();
      jobs.getFailedItemsForTicket.mockResolvedValue([]);

      const { svc } = buildService({ mappings, jobs });

      const result = await svc.status("t1");

      expect(result.derivedSyncState).toBe("complete");
      expect(result.unresolvedFailedItems).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------

  describe("rollback", () => {
    it("returns not_active when ticket is not owned by bolddesk", async () => {
      const { svc, source } = buildService();

      const result = await svc.rollback("t1");

      expect(result.status).toBe("not_active");
      expect(source.updateTicket).not.toHaveBeenCalled();
    });

    it("rolls back ownership and removes tag", async () => {
      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(
        makeTicket({
          customFields: {
            [String(FIELD_OWNER)]: "bolddesk",
            [String(FIELD_SYNC)]: "pilot_active",
          },
        }),
      );

      const { svc, audit } = buildService({ source });

      const result = await svc.rollback("t1");

      expect(result.status).toBe("rolled_back");
      expect(source.updateTicket).toHaveBeenCalledWith("t1", expect.objectContaining({
        remove_tags: ["handled_in_bolddesk"],
      }));
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "pilot_rollback" }),
      );
    });
  });
});
