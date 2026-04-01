import axios from "axios";
import { ZendeskConnector } from "@/connectors/zendesk/zendesk.connector";
import {
  ZendeskUsersResponse,
  ZendeskOrganizationsResponse,
  ZendeskTicketsResponse,
  ZendeskTicketResponse,
  ZendeskCommentsResponse,
} from "@/connectors/zendesk/zendesk.types";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

const TEST_CONFIG = {
  subdomain: "testco",
  email: "admin@test.com",
  apiToken: "test-token",
};

function mockAxiosInstance() {
  const instance = {
    get: jest.fn(),
  };
  mockedAxios.create.mockReturnValue(instance as any);
  mockedAxios.isAxiosError.mockReturnValue(false);
  return instance;
}

describe("ZendeskConnector", () => {
  let http: ReturnType<typeof mockAxiosInstance>;
  let connector: ZendeskConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    http = mockAxiosInstance();
    connector = new ZendeskConnector(TEST_CONFIG);
  });

  // ── fetchUsers ──────────────────────────────────────────

  describe("fetchUsers", () => {
    it("returns normalized users with pagination metadata", async () => {
      const apiResponse: ZendeskUsersResponse = {
        users: [
          {
            id: 1,
            name: "Alice",
            email: "alice@example.com",
            phone: null,
            role: "end-user",
            organization_id: null,
            active: true,
            suspended: false,
          },
        ],
        meta: { has_more: true, after_cursor: "cursor_abc" },
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.fetchUsers();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].sourceId).toBe("1");
      expect(result.data[0].email).toBe("alice@example.com");
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("cursor_abc");
    });

    it("passes cursor through to API params", async () => {
      const apiResponse: ZendeskUsersResponse = {
        users: [],
        meta: { has_more: false, after_cursor: "" },
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      await connector.fetchUsers("page2_cursor");

      expect(http.get).toHaveBeenCalledWith(
        "/users",
        expect.objectContaining({
          params: expect.objectContaining({
            "page[after]": "page2_cursor",
          }),
        }),
      );
    });

    it("omits nextCursor when no more pages", async () => {
      const apiResponse: ZendeskUsersResponse = {
        users: [],
        meta: { has_more: false, after_cursor: "" },
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.fetchUsers();
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  // ── fetchOrganizations ──────────────────────────────────

  describe("fetchOrganizations", () => {
    it("returns normalized organizations", async () => {
      const apiResponse: ZendeskOrganizationsResponse = {
        organizations: [
          {
            id: 10,
            name: "Acme",
            details: null,
            notes: null,
            domain_names: ["acme.com"],
            tags: [],
          },
        ],
        meta: { has_more: false, after_cursor: "" },
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.fetchOrganizations();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].sourceId).toBe("10");
      expect(result.data[0].name).toBe("Acme");
      expect(result.hasMore).toBe(false);
    });
  });

  // ── fetchTickets ────────────────────────────────────────

  describe("fetchTickets", () => {
    it("returns normalized ticket shells without comments", async () => {
      const apiResponse: ZendeskTicketsResponse = {
        tickets: [
          {
            id: 500,
            subject: "Issue",
            description: "Help",
            status: "open",
            priority: null,
            type: null,
            requester_id: 1,
            assignee_id: null,
            organization_id: null,
            tags: [],
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            custom_fields: [],
            via: { channel: "email" },
          },
        ],
        meta: { has_more: false, after_cursor: "" },
      };

      http.get.mockResolvedValueOnce({ data: apiResponse });

      const result = await connector.fetchTickets();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].sourceId).toBe("500");
      expect(result.data[0].comments).toEqual([]);
      expect(result.data[0].priority).toBeUndefined();
    });
  });

  // ── fetchTicketById ─────────────────────────────────────

  describe("fetchTicketById", () => {
    it("fetches ticket with all comments", async () => {
      const ticketResponse: ZendeskTicketResponse = {
        ticket: {
          id: 500,
          subject: "Issue",
          description: "Help",
          status: "open",
          priority: "high",
          type: null,
          requester_id: 1,
          assignee_id: 2,
          organization_id: 10,
          tags: ["billing"],
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          custom_fields: [],
          via: { channel: "email" },
        },
      };

      const commentsResponse: ZendeskCommentsResponse = {
        comments: [
          {
            id: 1001,
            body: "First reply",
            html_body: "<p>First reply</p>",
            plain_body: "First reply",
            public: true,
            author_id: 1,
            created_at: "2024-01-01T00:05:00Z",
            attachments: [],
          },
          {
            id: 1002,
            body: "Internal note",
            html_body: "<p>Internal note</p>",
            plain_body: "Internal note",
            public: false,
            author_id: 2,
            created_at: "2024-01-01T01:00:00Z",
            attachments: [],
          },
        ],
        meta: { has_more: false, after_cursor: "" },
      };

      http.get
        .mockResolvedValueOnce({ data: ticketResponse })
        .mockResolvedValueOnce({ data: commentsResponse });

      const ticket = await connector.fetchTicketById("500");

      expect(ticket.sourceId).toBe("500");
      expect(ticket.priority).toBe("high");
      expect(ticket.comments).toHaveLength(2);
      expect(ticket.comments[0].isPublic).toBe(true);
      expect(ticket.comments[1].isPublic).toBe(false);
    });

    it("paginates through all comment pages", async () => {
      const ticketResponse: ZendeskTicketResponse = {
        ticket: {
          id: 500,
          subject: "Issue",
          description: "Help",
          status: "open",
          priority: null,
          type: null,
          requester_id: 1,
          assignee_id: null,
          organization_id: null,
          tags: [],
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          custom_fields: [],
          via: { channel: "email" },
        },
      };

      const commentsPage1: ZendeskCommentsResponse = {
        comments: [
          {
            id: 1,
            body: "c1",
            html_body: "c1",
            plain_body: "c1",
            public: true,
            author_id: 1,
            created_at: "2024-01-01T00:00:00Z",
            attachments: [],
          },
        ],
        meta: { has_more: true, after_cursor: "page2" },
      };

      const commentsPage2: ZendeskCommentsResponse = {
        comments: [
          {
            id: 2,
            body: "c2",
            html_body: "c2",
            plain_body: "c2",
            public: false,
            author_id: 2,
            created_at: "2024-01-01T01:00:00Z",
            attachments: [],
          },
        ],
        meta: { has_more: false, after_cursor: "" },
      };

      http.get
        .mockResolvedValueOnce({ data: ticketResponse })
        .mockResolvedValueOnce({ data: commentsPage1 })
        .mockResolvedValueOnce({ data: commentsPage2 });

      const ticket = await connector.fetchTicketById("500");

      expect(ticket.comments).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(3);
    });
  });
});
