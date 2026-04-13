import { parseAgentCSV } from "@/transform/agent-csv.loader";
import pino from "pino";

const logger = pino({ level: "silent" });

describe("parseAgentCSV", () => {
  it("parses valid CSV into AgentMapping[]", () => {
    const csv = [
      "Full Name,email,Role,Group,bolddesk_id",
      "Alice,alice@co.com,Agent,Support,100",
      "Bob,bob@co.com,Admin,Support,200",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toEqual([
      { email: "alice@co.com", agentId: 100 },
      { email: "bob@co.com", agentId: 200 },
    ]);
    expect(result.skipped).toBe(0);
    expect(result.duplicates).toBe(0);
  });

  it("normalizes emails to lowercase", () => {
    const csv = [
      "Full Name,email,Role,Group,bolddesk_id",
      "Alice,Alice@CO.COM,Agent,Support,100",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings[0].email).toBe("alice@co.com");
  });

  it("trims whitespace from email and bolddesk_id", () => {
    const csv = [
      "Full Name,email ,Role,Group, bolddesk_id",
      "Alice, alice@co.com ,Agent,Support, 100 ",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings[0]).toEqual({ email: "alice@co.com", agentId: 100 });
  });

  it("skips rows with missing email", () => {
    const csv = [
      "Full Name,email,Role,Group,bolddesk_id",
      "NoEmail,,Agent,Support,100",
      "Valid,valid@co.com,Agent,Support,200",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].email).toBe("valid@co.com");
    expect(result.skipped).toBe(1);
  });

  it("skips rows with missing bolddesk_id", () => {
    const csv = [
      "Full Name,email,Role,Group,bolddesk_id",
      "NoId,noid@co.com,Agent,Support,",
      "Valid,valid@co.com,Agent,Support,200",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("skips rows with non-numeric bolddesk_id", () => {
    const csv = [
      "Full Name,email,Role,Group,bolddesk_id",
      "Bad,bad@co.com,Agent,Support,abc",
      "Good,good@co.com,Agent,Support,300",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("deduplicates by email — keeps first occurrence", () => {
    const csv = [
      "Full Name,email,Role,Group,bolddesk_id",
      "Alice,alice@co.com,Agent,Support,100",
      "Alice2,alice@co.com,Agent,Other,200",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].agentId).toBe(100);
    expect(result.duplicates).toBe(1);
  });

  it("returns empty mappings for empty CSV", () => {
    const result = parseAgentCSV("", logger);
    expect(result.mappings).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  it("returns empty mappings for header-only CSV", () => {
    const csv = "Full Name,email,Role,Group,bolddesk_id";
    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toEqual([]);
  });

  it("handles the actual agents.csv format with whitespace in headers", () => {
    const csv = [
      "Full Name,email ,Role,Group, bolddesk_id",
      "Oliver Admin,product@oliversolutions.com,Admin,Student Experience Center, 1000",
      "Memory Dube,mdube@oliversolutions.com,Agent,Student Experience Center, 1007",
    ].join("\n");

    const result = parseAgentCSV(csv, logger);
    expect(result.mappings).toEqual([
      { email: "product@oliversolutions.com", agentId: 1000 },
      { email: "mdube@oliversolutions.com", agentId: 1007 },
    ]);
  });
});
