import {
  buildTicketProvenanceBlock,
  buildCommentProvenanceHeader,
} from "@/transform/provenance";

describe("buildTicketProvenanceBlock", () => {
  it("includes Zendesk ticket ID and both timestamps", () => {
    const html = buildTicketProvenanceBlock({
      zendeskTicketId: "12345",
      createdAt: "2024-01-15T10:30:00Z",
      updatedAt: "2024-01-16T14:00:00Z",
    });

    expect(html).toContain("Migrated from Zendesk");
    expect(html).toContain("Ticket #12345");
    expect(html).toContain("Created: 2024-01-15T10:30:00Z");
    expect(html).toContain("Updated: 2024-01-16T14:00:00Z");
  });

  it("returns an HTML block", () => {
    const html = buildTicketProvenanceBlock({
      zendeskTicketId: "1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    expect(html).toMatch(/^<div .+<\/div>$/);
  });
});

describe("buildCommentProvenanceHeader", () => {
  it("includes author name and email when provided", () => {
    const html = buildCommentProvenanceHeader({
      authorName: "Alice Smith",
      authorEmail: "alice@example.com",
      authorSourceId: "42",
      createdAt: "2024-01-15T11:00:00Z",
      isPublic: true,
    });

    expect(html).toContain("Original Reply");
    expect(html).toContain("Alice Smith (alice@example.com)");
    expect(html).toContain("Posted: 2024-01-15T11:00:00Z");
  });

  it("labels private comments as Note", () => {
    const html = buildCommentProvenanceHeader({
      authorName: "Agent",
      authorEmail: "agent@co.com",
      authorSourceId: "99",
      createdAt: "2024-01-15T12:00:00Z",
      isPublic: false,
    });

    expect(html).toContain("Original Note");
  });

  it("falls back to email when name is missing", () => {
    const html = buildCommentProvenanceHeader({
      authorEmail: "alice@example.com",
      authorSourceId: "42",
      createdAt: "2024-01-15T11:00:00Z",
      isPublic: true,
    });

    expect(html).toContain("alice@example.com");
    expect(html).not.toContain("undefined");
  });

  it("falls back to Zendesk user sourceId when both name and email are missing", () => {
    const html = buildCommentProvenanceHeader({
      authorSourceId: "42",
      createdAt: "2024-01-15T11:00:00Z",
      isPublic: true,
    });

    expect(html).toContain("Zendesk user #42");
  });
});
