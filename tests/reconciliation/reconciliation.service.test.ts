import {
  ReconciliationService,
  ReconciliationDependencies,
  BatchReconciliationResult,
} from "@/reconciliation/reconciliation.service";
import { SourceConnector, PaginatedResult } from "@/connectors/source.interface";
import { MappingRepository } from "@/persistence/mapping.repository";
import { JobRepository } from "@/persistence/job.repository";
import {
  NormalizedUser,
  NormalizedOrganization,
  NormalizedTicket,
  NormalizedComment,
  NormalizedAttachment,
  EntityMapping,
  MigrationJob,
  FailedItem,
  MappedEntityType,
} from "@/models";

// ── Factories ──────────────────────────────────────────

function makeUser(overrides: Partial<NormalizedUser> = {}): NormalizedUser {
  return {
    sourceId: "u1",
    name: "Alice",
    email: "alice@example.com",
    role: "end_user",
    active: true,
    ...overrides,
  };
}

function makeOrg(overrides: Partial<NormalizedOrganization> = {}): NormalizedOrganization {
  return {
    sourceId: "o1",
    name: "Acme",
    domainNames: [],
    tags: [],
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<NormalizedAttachment> = {}): NormalizedAttachment {
  return {
    sourceId: "a1",
    fileName: "file.png",
    contentType: "image/png",
    size: 1024,
    sourceUrl: "https://example.com/file.png",
    commentSourceId: "c1",
    ...overrides,
  };
}

function makeComment(overrides: Partial<NormalizedComment> = {}): NormalizedComment {
  return {
    sourceId: "c1",
    ticketSourceId: "t1",
    authorSourceId: "u1",
    body: "Hello",
    isPublic: true,
    createdAt: "2024-01-01T00:05:00Z",
    attachments: [],
    ...overrides,
  };
}

function makeTicket(overrides: Partial<NormalizedTicket> = {}): NormalizedTicket {
  return {
    sourceId: "t1",
    subject: "Test",
    description: "Help",
    status: "open",
    requesterSourceId: "u1",
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    comments: [],
    customFields: {},
    ...overrides,
  };
}

function mapping(entityType: MappedEntityType, sourceId: string, destId: string): EntityMapping {
  return { entityType, sourceId, destinationId: destId, createdAt: "2024-01-01T00:00:00Z" };
}

function singlePage<T>(data: T[]): PaginatedResult<T> {
  return { data, nextCursor: undefined, hasMore: false };
}

// ── Mock builders ──────────────────────────────────────

function mockSource(): jest.Mocked<SourceConnector> {
  return {
    fetchUsers: jest.fn().mockResolvedValue(singlePage([])),
    fetchOrganizations: jest.fn().mockResolvedValue(singlePage([])),
    fetchTickets: jest.fn().mockResolvedValue(singlePage([])),
    fetchTicketById: jest.fn(),
    fetchUserById: jest.fn(),
    fetchOrganizationById: jest.fn(),
    downloadAttachment: jest.fn(),
  };
}

function mockMappings(data: EntityMapping[] = []): jest.Mocked<MappingRepository> {
  return {
    save: jest.fn(),
    findBySource: jest.fn().mockResolvedValue(null),
    findAllByType: jest.fn().mockImplementation(async (type: MappedEntityType) =>
      data.filter((m) => m.entityType === type),
    ),
    exists: jest.fn().mockResolvedValue(false),
  };
}

function mockJobs(
  job: MigrationJob = {
    id: 1,
    name: "test",
    status: "completed",
    totalItems: 0,
    processedItems: 0,
    failedItems: 0,
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: "2024-01-01T01:00:00Z",
    metadata: {},
  },
  failedItems: FailedItem[] = [],
): jest.Mocked<JobRepository> {
  return {
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getJob: jest.fn().mockResolvedValue(job),
    addFailedItem: jest.fn(),
    updateFailedItem: jest.fn(),
    updateFailedItemStatus: jest.fn(),
    getFailedItems: jest.fn().mockResolvedValue(failedItems),
    getRetryableItems: jest.fn().mockResolvedValue([]),
    getFailedItemsForTicket: jest.fn().mockResolvedValue([]),
  };
}

function mockLogger(): any {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function buildDeps(overrides: Partial<ReconciliationDependencies> = {}): ReconciliationDependencies {
  return {
    source: mockSource(),
    mappings: mockMappings(),
    jobs: mockJobs(),
    logger: mockLogger(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────

describe("ReconciliationService", () => {
  describe("reconcile", () => {
    it("returns matched when everything lines up", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([makeTicket()]));

      const comment = makeComment();
      const ticket = makeTicket({ comments: [comment] });
      source.fetchTicketById.mockResolvedValue(ticket);

      const allMappings = [
        mapping("organization", "o1", "bd-o1"),
        mapping("user", "u1", "bd-u1"),
        mapping("ticket", "t1", "bd-t1"),
        mapping("comment", "c1", "bd-c1"),
      ];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      expect(result.overallStatus).toBe("matched");
      expect(result.entityResults).toHaveLength(3);
      expect(result.entityResults.every((r) => r.missingSourceIds.length === 0)).toBe(true);
      expect(result.ticketDetails[0].status).toBe("matched");
    });

    it("throws when job not found", async () => {
      const jobs = mockJobs();
      jobs.getJob.mockResolvedValue(null);
      const deps = buildDeps({ jobs });
      const svc = new ReconciliationService(deps);

      await expect(svc.reconcile(999)).rejects.toThrow("Job 999 not found");
    });
  });

  describe("entity-level reconciliation", () => {
    it("detects missing user mappings", async () => {
      const source = mockSource();
      source.fetchUsers.mockResolvedValue(
        singlePage([makeUser({ sourceId: "u1" }), makeUser({ sourceId: "u2" })]),
      );

      const allMappings = [mapping("user", "u1", "bd-u1")];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      const userResult = result.entityResults.find((r) => r.entityType === "user")!;
      expect(userResult.totalSource).toBe(2);
      expect(userResult.totalMapped).toBe(1);
      expect(userResult.missingSourceIds).toEqual(["u2"]);
    });

    it("detects missing org mappings", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(
        singlePage([makeOrg({ sourceId: "o1" })]),
      );

      const deps = buildDeps({ source, mappings: mockMappings([]) });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      const orgResult = result.entityResults.find((r) => r.entityType === "organization")!;
      expect(orgResult.totalSource).toBe(1);
      expect(orgResult.totalMapped).toBe(0);
      expect(orgResult.missingSourceIds).toEqual(["o1"]);
    });
  });

  describe("ticket-level reconciliation", () => {
    it("detects missing comment mappings", async () => {
      const source = mockSource();
      const c1 = makeComment({ sourceId: "c1", isPublic: true });
      const c2 = makeComment({ sourceId: "c2", isPublic: false });
      const ticket = makeTicket({ comments: [c1, c2] });
      source.fetchTicketById.mockResolvedValue(ticket);

      const allMappings = [
        mapping("ticket", "t1", "bd-t1"),
        mapping("comment", "c1", "bd-c1"),
      ];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      const td = result.ticketDetails[0];
      expect(td.status).toBe("partial");
      expect(td.expectedComments).toBe(2);
      expect(td.mappedComments).toBe(1);
      expect(td.discrepancies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "internal_note_count_mismatch" }),
        ]),
      );
    });

    it("detects missing attachment mappings", async () => {
      const source = mockSource();
      const att = makeAttachment({ sourceId: "a1" });
      const comment = makeComment({ attachments: [att] });
      const ticket = makeTicket({ comments: [comment] });
      source.fetchTicketById.mockResolvedValue(ticket);

      const allMappings = [
        mapping("ticket", "t1", "bd-t1"),
        mapping("comment", "c1", "bd-c1"),
      ];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      const td = result.ticketDetails[0];
      expect(td.expectedAttachments).toBe(1);
      expect(td.mappedAttachments).toBe(0);
      expect(td.discrepancies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "attachment_count_mismatch" }),
        ]),
      );
    });

    it("marks ticket as matched when all comments and attachments are mapped", async () => {
      const source = mockSource();
      const att = makeAttachment({ sourceId: "a1" });
      const comment = makeComment({ attachments: [att] });
      const ticket = makeTicket({ comments: [comment] });
      source.fetchTicketById.mockResolvedValue(ticket);

      const allMappings = [
        mapping("ticket", "t1", "bd-t1"),
        mapping("comment", "c1", "bd-c1"),
        mapping("attachment", "a1", "bd-a1"),
      ];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      expect(result.ticketDetails[0].status).toBe("matched");
      expect(result.ticketDetails[0].discrepancies).toHaveLength(0);
    });

    it("handles source fetch failure gracefully", async () => {
      const source = mockSource();
      source.fetchTicketById.mockRejectedValue(new Error("404 Not Found"));

      const allMappings = [mapping("ticket", "t1", "bd-t1")];
      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      const td = result.ticketDetails[0];
      expect(td.status).toBe("failed");
      expect(td.discrepancies[0].category).toBe("api_error");
    });
  });

  describe("overall status", () => {
    it("returns failed when all source entities are missing", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([makeTicket()]));

      const deps = buildDeps({ source, mappings: mockMappings([]) });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      expect(result.overallStatus).toBe("failed");
    });

    it("returns partial when there are failed items", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([makeTicket()]));

      const allMappings = [
        mapping("organization", "o1", "bd-o1"),
        mapping("user", "u1", "bd-u1"),
        mapping("ticket", "t1", "bd-t1"),
      ];

      const ticket = makeTicket({ comments: [] });
      source.fetchTicketById.mockResolvedValue(ticket);

      const failedItems: FailedItem[] = [
        {
          jobId: 1,
          entityType: "ticket",
          sourceId: "t99",
          error: "API Error",
          retryCount: 0,
          lastAttemptAt: "2024-01-01T00:00:00Z",
        },
      ];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
        jobs: mockJobs(undefined, failedItems),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);

      expect(result.overallStatus).toBe("partial");
    });
  });

  describe("generateReport", () => {
    it("produces a readable text report", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));
      source.fetchUsers.mockResolvedValue(
        singlePage([makeUser({ sourceId: "u1" }), makeUser({ sourceId: "u2" })]),
      );
      source.fetchTickets.mockResolvedValue(singlePage([makeTicket()]));

      const c1 = makeComment({ sourceId: "c1", isPublic: true });
      const c2 = makeComment({ sourceId: "c2", isPublic: false });
      const ticket = makeTicket({ comments: [c1, c2] });
      source.fetchTicketById.mockResolvedValue(ticket);

      const allMappings = [
        mapping("organization", "o1", "bd-o1"),
        mapping("user", "u1", "bd-u1"),
        mapping("ticket", "t1", "bd-t1"),
        mapping("comment", "c1", "bd-c1"),
      ];

      const deps = buildDeps({
        source,
        mappings: mockMappings(allMappings),
      });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);
      const report = await svc.generateReport(result);

      expect(report).toContain("RECONCILIATION REPORT");
      expect(report).toContain("Job #1");
      expect(report).toContain("ENTITY COUNTS");
      expect(report).toContain("user");
      expect(report).toContain("1 missing");
      expect(report).toContain("TICKET DISCREPANCIES");
      expect(report).toContain("internal_note_count_mismatch");
      expect(report).toContain("TICKET SUMMARY");
    });

    it("shows clean output when everything is matched", async () => {
      const source = mockSource();

      const deps = buildDeps({ source });
      const svc = new ReconciliationService(deps);

      const result = await svc.reconcile(1);
      const report = await svc.generateReport(result);

      expect(report).toContain("MATCHED");
      expect(report).not.toContain("TICKET DISCREPANCIES");
      expect(report).not.toContain("FAILED ITEMS");
    });
  });
});
