import {
  normalizeUser,
  normalizeOrganization,
  normalizeTicket,
  normalizeComment,
  normalizeAttachment,
} from "@/connectors/zendesk/zendesk.normalizers";
import {
  ZendeskUser,
  ZendeskOrganization,
  ZendeskTicket,
  ZendeskComment,
  ZendeskAttachment,
} from "@/connectors/zendesk/zendesk.types";

function makeZendeskUser(overrides: Partial<ZendeskUser> = {}): ZendeskUser {
  return {
    id: 100,
    name: "Jane Doe",
    email: "Jane@Example.com",
    phone: "+15551234567",
    role: "end-user",
    organization_id: 10,
    active: true,
    suspended: false,
    ...overrides,
  };
}

function makeZendeskOrg(
  overrides: Partial<ZendeskOrganization> = {},
): ZendeskOrganization {
  return {
    id: 10,
    name: "Acme Corp",
    details: "A customer org",
    notes: "Important client",
    domain_names: ["acme.com"],
    tags: ["vip"],
    ...overrides,
  };
}

function makeZendeskTicket(
  overrides: Partial<ZendeskTicket> = {},
): ZendeskTicket {
  return {
    id: 500,
    subject: "Help with billing",
    description: "I need help with my invoice",
    status: "open",
    priority: "normal",
    type: "question",
    requester_id: 100,
    assignee_id: 200,
    organization_id: 10,
    tags: ["billing", "urgent"],
    created_at: "2024-06-01T12:00:00Z",
    updated_at: "2024-06-02T08:30:00Z",
    custom_fields: [{ id: 999, value: "custom_value" }],
    via: { channel: "email" },
    ...overrides,
  };
}

function makeZendeskComment(
  overrides: Partial<ZendeskComment> = {},
): ZendeskComment {
  return {
    id: 1001,
    body: "plain text",
    html_body: "<p>rich text</p>",
    plain_body: "plain text",
    public: true,
    author_id: 100,
    created_at: "2024-06-01T12:05:00Z",
    attachments: [],
    ...overrides,
  };
}

function makeZendeskAttachment(
  overrides: Partial<ZendeskAttachment> = {},
): ZendeskAttachment {
  return {
    id: 2001,
    file_name: "invoice.pdf",
    content_type: "application/pdf",
    size: 102400,
    content_url: "https://company.zendesk.com/attachments/token/abc123/invoice.pdf",
    ...overrides,
  };
}

// ── User normalization ──────────────────────────────────────

describe("normalizeUser", () => {
  it("converts source ID to string", () => {
    const user = normalizeUser(makeZendeskUser({ id: 42 }));
    expect(user.sourceId).toBe("42");
  });

  it("lowercases and trims email", () => {
    const user = normalizeUser(makeZendeskUser({ email: "  FOO@Bar.com  " }));
    expect(user.email).toBe("foo@bar.com");
  });

  it("maps end-user role to end_user", () => {
    const user = normalizeUser(makeZendeskUser({ role: "end-user" }));
    expect(user.role).toBe("end_user");
  });

  it("maps agent role", () => {
    expect(normalizeUser(makeZendeskUser({ role: "agent" })).role).toBe("agent");
  });

  it("maps admin role", () => {
    expect(normalizeUser(makeZendeskUser({ role: "admin" })).role).toBe("admin");
  });

  it("sets organizationSourceId when present", () => {
    const user = normalizeUser(makeZendeskUser({ organization_id: 77 }));
    expect(user.organizationSourceId).toBe("77");
  });

  it("omits organizationSourceId when null", () => {
    const user = normalizeUser(makeZendeskUser({ organization_id: null }));
    expect(user.organizationSourceId).toBeUndefined();
  });

  it("marks suspended users as inactive", () => {
    const user = normalizeUser(
      makeZendeskUser({ active: true, suspended: true }),
    );
    expect(user.active).toBe(false);
  });

  it("normalizes blank name to placeholder", () => {
    const user = normalizeUser(makeZendeskUser({ name: "" }));
    expect(user.name).toBe("(unnamed)");
  });

  it("preserves raw response", () => {
    const raw = makeZendeskUser();
    const user = normalizeUser(raw);
    expect(user.raw).toBeDefined();
    expect((user.raw as Record<string, unknown>).id).toBe(raw.id);
  });
});

// ── Organization normalization ──────────────────────────────

describe("normalizeOrganization", () => {
  it("converts source ID to string", () => {
    const org = normalizeOrganization(makeZendeskOrg({ id: 55 }));
    expect(org.sourceId).toBe("55");
  });

  it("combines details and notes into description", () => {
    const org = normalizeOrganization(
      makeZendeskOrg({ details: "Detail", notes: "Note" }),
    );
    expect(org.description).toBe("Detail\nNote");
  });

  it("handles null details and notes gracefully", () => {
    const org = normalizeOrganization(
      makeZendeskOrg({ details: null, notes: null }),
    );
    expect(org.description).toBeUndefined();
  });

  it("preserves domain names", () => {
    const org = normalizeOrganization(
      makeZendeskOrg({ domain_names: ["a.com", "b.com"] }),
    );
    expect(org.domainNames).toEqual(["a.com", "b.com"]);
  });

  it("preserves tags", () => {
    const org = normalizeOrganization(makeZendeskOrg({ tags: ["vip", "pilot"] }));
    expect(org.tags).toEqual(["vip", "pilot"]);
  });
});

// ── Ticket normalization ────────────────────────────────────

