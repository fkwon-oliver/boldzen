import { mapTicketPriority } from "@/transform/priority.mapper";

describe("mapTicketPriority", () => {
  it("maps low → low", () => {
    expect(mapTicketPriority("low")).toBe("low");
  });

  it("maps normal → medium", () => {
    expect(mapTicketPriority("normal")).toBe("medium");
  });

  it("maps high → high", () => {
    expect(mapTicketPriority("high")).toBe("high");
  });

  it("maps urgent → urgent", () => {
    expect(mapTicketPriority("urgent")).toBe("urgent");
  });

  it("returns undefined for undefined input", () => {
    expect(mapTicketPriority(undefined)).toBeUndefined();
  });

  it("throws on unknown priority", () => {
    expect(() => mapTicketPriority("critical" as any)).toThrow(
      "Unknown Zendesk priority",
    );
  });
});
