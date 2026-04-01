import { transformComment } from "@/transform/comment.transformer";
import { NormalizedComment } from "@/models";

function makeComment(overrides: Partial<NormalizedComment> = {}): NormalizedComment {
  return {
    sourceId: "100",
    ticketSourceId: "1",
    authorSourceId: "10",
    body: "plain text body",
    isPublic: true,
    createdAt: "2024-01-01T00:00:00Z",
    attachments: [],
    ...overrides,
  };
}

describe("transformComment", () => {
  it("preserves public visibility", () => {
    const result = transformComment(makeComment({ isPublic: true }));
    expect(result.isPublic).toBe(true);
  });

  it("preserves internal (private) visibility", () => {
    const result = transformComment(makeComment({ isPublic: false }));
    expect(result.isPublic).toBe(false);
  });

  it("prefers htmlBody when available", () => {
    const result = transformComment(
      makeComment({ body: "plain", htmlBody: "<p>rich</p>" }),
    );
    expect(result.body).toBe("<p>rich</p>");
  });

  it("falls back to plain body when htmlBody is missing", () => {
    const result = transformComment(makeComment({ htmlBody: undefined }));
    expect(result.body).toBe("plain text body");
  });

  it("extracts attachment source IDs", () => {
    const result = transformComment(
      makeComment({
        attachments: [
          {
            sourceId: "att-1",
            fileName: "f.png",
            contentType: "image/png",
            size: 1024,
            sourceUrl: "https://example.com/f.png",
            commentSourceId: "100",
          },
        ],
      }),
    );
    expect(result.attachmentSourceIds).toEqual(["att-1"]);
  });
});
