import { AgentResolver, AgentMapping } from "@/transform/agent.resolver";
import pino from "pino";

const logger = pino({ level: "silent" });

const STATIC_MAPPINGS: AgentMapping[] = [
  { email: "mdube@oliversolutions.com", agentId: 101 },
  { email: "szhang@oliversolutions.com", agentId: 102 },
  { email: "nconnors@oliversolutions.com", agentId: 103 },
];

describe("AgentResolver", () => {
  describe("static map resolution", () => {
    it("resolves a known email to its agentId", async () => {
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger);
      const id = await resolver.resolve("mdube@oliversolutions.com");
      expect(id).toBe(101);
    });

    it("is case-insensitive", async () => {
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger);
      const id = await resolver.resolve("SZHANG@OliverSolutions.COM");
      expect(id).toBe(102);
    });

    it("trims whitespace", async () => {
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger);
      const id = await resolver.resolve("  nconnors@oliversolutions.com  ");
      expect(id).toBe(103);
    });

    it("returns undefined for unknown email when no fallback", async () => {
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger);
      const id = await resolver.resolve("unknown@example.com");
      expect(id).toBeUndefined();
    });
  });

  describe("API fallback", () => {
    it("calls fallback when static map misses", async () => {
      const fallback = jest.fn().mockResolvedValue(200);
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger, fallback);

      const id = await resolver.resolve("new-agent@example.com");
      expect(id).toBe(200);
      expect(fallback).toHaveBeenCalledWith("new-agent@example.com");
    });

    it("does not call fallback when static map hits", async () => {
      const fallback = jest.fn().mockResolvedValue(999);
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger, fallback);

      const id = await resolver.resolve("mdube@oliversolutions.com");
      expect(id).toBe(101);
      expect(fallback).not.toHaveBeenCalled();
    });

    it("caches fallback result for subsequent calls", async () => {
      const fallback = jest.fn().mockResolvedValue(201);
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger, fallback);

      await resolver.resolve("new@example.com");
      await resolver.resolve("new@example.com");

      expect(fallback).toHaveBeenCalledTimes(1);
      expect(resolver.size).toBe(STATIC_MAPPINGS.length + 1);
    });

    it("returns undefined when fallback returns null", async () => {
      const fallback = jest.fn().mockResolvedValue(null);
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger, fallback);

      const id = await resolver.resolve("nobody@example.com");
      expect(id).toBeUndefined();
    });
  });

  describe("initialization", () => {
    it("reports correct size", () => {
      const resolver = new AgentResolver(STATIC_MAPPINGS, logger);
      expect(resolver.size).toBe(3);
    });

    it("handles empty mappings", async () => {
      const resolver = new AgentResolver([], logger);
      expect(resolver.size).toBe(0);
      const id = await resolver.resolve("any@example.com");
      expect(id).toBeUndefined();
    });

    it("deduplicates by email (last wins on load order)", () => {
      const dupes: AgentMapping[] = [
        { email: "a@test.com", agentId: 1 },
        { email: "a@test.com", agentId: 2 },
      ];
      const resolver = new AgentResolver(dupes, logger);
      expect(resolver.size).toBe(1);
    });
  });
});
