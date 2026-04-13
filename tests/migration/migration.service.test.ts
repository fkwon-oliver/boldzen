import { MigrationService, MigrationDependencies } from "@/migration/migration.service";
import { SourceConnector, PaginatedResult } from "@/connectors/source.interface";
import { DestinationConnector, CreatedEntity, TicketCreationContext, CommentContext } from "@/connectors/destination.interface";
import { MappingRepository } from "@/persistence/mapping.repository";
import { JobRepository } from "@/persistence/job.repository";
import { AuditRepository } from "@/persistence/audit.repository";
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
import { AuditEntry } from "@/persistence/audit.repository";
import { AgentResolver } from "@/transform/agent.resolver";
import { GroupResolver } from "@/transform/group.resolver";

// ── Factories ──────────────────────────────────────────────

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
    domainNames: ["acme.com"],
    tags: [],
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<NormalizedAttachment> = {}): NormalizedAttachment {
  return {
    sourceId: "a1",
    fileName: "screenshot.png",
    contentType: "image/png",
    size: 1024,
    sourceUrl: "https://zendesk.com/files/screenshot.png",
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
    htmlBody: "<p>Hello</p>",
    isPublic: true,
    createdAt: "2024-01-01T00:05:00Z",
    attachments: [],
    ...overrides,
  };
}

function makeTicket(overrides: Partial<NormalizedTicket> = {}): NormalizedTicket {
  return {
    sourceId: "t1",
    subject: "Test ticket",
    description: "Help",
    status: "open",
    priority: "normal",
    requesterSourceId: "u1",
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    comments: [],
    customFields: {},
    ...overrides,
  };
}

function singlePage<T>(data: T[]): PaginatedResult<T> {
  return { data, nextCursor: undefined, hasMore: false };
}

// ── Mock builders ──────────────────────────────────────────

function mockSource(): jest.Mocked<SourceConnector> {
  return {
    fetchUsers: jest.fn().mockResolvedValue(singlePage([])),
    fetchOrganizations: jest.fn().mockResolvedValue(singlePage([])),
    fetchTickets: jest.fn().mockResolvedValue(singlePage([])),
    fetchTicketById: jest.fn(),
    fetchUserById: jest.fn(),
    fetchOrganizationById: jest.fn(),
    downloadAttachment: jest.fn().mockResolvedValue(Buffer.from("data")),
  };
}

