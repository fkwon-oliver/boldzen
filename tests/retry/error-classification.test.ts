import {
  isTransientError,
  ConnectorError,
  MigrationError,
  MappingNotFoundError,
} from "@/errors";

describe("isTransientError", () => {
  it("classifies 429 as transient", () => {
    const err = new ConnectorError("Rate limited", "bolddesk", 429);
    expect(isTransientError(err)).toBe(true);
  });

  it("classifies 5xx as transient", () => {
    expect(isTransientError(new ConnectorError("Server error", "zendesk", 500))).toBe(true);
    expect(isTransientError(new ConnectorError("Gateway", "bolddesk", 502))).toBe(true);
    expect(isTransientError(new ConnectorError("Timeout", "zendesk", 504))).toBe(true);
  });

  it("classifies network error (no status) as transient", () => {
    const err = new ConnectorError("ECONNREFUSED", "zendesk", undefined);
    expect(isTransientError(err)).toBe(true);
  });

  it("classifies 4xx (except 429) as permanent", () => {
    expect(isTransientError(new ConnectorError("Bad request", "bolddesk", 400))).toBe(false);
    expect(isTransientError(new ConnectorError("Not found", "zendesk", 404))).toBe(false);
    expect(isTransientError(new ConnectorError("Forbidden", "bolddesk", 403))).toBe(false);
    expect(isTransientError(new ConnectorError("Conflict", "zendesk", 409))).toBe(false);
  });

  it("classifies MappingNotFoundError as permanent", () => {
    const err = new MappingNotFoundError("user", "u1");
    expect(isTransientError(err)).toBe(false);
  });

  it("classifies MigrationError as permanent", () => {
    const err = new MigrationError("Data issue", "ticket", "t1");
    expect(isTransientError(err)).toBe(false);
  });

  it("classifies unknown errors as transient (safe to retry)", () => {
    expect(isTransientError(new Error("something unexpected"))).toBe(true);
    expect(isTransientError("string error")).toBe(true);
    expect(isTransientError(null)).toBe(true);
  });
});