describe("normalizeTicket", () => {
  it("converts source ID to string", () => {
    const ticket = normalizeTicket(makeZendeskTicket({ id: 999 }));
    expect(ticket.sourceId).toBe("999");
  });

  it("preserves status as-is", () => {
    const ticket = normalizeTicket(makeZendeskTicket({ status: "pending" }));
    expect(ticket.status).toBe("pending");
  });

  it("maps priority when present", () => {
    const ticket = normalizeTicket(makeZendeskTicket({ priority: "high" }));
    expect(ticket.priority).toBe("high");
  });

  it("leaves priority undefined when null", () => {
    const ticket = normalizeTicket(makeZendeskTicket({ priority: null }));
    expect(ticket.priority).toBeUndefined();
  });

  it("maps requester and assignee IDs to strings", () => {
    const ticket = normalizeTicket(
      makeZendeskTicket({ requester_id: 1, assignee_id: 2 }),
    );
    expect(ticket.requesterSourceId).toBe("1");
    expect(ticket.assigneeSourceId).toBe("2");
  });

  it("omits assignee when null", () => {
    const ticket = normalizeTicket(
      makeZendeskTicket({ assignee_id: null }),
    );
    expect(ticket.assigneeSourceId).toBeUndefined();
  });

  it("preserves channel from via object", () => {
    const ticket = normalizeTicket(
      makeZendeskTicket({ via: { channel: "web" } }),
    );
    expect(ticket.channel).toBe("web");
  });

  it("flattens custom fields into a keyed object", () => {
    const ticket = normalizeTicket(
      makeZendeskTicket({
        custom_fields: [
          { id: 111, value: "alpha" },
          { id: 222, value: 42 },
        ],
      }),
    );
    expect(ticket.customFields).toEqual({ "111": "alpha", "222": 42 });
  });

  it("preserves timestamps", () => {
    const ticket = normalizeTicket(
      makeZendeskTicket({
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      }),
    );
    expect(ticket.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(ticket.updatedAt).toBe("2024-01-02T00:00:00Z");
  });

  it("defaults to empty comments when none provided", () => {
    const ticket = normalizeTicket(makeZendeskTicket());
    expect(ticket.comments).toEqual([]);
  });

  it("includes provided comments", () => {
    const comment = normalizeComment(makeZendeskComment(), "500");
    const ticket = normalizeTicket(makeZendeskTicket({ id: 500 }), [comment]);
    expect(ticket.comments).toHaveLength(1);
    expect(ticket.comments[0].sourceId).toBe("1001");
  });
});

// ── Comment normalization ───────────────────────────────────

describe("normalizeComment", () => {
  it("converts source ID to string", () => {
    const comment = normalizeComment(makeZendeskComment({ id: 777 }), "500");
    expect(comment.sourceId).toBe("777");
  });

  it("binds comment to ticket source ID", () => {
    const comment = normalizeComment(makeZendeskComment(), "500");
    expect(comment.ticketSourceId).toBe("500");
  });

  it("preserves public visibility", () => {
    const comment = normalizeComment(
      makeZendeskComment({ public: true }),
      "500",
    );
    expect(comment.isPublic).toBe(true);
  });

  it("preserves internal (private) visibility", () => {
    const comment = normalizeComment(
      makeZendeskComment({ public: false }),
      "500",
    );
    expect(comment.isPublic).toBe(false);
  });

  it("uses plain_body for body field", () => {
    const comment = normalizeComment(
      makeZendeskComment({ plain_body: "plain version", body: "fallback" }),
      "500",
    );
    expect(comment.body).toBe("plain version");
  });

  it("falls back to body when plain_body is empty", () => {
    const comment = normalizeComment(
      makeZendeskComment({ plain_body: "", body: "fallback body" }),
      "500",
    );
    expect(comment.body).toBe("fallback body");
  });

  it("preserves html_body", () => {
    const comment = normalizeComment(
      makeZendeskComment({ html_body: "<b>bold</b>" }),
      "500",
    );
    expect(comment.htmlBody).toBe("<b>bold</b>");
  });

  it("preserves chronology via createdAt", () => {
    const comment = normalizeComment(
      makeZendeskComment({ created_at: "2024-06-15T10:00:00Z" }),
      "500",
    );
    expect(comment.createdAt).toBe("2024-06-15T10:00:00Z");
  });

  it("normalizes attachments and binds to comment ID", () => {
    const raw = makeZendeskComment({
      id: 800,
      attachments: [makeZendeskAttachment({ id: 3001 })],
    });
    const comment = normalizeComment(raw, "500");
    expect(comment.attachments).toHaveLength(1);
    expect(comment.attachments[0].commentSourceId).toBe("800");
  });
});

// ── Attachment normalization ────────────────────────────────

describe("normalizeAttachment", () => {
  it("converts source ID to string", () => {
    const att = normalizeAttachment(makeZendeskAttachment({ id: 5555 }), "800");
    expect(att.sourceId).toBe("5555");
  });

  it("preserves file metadata", () => {
    const att = normalizeAttachment(
      makeZendeskAttachment({
        file_name: "report.xlsx",
        content_type: "application/vnd.ms-excel",
        size: 204800,
      }),
      "800",
    );
    expect(att.fileName).toBe("report.xlsx");
    expect(att.contentType).toBe("application/vnd.ms-excel");
    expect(att.size).toBe(204800);
  });

  it("preserves source URL for download", () => {
    const att = normalizeAttachment(
      makeZendeskAttachment({
        content_url: "https://zendesk.com/att/token/xyz",
      }),
      "800",
    );
    expect(att.sourceUrl).toBe("https://zendesk.com/att/token/xyz");
  });

  it("binds to parent comment source ID", () => {
    const att = normalizeAttachment(makeZendeskAttachment(), "999");
    expect(att.commentSourceId).toBe("999");
  });
});
