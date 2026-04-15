import axios from "axios";
import { BoldDeskConnector } from "@/connectors/bolddesk/bolddesk.connector";
import {
  BoldDeskContact,
  BoldDeskContactGroup,
  BoldDeskContactListResponse,
  BoldDeskContactGroupListResponse,
  BoldDeskConversationItem,
  BoldDeskAttachmentUploadResult,
} from "@/connectors/bolddesk/bolddesk.types";
import { NormalizedUser, NormalizedOrganization, NormalizedTicket, NormalizedComment, NormalizedAttachment } from "@/models";
import { TicketCreationContext, CommentContext } from "@/connectors/destination.interface";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

const TEST_CONFIG = {
  baseUrl: "https://test.bolddesk.com",
  apiKey: "test-api-key",
  defaultBrandId: 1,
  ticketPortalValue: "test-portal",
};

function mockAxiosInstance() {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
  };
  mockedAxios.create.mockReturnValue(instance as any);
  mockedAxios.isAxiosError.mockReturnValue(false);
  return instance;
}

describe("BoldDeskConnector", () => {
  let http: ReturnType<typeof mockAxiosInstance>;
  let connector: BoldDeskConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    http = mockAxiosInstance();
    connector = new BoldDeskConnector(TEST_CONFIG);
  });

  // ── createContact ──────────────────────────────────────

  describe("createContact", () => {
    const user: NormalizedUser = {
      sourceId: "1",
      name: "Alice Smith",
      email: "Alice@Example.COM",
      role: "end_user",
      active: true,
    };

    it("creates a contact and returns the destination ID", async () => {
      const apiResponse: BoldDeskContact = {
        contactId: 100,
        name: "Alice Smith",
        email: "alice@example.com",
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.createContact(user);

      expect(result.destinationId).toBe("100");
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/contacts",
        expect.objectContaining({
          name: "Alice Smith",
          email: "alice@example.com",
        }),
        undefined,
      );
    });

    it("lowercases the email", async () => {
      const apiResponse: BoldDeskContact = {
        contactId: 101,
        name: "Alice Smith",
        email: "alice@example.com",
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      await connector.createContact(user);

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/contacts",
        expect.objectContaining({ email: "alice@example.com" }),
        undefined,
      );
    });

    it("falls back to email as name when name is empty", async () => {
      const noNameUser: NormalizedUser = {
        sourceId: "2",
        name: "",
        email: "bob@test.com",
        role: "end_user",
        active: true,
      };

      const apiResponse: BoldDeskContact = {
        contactId: 102,
        name: "bob@test.com",
        email: "bob@test.com",
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      await connector.createContact(noNameUser);

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/contacts",
        expect.objectContaining({ name: "bob@test.com" }),
        undefined,
      );
    });
  });

  // ── findContactByEmail ─────────────────────────────────

  describe("findContactByEmail", () => {
    it("returns destination ID when contact found", async () => {
      const apiResponse: BoldDeskContactListResponse = {
        data: [{ contactId: 200, name: "Bob", email: "bob@test.com" }],
        itemCount: 1,
        pageIndex: 1,
        pageSize: 1,
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.findContactByEmail("Bob@Test.COM");

      expect(result).toEqual({ destinationId: "200" });
      expect(http.get).toHaveBeenCalledWith(
        "/api/v1/contacts",
        expect.objectContaining({
          params: expect.objectContaining({ email: "bob@test.com" }),
        }),
      );
    });

    it("returns null when no contact found", async () => {
      const apiResponse: BoldDeskContactListResponse = {
        data: [],
        itemCount: 0,
        pageIndex: 1,
        pageSize: 1,
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.findContactByEmail("nobody@test.com");
      expect(result).toBeNull();
    });
  });

  // ── createOrganization ─────────────────────────────────

  describe("createOrganization", () => {
    const org: NormalizedOrganization = {
      sourceId: "10",
      name: "Acme Corp",
      description: "Test org",
      domainNames: ["acme.com"],
      tags: [],
    };

    it("creates a contact group and returns the destination ID", async () => {
      const apiResponse: BoldDeskContactGroup = {
        contactGroupId: 50,
        name: "Acme Corp",
        description: "Test org",
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.createOrganization(org);

      expect(result.destinationId).toBe("50");
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/contact_groups",
        expect.objectContaining({ name: "Acme Corp" }),
        undefined,
      );
    });
  });

  // ── findOrganizationByName ─────────────────────────────

  describe("findOrganizationByName", () => {
    it("returns destination ID when group found", async () => {
      const apiResponse: BoldDeskContactGroupListResponse = {
        data: [{ contactGroupId: 50, name: "Acme Corp" }],
        itemCount: 1,
        pageIndex: 1,
        pageSize: 1,
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.findOrganizationByName("Acme Corp");
      expect(result).toEqual({ destinationId: "50" });
    });

    it("returns null when group not found", async () => {
      const apiResponse: BoldDeskContactGroupListResponse = {
        data: [],
        itemCount: 0,
        pageIndex: 1,
        pageSize: 1,
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.findOrganizationByName("Nobody Inc");
      expect(result).toBeNull();
    });
  });

  // ── createTicket ───────────────────────────────────────

  describe("createTicket", () => {
    const ticket: NormalizedTicket = {
      sourceId: "500",
      subject: "Test Ticket",
      description: "Help please",
      htmlDescription: "<p>Help please</p>",
      status: "open",
      priority: "high",
      requesterSourceId: "1",
      tags: ["billing", "urgent"],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      comments: [],
      customFields: {},
    };

    const context: TicketCreationContext = {
      requesterEmail: "alice@example.com",
      requesterName: "Alice",
    };

    it("creates a ticket with mapped status and priority", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1000, isFileUploadSuccess: true } });

      const result = await connector.createTicket(ticket, context);

      expect(result.destinationId).toBe("1000");
      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.brandId).toBe(1);
      expect(callBody.subject).toBe("Test Ticket");
      expect(callBody.requesterEmailId).toBe("alice@example.com");
      expect(callBody.priorityId).toBe(3);
      expect(callBody.statusId).toBe(2);
      expect(callBody.tags).toEqual(["billing", "urgent"]);
      expect(callBody.isVisibleInCustomerPortal).toBe(true);
      expect(callBody.ticketPortalValue).toBe("test-portal");
      expect(callBody.description).toContain("Migrated from Zendesk");
      expect(callBody.description).toContain("Ticket #500");
      expect(callBody.description).toContain("<p>Help please</p>");
    });

    it("defaults priority to medium when not set", async () => {
      const noPriorityTicket: NormalizedTicket = {
        ...ticket,
        priority: undefined,
      };

      http.post.mockResolvedValueOnce({ data: { id: 1001, isFileUploadSuccess: true } });

      await connector.createTicket(noPriorityTicket, context);

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ priorityId: 2 }),
        { params: { skipDependencyValidation: true } },
      );
    });

    it("passes contactGroupDestId when provided", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1002, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, {
        requesterEmail: "alice@example.com",
        requesterName: "Alice",
        contactGroupDestId: "50",
      });

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ contactGroupId: 50 }),
        { params: { skipDependencyValidation: true } },
      );
    });

    it("includes ticketPortalValue from config", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1008, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.ticketPortalValue).toBe("test-portal");
    });

    it("sets agentId when assigneeAgentId is provided", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1003, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, {
        requesterEmail: "alice@example.com",
        requesterName: "Alice",
        assigneeAgentId: 42,
      });

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ agentId: 42 }),
        { params: { skipDependencyValidation: true } },
      );
    });

    it("sets groupId when provided in context", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1009, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, {
        requesterEmail: "alice@example.com",
        requesterName: "Alice",
        groupId: 3,
      });

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ groupId: 3 }),
        { params: { skipDependencyValidation: true } },
      );
    });

    it("omits groupId when not provided in context", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1010, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.groupId).toBeUndefined();
    });

    it("omits agentId when assigneeAgentId is not provided", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1004, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.agentId).toBeUndefined();
    });

    it("sends attachmentTokens as comma-separated string", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1005, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, {
        requesterEmail: "alice@example.com",
        requesterName: "Alice",
        attachmentTokens: ["tok-1", "tok-2"],
      });

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ attachments: "tok-1,tok-2" }),
        { params: { skipDependencyValidation: true } },
      );
    });

    it("sends single attachmentToken as string (not array)", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1007, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, {
        requesterEmail: "alice@example.com",
        requesterName: "Alice",
        attachmentTokens: ["tok-single"],
      });

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.attachments).toBe("tok-single");
      expect(typeof callBody.attachments).toBe("string");
    });

    it("omits attachments when no tokens provided", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 1006, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.attachments).toBeUndefined();
    });

    it("sets Topic in customFields as BoldDesk dropdown ID", async () => {
      const topicConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        topicFieldKey: "cf_topic",
        topicTagToIdMap: new Map([
          ["customer_support", 22],
        ]),
      });

      const topicTicket: NormalizedTicket = {
        ...ticket,
        customFields: { "29599516755099": "customer_support" },
      };

      http.post.mockResolvedValueOnce({ data: { id: 2000, isFileUploadSuccess: true } });

      await topicConnector.createTicket(topicTicket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toEqual({ cf_topic: 22 });
    });

    it("throws when source ticket has a topic tag but no bolddesk_id mapping", async () => {
      const topicConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        topicFieldKey: "cf_topic",
        topicTagToIdMap: new Map(),
      });

      const unmappedTicket: NormalizedTicket = {
        ...ticket,
        customFields: { "29599516755099": "unmapped_tag" },
      };

      await expect(
        topicConnector.createTicket(unmappedTicket, context),
      ).rejects.toThrow(/Topic mapping failed/);

      expect(http.post).not.toHaveBeenCalled();
    });

    it("omits Topic from customFields when source ticket has no topic", async () => {
      const topicConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        topicFieldKey: "cf_topic",
        topicTagToIdMap: new Map([["customer_support", 22]]),
      });

      http.post.mockResolvedValueOnce({ data: { id: 2001, isFileUploadSuccess: true } });

      await topicConnector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toBeUndefined();
    });

    it("strips tagger-injected tags from the tag list", async () => {
      const taggerConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        taggerTags: new Set(["customer_support", "call_-_wfg"]),
      });

      const taggedTicket: NormalizedTicket = {
        ...ticket,
        tags: ["customer_support", "billing", "call_-_wfg", "vip"],
      };

      http.post.mockResolvedValueOnce({ data: { id: 2002, isFileUploadSuccess: true } });

      await taggerConnector.createTicket(taggedTicket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.tags).toEqual(["billing", "vip"]);
    });

    it("sets Zendesk source ID in customFields when zdIdFieldKey is configured", async () => {
      const zdIdConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        zdIdFieldKey: "cf_zendesk_id",
      });

      http.post.mockResolvedValueOnce({ data: { id: 2010, isFileUploadSuccess: true } });

      await zdIdConnector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toEqual(
        expect.objectContaining({ cf_zendesk_id: "500" }),
      );
    });

    it("omits Zendesk source ID from customFields when zdIdFieldKey is not set", async () => {
      http.post.mockResolvedValueOnce({ data: { id: 2011, isFileUploadSuccess: true } });

      await connector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toBeUndefined();
    });

    it("topic is NOT duplicated as a tag when tagger stripping is active", async () => {
      const fullConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        topicFieldKey: "cf_topic",
        topicTagToIdMap: new Map([
          ["exam_support", 24],
        ]),
        taggerTags: new Set(["exam_support", "wfg"]),
      });

      const topicTagTicket: NormalizedTicket = {
        ...ticket,
        tags: ["exam_support", "billing", "wfg"],
        customFields: { "29599516755099": "exam_support" },
      };

      http.post.mockResolvedValueOnce({ data: { id: 2003, isFileUploadSuccess: true } });

      await fullConnector.createTicket(topicTagTicket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.tags).toEqual(["billing"]);
      expect(callBody.customFields).toEqual({ cf_topic: 24 });
    });

    it("sets Organization in customFields as BoldDesk dropdown ID", async () => {
      const orgConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        organizationFieldKey: "cf_organization",
        organizationTagToIdMap: new Map([["wfg", 62]]),
      });

      const orgTicket: NormalizedTicket = {
        ...ticket,
        customFields: { "33084594878747": "wfg" },
      };

      http.post.mockResolvedValueOnce({ data: { id: 2100, isFileUploadSuccess: true } });

      await orgConnector.createTicket(orgTicket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toEqual({ cf_organization: 62 });
    });

    it("throws when Organization custom field has unknown tag", async () => {
      const orgConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        organizationFieldKey: "cf_organization",
        organizationTagToIdMap: new Map([["wfg", 62]]),
      });

      const badOrgTicket: NormalizedTicket = {
        ...ticket,
        customFields: { "33084594878747": "not_in_csv" },
      };

      await expect(orgConnector.createTicket(badOrgTicket, context)).rejects.toThrow(
        /Organization field mapping failed/,
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it("throws Organization mapping error when field key unset but source Organization is unmapped", async () => {
      const orgConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        organizationTagToIdMap: new Map(),
      });

      const badOrgTicket: NormalizedTicket = {
        ...ticket,
        customFields: { "33084594878747": "wfg" },
      };

      await expect(orgConnector.createTicket(badOrgTicket, context)).rejects.toThrow(
        /Organization field mapping failed/,
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it("omits Organization from customFields when source ticket has no Organization field", async () => {
      const orgConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        organizationFieldKey: "cf_organization",
        organizationTagToIdMap: new Map([["wfg", 62]]),
      });

      http.post.mockResolvedValueOnce({ data: { id: 2101, isFileUploadSuccess: true } });

      await orgConnector.createTicket(ticket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toBeUndefined();
    });

    it("adds Organization custom field without breaking contactGroupId", async () => {
      const orgConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        organizationFieldKey: "cf_organization",
        organizationTagToIdMap: new Map([["wfg", 62]]),
      });

      const orgTicket: NormalizedTicket = {
        ...ticket,
        customFields: { "33084594878747": "wfg" },
      };

      http.post.mockResolvedValueOnce({ data: { id: 2102, isFileUploadSuccess: true } });

      await orgConnector.createTicket(orgTicket, {
        ...context,
        contactGroupDestId: "99",
      });

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.contactGroupId).toBe(99);
      expect(callBody.customFields).toEqual({ cf_organization: 62 });
    });

    it("does not duplicate Organization tagger tag in tags", async () => {
      const orgConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        organizationFieldKey: "cf_organization",
        organizationTagToIdMap: new Map([["wfg", 62]]),
        taggerTags: new Set(["wfg"]),
      });

      const orgTicket: NormalizedTicket = {
        ...ticket,
        tags: ["wfg", "billing", "vip"],
        customFields: { "33084594878747": "wfg" },
      };

      http.post.mockResolvedValueOnce({ data: { id: 2103, isFileUploadSuccess: true } });

      await orgConnector.createTicket(orgTicket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.tags).toEqual(["billing", "vip"]);
      expect(callBody.customFields).toEqual({ cf_organization: 62 });
    });

    it("keeps Topic mapping when Organization is also set", async () => {
      const fullConnector = new BoldDeskConnector({
        ...TEST_CONFIG,
        topicFieldKey: "cf_topic",
        topicTagToIdMap: new Map([["exam_support", 24]]),
        organizationFieldKey: "cf_organization",
        organizationTagToIdMap: new Map([["wfg", 62]]),
      });

      const bothTicket: NormalizedTicket = {
        ...ticket,
        customFields: {
          "29599516755099": "exam_support",
          "33084594878747": "wfg",
        },
      };

      http.post.mockResolvedValueOnce({ data: { id: 2104, isFileUploadSuccess: true } });

      await fullConnector.createTicket(bothTicket, context);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.customFields).toEqual({
        cf_topic: 24,
        cf_organization: 62,
      });
    });
  });

  // ── addComment ─────────────────────────────────────────

  describe("addComment", () => {
    const publicComment: NormalizedComment = {
      sourceId: "2001",
      ticketSourceId: "500",
      authorSourceId: "1",
      body: "Public reply",
      htmlBody: "<p>Public reply</p>",
      isPublic: true,
      createdAt: "2024-01-01T01:00:00Z",
      attachments: [],
    };

    const privateNote: NormalizedComment = {
      sourceId: "2002",
      ticketSourceId: "500",
      authorSourceId: "2",
      body: "Internal note",
      htmlBody: "<p>Internal note</p>",
      isPublic: false,
      createdAt: "2024-01-01T02:00:00Z",
      attachments: [],
    };

    it("sends public comments to the updates endpoint with provenance", async () => {
      const apiResponse: BoldDeskConversationItem = {
        conversationItemId: 3001,
        ticketId: 1000,
        content: "<p>Public reply</p>",
        isPrivate: false,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const commentCtx: CommentContext = { authorEmail: "alice@example.com", authorName: "Alice" };
      const result = await connector.addComment("1000", publicComment, undefined, commentCtx);

      expect(result.destinationId).toBe("3001");
      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.description).toContain("Original Reply");
      expect(callBody.description).toContain("Alice (alice@example.com)");
      expect(callBody.description).toContain("2024-01-01T01:00:00Z");
      expect(callBody.description).toContain("<p>Public reply</p>");
      expect(callBody.skipEmailNotification).toBe(true);
      expect(callBody.updatedByuserIdorEmailId).toBe("alice@example.com");
    });

    it("sends private notes to the notes endpoint with provenance", async () => {
      const apiResponse: BoldDeskConversationItem = {
        conversationItemId: 3002,
        ticketId: 1000,
        content: "<p>Internal note</p>",
        isPrivate: true,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const commentCtx: CommentContext = { authorEmail: "agent@co.com", authorName: "Agent" };
      const result = await connector.addComment("1000", privateNote, undefined, commentCtx);

      expect(result.destinationId).toBe("3002");
      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.description).toContain("Original Note");
      expect(callBody.description).toContain("Agent (agent@co.com)");
      expect(callBody.description).toContain("<p>Internal note</p>");
      expect(callBody.isPublicNote).toBe(false);
      expect(callBody.updatedByuserIdorEmailId).toBe("agent@co.com");
    });

    it("includes provenance with sourceId when no author context given", async () => {
      const apiResponse: BoldDeskConversationItem = {
        conversationItemId: 3004,
        ticketId: 1000,
        content: "<p>Public reply</p>",
        isPrivate: false,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      await connector.addComment("1000", publicComment);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.description).toContain("Zendesk user #1");
      expect(callBody.description).toContain("<p>Public reply</p>");
    });

    it("prefers htmlBody over plain body", async () => {
      const plainOnly: NormalizedComment = {
        ...publicComment,
        htmlBody: undefined,
      };

      const apiResponse: BoldDeskConversationItem = {
        conversationItemId: 3003,
        ticketId: 1000,
        content: "Public reply",
        isPrivate: false,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      await connector.addComment("1000", plainOnly);

      const callBody = http.post.mock.calls[0][1] as Record<string, unknown>;
      expect(callBody.description).toContain("Public reply");
    });
  });

  // ── uploadAttachment ───────────────────────────────────

  describe("uploadAttachment", () => {
    const attachment: NormalizedAttachment = {
      sourceId: "4001",
      fileName: "screenshot.png",
      contentType: "image/png",
      size: 1024,
      sourceUrl: "https://zendesk.com/files/screenshot.png",
      commentSourceId: "2001",
    };

    it("uploads via multipart and returns the token", async () => {
      const apiResponse: BoldDeskAttachmentUploadResult = {
        token: "att_token_123",
        url: "https://bolddesk.com/files/screenshot.png",
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const buffer = Buffer.from("fake-png-data");
      const result = await connector.uploadAttachment(attachment, buffer);

      expect(result.destinationId).toBe("att_token_123");
      expect(http.post).toHaveBeenCalledTimes(1);
    });
  });
});