function mockDestination(): jest.Mocked<DestinationConnector> {
  return {
    createContact: jest.fn().mockResolvedValue({ destinationId: "bd-contact-1" }),
    createOrganization: jest.fn().mockResolvedValue({ destinationId: "bd-org-1" }),
    createTicket: jest.fn().mockResolvedValue({ destinationId: "bd-ticket-1" }),
    addComment: jest.fn().mockResolvedValue({ destinationId: "bd-comment-1" }),
    uploadAttachment: jest.fn().mockResolvedValue({ destinationId: "att-token-1" }),
    findContactByEmail: jest.fn().mockResolvedValue(null),
    findOrganizationByName: jest.fn().mockResolvedValue(null),
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
  let nextId = 1;
  return {
    createJob: jest.fn().mockImplementation((j: MigrationJob) => ({
      ...j,
      id: nextId++,
    })),
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

function mockLogger(): any {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function buildDeps(overrides: Partial<MigrationDependencies> = {}): MigrationDependencies {
  return {
    source: mockSource(),
    destination: mockDestination(),
    mappings: mockMappings(),
    jobs: mockJobs(),
    audit: mockAudit(),
    logger: mockLogger(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe("MigrationService", () => {
  describe("runHistoricalMigration", () => {
    it("completes successfully when there is nothing to migrate", async () => {
      const deps = buildDeps();
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(job.status).toBe("completed");
      expect(deps.jobs.createJob).toHaveBeenCalledTimes(1);
      expect(deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "migration_started" }),
      );
    });

    it("marks the job as failed when a fatal error occurs", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockRejectedValue(new Error("API down"));

      const deps = buildDeps({ source });
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(job.status).toBe("failed");
      expect(deps.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "migration_failed" }),
      );
    });
  });

  describe("migrateOrganizations (via runHistoricalMigration)", () => {
    it("creates orgs in destination and persists mappings", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));

      const dest = mockDestination();
      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(dest.createOrganization).toHaveBeenCalledTimes(1);
      expect(mappings.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "organization",
          sourceId: "o1",
          destinationId: "bd-org-1",
        }),
      );
      expect(job.processedItems).toBeGreaterThanOrEqual(1);
    });

    it("skips org if mapping already exists (idempotent)", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));

      const dest = mockDestination();
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue({
        entityType: "organization",
        sourceId: "o1",
        destinationId: "bd-org-existing",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createOrganization).not.toHaveBeenCalled();
    });

    it("uses existing org in BoldDesk if found by name", async () => {
      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([makeOrg()]));

      const dest = mockDestination();
      dest.findOrganizationByName.mockResolvedValue({ destinationId: "bd-org-found" });

      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createOrganization).not.toHaveBeenCalled();
      expect(mappings.save).toHaveBeenCalledWith(
        expect.objectContaining({ destinationId: "bd-org-found" }),
      );
    });
  });

  describe("migrateUsers (via runHistoricalMigration)", () => {
    it("creates contacts and persists mappings", async () => {
      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));

      const dest = mockDestination();
      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createContact).toHaveBeenCalledTimes(1);
      expect(mappings.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "user",
          sourceId: "u1",
        }),
      );
    });

    it("skips user if mapping already exists", async () => {
      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));

      const dest = mockDestination();
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue({
        entityType: "user",
        sourceId: "u1",
        destinationId: "bd-contact-existing",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createContact).not.toHaveBeenCalled();
    });

    it("uses existing BoldDesk contact if found by email", async () => {
      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));

      const dest = mockDestination();
      dest.findContactByEmail.mockResolvedValue({ destinationId: "bd-contact-found" });

      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createContact).not.toHaveBeenCalled();
      expect(mappings.save).toHaveBeenCalledWith(
        expect.objectContaining({ destinationId: "bd-contact-found" }),
      );
    });
  });

  describe("migrateTickets (via runHistoricalMigration)", () => {
    function setupTicketMigration() {
      const user = makeUser();
      const org = makeOrg();
      const attachment = makeAttachment();
      const firstComment = makeComment({ sourceId: "c0", attachments: [attachment] });
      const secondComment = makeComment({ sourceId: "c1", createdAt: "2024-01-01T00:10:00Z", attachments: [] });
      const ticket = makeTicket({
        organizationSourceId: "o1",
        comments: [firstComment, secondComment],
      });

      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([org]));
      source.fetchUsers.mockResolvedValue(singlePage([user]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);
      source.downloadAttachment.mockResolvedValue(Buffer.from("file-data"));

      const dest = mockDestination();
      const mappings = mockMappings();

      // Let org and user migrate first, then ticket checks find no existing mapping
      let callCount = 0;
      mappings.findBySource.mockImplementation(
        async (entityType: MappedEntityType, sourceId: string) => {
          if (entityType === "organization" && sourceId === "o1") {
            if (callCount > 0) {
              return {
                entityType: "organization",
                sourceId: "o1",
                destinationId: "bd-org-1",
                createdAt: "2024-01-01T00:00:00Z",
              };
            }
            callCount++;
            return null;
          }
          return null;
        },
      );

      return { source, dest, mappings, user, org, ticket, firstComment, secondComment, attachment };
    }

    it("migrates a ticket with comments and attachments", async () => {
      const { source, dest, mappings } = setupTicketMigration();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledTimes(1);
      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: "t1" }),
        expect.objectContaining({ requesterEmail: "alice@example.com" }),
      );
      expect(dest.addComment).toHaveBeenCalledTimes(1);
      expect(source.downloadAttachment).toHaveBeenCalledTimes(1);
      expect(dest.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(job.status).toBe("completed");
    });

    it("skips ticket creation if mapping exists but still processes comments", async () => {
      const comment = makeComment();
      const ticket = makeTicket({ comments: [comment] });

      const source = mockSource();
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue({
        entityType: "ticket",
        sourceId: "t1",
        destinationId: "bd-ticket-existing",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).not.toHaveBeenCalled();
      expect(source.fetchTicketById).toHaveBeenCalledWith("t1");
    });

    it("passes requester email in the ticket creation context", async () => {
      const { source, dest, mappings } = setupTicketMigration();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ requesterEmail: "alice@example.com" }),
      );
    });

    it("passes contactGroupDestId when org mapping exists", async () => {
      const { source, dest, mappings } = setupTicketMigration();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contactGroupDestId: "bd-org-1" }),
      );
    });
  });

  describe("migrateTicketById", () => {
    it("migrates a single ticket end-to-end", async () => {
      const firstComment = makeComment({ sourceId: "c0" });
      const secondComment = makeComment({ sourceId: "c1" });
      const ticket = makeTicket({ comments: [firstComment, secondComment] });

      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(ticket);
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));

      const dest = mockDestination();
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(null);

      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.migrateTicketById("t1");

      expect(source.fetchTicketById).toHaveBeenCalledWith("t1");
      expect(dest.createTicket).toHaveBeenCalledTimes(1);
      expect(dest.addComment).toHaveBeenCalledTimes(1);
    });

    it("creates a bookkeeping job so comment failures are persisted", async () => {
      const firstComment = makeComment({ sourceId: "c0" });
      const comment1 = makeComment({ sourceId: "c1" });
      const comment2 = makeComment({ sourceId: "c2" });
      const ticket = makeTicket({ comments: [firstComment, comment1, comment2] });

      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(ticket);
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));

      const dest = mockDestination();
      dest.addComment
        .mockRejectedValueOnce(new Error("Comment API error"))
        .mockResolvedValueOnce({ destinationId: "bd-c2" });

      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(null);

      const jobs = mockJobs();
      const deps = buildDeps({ source, destination: dest, mappings, jobs });
      const svc = new MigrationService(deps);

      await svc.migrateTicketById("t1");

      expect(jobs.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ name: "single-ticket-t1" }),
      );
      expect(jobs.addFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "comment",
          sourceId: "c1",
          metadata: { ticketSourceId: "t1" },
        }),
      );
      expect(jobs.updateJob).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed_with_errors" }),
      );
    });

    it("marks bookkeeping job as completed when all comments succeed", async () => {
      const comment = makeComment();
      const ticket = makeTicket({ comments: [comment] });

      const source = mockSource();
      source.fetchTicketById.mockResolvedValue(ticket);
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));

      const dest = mockDestination();
      const mappings = mockMappings();
      mappings.findBySource.mockResolvedValue(null);

      const jobs = mockJobs();
      const deps = buildDeps({ source, destination: dest, mappings, jobs });
      const svc = new MigrationService(deps);

      await svc.migrateTicketById("t1");

      expect(jobs.updateJob).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed" }),
      );
    });
  });

  describe("per-item error handling", () => {
    it("continues processing when an individual org fails", async () => {
      const org1 = makeOrg({ sourceId: "o1" });
      const org2 = makeOrg({ sourceId: "o2", name: "Corp2" });

      const source = mockSource();
      source.fetchOrganizations.mockResolvedValue(singlePage([org1, org2]));

      const dest = mockDestination();
      dest.findOrganizationByName.mockResolvedValue(null);
      dest.createOrganization
        .mockRejectedValueOnce(new Error("API error"))
        .mockResolvedValueOnce({ destinationId: "bd-org-2" });

      const jobs = mockJobs();
      const deps = buildDeps({ source, destination: dest, jobs });
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(dest.createOrganization).toHaveBeenCalledTimes(2);
      expect(jobs.addFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: "o1", entityType: "organization" }),
      );
      expect(job.status).toBe("completed_with_errors");
    });

    it("records comment failure without failing the whole ticket", async () => {
      const firstComment = makeComment({ sourceId: "c0", createdAt: "2024-01-01T00:00:00Z" });
      const comment1 = makeComment({ sourceId: "c1", createdAt: "2024-01-01T00:01:00Z" });
      const comment2 = makeComment({ sourceId: "c2", createdAt: "2024-01-01T00:02:00Z" });
      const ticket = makeTicket({ comments: [firstComment, comment1, comment2] });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      dest.addComment
        .mockRejectedValueOnce(new Error("Comment API error"))
        .mockResolvedValueOnce({ destinationId: "bd-c2" });

      const jobs = mockJobs();
      const deps = buildDeps({ source, destination: dest, jobs });
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(dest.addComment).toHaveBeenCalledTimes(2);
      expect(jobs.addFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "comment", sourceId: "c1" }),
      );
      expect(job.status).toBe("completed_with_errors");
    });
  });

  describe("pagination", () => {
    it("follows cursor through multiple pages of users", async () => {
      const source = mockSource();
      source.fetchUsers
        .mockResolvedValueOnce({
          data: [makeUser({ sourceId: "u1" })],
          nextCursor: "page2",
          hasMore: true,
        })
        .mockResolvedValueOnce({
          data: [makeUser({ sourceId: "u2", email: "bob@test.com" })],
          nextCursor: undefined,
          hasMore: false,
        });

      const dest = mockDestination();
      const deps = buildDeps({ source, destination: dest });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(source.fetchUsers).toHaveBeenCalledTimes(2);
      expect(source.fetchUsers).toHaveBeenCalledWith("page2");
      expect(dest.createContact).toHaveBeenCalledTimes(2);
    });
  });

  describe("assignee agent resolution", () => {
    it("passes assigneeAgentId to createTicket when AgentResolver is configured", async () => {
      const agent = makeUser({ sourceId: "agent1", email: "agent@co.com", role: "agent" });
      const ticket = makeTicket({
        assigneeSourceId: "agent1",
        comments: [makeComment()],
      });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser(), agent]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      const mappings = mockMappings();

      const agentResolver = new AgentResolver(
        [{ email: "agent@co.com", agentId: 42 }],
        mockLogger(),
      );

      const deps = buildDeps({
        source, destination: dest, mappings, agentResolver,
      });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ assigneeAgentId: 42 }),
      );
    });

    it("creates ticket unassigned when agent email is not in resolver", async () => {
      const agent = makeUser({ sourceId: "agent1", email: "unknown@co.com", role: "agent" });
      const ticket = makeTicket({
        assigneeSourceId: "agent1",
        comments: [makeComment()],
      });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser(), agent]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      const mappings = mockMappings();

      const agentResolver = new AgentResolver(
        [{ email: "other@co.com", agentId: 99 }],
        mockLogger(),
      );

      const deps = buildDeps({
        source, destination: dest, mappings, agentResolver,
      });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ assigneeAgentId: undefined }),
      );
    });
  });

  describe("group resolution", () => {
    it("passes groupId to createTicket when GroupResolver resolves from assignee", async () => {
      const agent = makeUser({ sourceId: "agent1", email: "agent@co.com", role: "agent" });
      const ticket = makeTicket({
        assigneeSourceId: "agent1",
        comments: [makeComment()],
      });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser(), agent]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      const mappings = mockMappings();

      const agentResolver = new AgentResolver(
        [{ email: "agent@co.com", agentId: 42 }],
        mockLogger(),
      );

      const groupResolver = new GroupResolver(
        [{ groupName: "Student Experience Center", groupId: 3 }],
        mockLogger(),
      );
      groupResolver.setAgentGroupMap(new Map([["agent@co.com", "Student Experience Center"]]));

      const deps = buildDeps({
        source, destination: dest, mappings, agentResolver, groupResolver,
      });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ groupId: 3 }),
      );
    });

    it("creates ticket without groupId when assignee group is unmapped", async () => {
      const agent = makeUser({ sourceId: "agent1", email: "agent@co.com", role: "agent" });
      const ticket = makeTicket({
        assigneeSourceId: "agent1",
        comments: [makeComment()],
      });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser(), agent]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      const mappings = mockMappings();

      const agentResolver = new AgentResolver(
        [{ email: "agent@co.com", agentId: 42 }],
        mockLogger(),
      );

      const groupResolver = new GroupResolver(
        [{ groupName: "Other Group", groupId: 99 }],
        mockLogger(),
      );
      groupResolver.setAgentGroupMap(new Map([["agent@co.com", "Unknown Group"]]));

      const deps = buildDeps({
        source, destination: dest, mappings, agentResolver, groupResolver,
      });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ groupId: undefined }),
      );
    });

    it("creates ticket without groupId when no GroupResolver is configured", async () => {
      const agent = makeUser({ sourceId: "agent1", email: "agent@co.com", role: "agent" });
      const ticket = makeTicket({
        assigneeSourceId: "agent1",
        comments: [makeComment()],
      });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser(), agent]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);

      const dest = mockDestination();
      const mappings = mockMappings();

      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ groupId: undefined }),
      );
    });
  });

  describe("first-comment attachment handling", () => {
    it("uploads first-comment attachments and passes tokens to createTicket", async () => {
      const attachment = makeAttachment({ sourceId: "a1" });
      const firstComment = makeComment({ sourceId: "c0", attachments: [attachment] });
      const ticket = makeTicket({ comments: [firstComment] });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);
      source.downloadAttachment.mockResolvedValue(Buffer.from("file-data"));

      const dest = mockDestination();
      dest.uploadAttachment.mockResolvedValue({ destinationId: "token-a1" });

      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(source.downloadAttachment).toHaveBeenCalledTimes(1);
      expect(dest.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachmentTokens: ["token-a1"] }),
      );
    });

    it("creates ticket without attachments when first-comment upload fails", async () => {
      const attachment = makeAttachment({ sourceId: "a1" });
      const firstComment = makeComment({ sourceId: "c0", attachments: [attachment] });
      const ticket = makeTicket({ comments: [firstComment] });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);
      source.downloadAttachment.mockRejectedValue(new Error("download failed"));

      const dest = mockDestination();
      const jobs = mockJobs();
      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings, jobs });
      const svc = new MigrationService(deps);

      const job = await svc.runHistoricalMigration();

      expect(dest.createTicket).toHaveBeenCalledTimes(1);
      const context = dest.createTicket.mock.calls[0][1] as TicketCreationContext;
      expect(context.attachmentTokens).toBeUndefined();
      expect(jobs.addFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "attachment", sourceId: "a1" }),
      );
    });

    it("still processes later-comment attachments separately", async () => {
      const att1 = makeAttachment({ sourceId: "a1", commentSourceId: "c0" });
      const att2 = makeAttachment({ sourceId: "a2", commentSourceId: "c1" });
      const firstComment = makeComment({ sourceId: "c0", attachments: [att1] });
      const secondComment = makeComment({ sourceId: "c1", attachments: [att2] });
      const ticket = makeTicket({ comments: [firstComment, secondComment] });

      const source = mockSource();
      source.fetchUsers.mockResolvedValue(singlePage([makeUser()]));
      source.fetchTickets.mockResolvedValue(singlePage([ticket]));
      source.fetchTicketById.mockResolvedValue(ticket);
      source.downloadAttachment.mockResolvedValue(Buffer.from("file-data"));

      const dest = mockDestination();
      dest.uploadAttachment
        .mockResolvedValueOnce({ destinationId: "token-a1" })
        .mockResolvedValueOnce({ destinationId: "token-a2" });

      const mappings = mockMappings();
      const deps = buildDeps({ source, destination: dest, mappings });
      const svc = new MigrationService(deps);

      await svc.runHistoricalMigration();

      expect(dest.uploadAttachment).toHaveBeenCalledTimes(2);
      expect(dest.createTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachmentTokens: ["token-a1"] }),
      );
      expect(dest.addComment).toHaveBeenCalledTimes(1);
    });
  });
});
