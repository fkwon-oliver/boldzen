import { mapTicketStatus } from "@/transform/status.mapper";

describe("mapTicketStatus", () => {
  it("maps new → new", () => {
    expect(mapTicketStatus("new")).toBe("new");
  });

  it("maps open → open", () => {
    expect(mapTicketStatus("open")).toBe("open");
  });

  it("maps pending → pending", () => {
    expect(mapTicketStatus("pending")).toBe("pending");
  });

  it("maps hold → on_hold", () => {
    expect(mapTicketStatus("hold")).toBe("on_hold");
  });

  it("maps solved → resolved", () => {
    expect(mapTicketStatus("solved")).toBe("resolved");
  });

  it("maps closed → closed", () => {
    expect(mapTicketStatus("closed")).toBe("closed");
  });

  it("throws on unknown status", () => {
    expect(() => mapTicketStatus("invalid" as any)).toThrow("Unknown Zendesk status");
  });
});
