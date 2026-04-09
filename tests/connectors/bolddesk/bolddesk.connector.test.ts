import axios from "axios";
import { BoldDeskConnector } from "@/connectors/bolddesk/bolddesk.connector";
import {
  BoldDeskContact,
  BoldDeskContactGroup,
  BoldDeskContactListResponse,
  BoldDeskContactGroupListResponse,
  BoldDeskTicket,
  BoldDeskConversationItem,
  BoldDeskAttachmentUploadResult,
} from "@/connectors/bolddesk/bolddesk.types";
import { NormalizedUser, NormalizedOrganization, NormalizedTicket, NormalizedComment, NormalizedAttachment } from "@/models";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

const TEST_CONFIG = {
  baseUrl: "https://test.bolddesk.com",
  apiKey: "test-api-key",
  defaultBrandId: 1,
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

    const context = { requesterEmail: "alice@example.com" };

    it("creates a ticket with mapped status and priority", async () => {
      const apiResponse: BoldDeskTicket = {
        ticketId: 1000,
        subject: "Test Ticket",
        description: "<p>Help please</p>",
        statusId: 2,
        priorityId: 3,
        contactId: 100,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.createTicket(ticket, context);

      expect(result.destinationId).toBe("1000");
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({
          brandId: 1,
          subject: "Test Ticket",
          description: "<p>Help please</p>",
          requesterEmailId: "alice@example.com",
          priorityId: 3,
          statusId: 2,
          tags: ["billing", "urgent"],
          isVisibleInCustomerPortal: true,
        }),
      );
    });

    it("defaults priority to medium when not set", async () => {
      const noPriorityTicket: NormalizedTicket = {
        ...ticket,
        priority: undefined,
      };

      const apiResponse: BoldDeskTicket = {
        ticketId: 1001,
        subject: "Test Ticket",
        description: "<p>Help please</p>",
        statusId: 2,
        priorityId: 2,
        contactId: 100,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      await connector.createTicket(noPriorityTicket, context);

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ priorityId: 2 }),
      );
    });

    it("passes contactGroupDestId when provided", async () => {
      const apiResponse: BoldDeskTicket = {
        ticketId: 1002,
        subject: "Test Ticket",
        description: "<p>Help please</p>",
        statusId: 2,
        priorityId: 3,
        contactId: 100,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      await connector.createTicket(ticket, {
        requesterEmail: "alice@example.com",
        contactGroupDestId: "50",
      });

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1.0/tickets",
        expect.objectContaining({ contactGroupId: 50 }),
      );
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

    it("sends public comments to the updates endpoint", async () => {
      const apiResponse: BoldDeskConversationItem = {
        conversationItemId: 3001,
        ticketId: 1000,
        content: "<p>Public reply</p>",
        isPrivate: false,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.addComment("1000", publicComment);

      expect(result.destinationId).toBe("3001");
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/1000/updates",
        expect.objectContaining({
          description: "<p>Public reply</p>",
          skipEmailNotification: true,
        }),
      );
    });

    it("sends private notes to the notes endpoint", async () => {
      const apiResponse: BoldDeskConversationItem = {
        conversationItemId: 3002,
        ticketId: 1000,
        content: "<p>Internal note</p>",
        isPrivate: true,
      };

      http.post.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.addComment("1000", privateNote);

      expect(result.destinationId).toBe("3002");
      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/tickets/1000/notes",
        expect.objectContaining({
          description: "<p>Internal note</p>",
          isPublicNote: false,
        }),
      );
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

      expect(http.post).toHaveBeenCalledWith(
        "/api/v1/1000/updates",
        expect.objectContaining({ description: "Public reply" }),
      );
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
