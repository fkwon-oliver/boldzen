import { GroupResolver, GroupMapping } from "@/transform/group.resolver";
import pino from "pino";

const logger = pino({ level: "silent" });

const STATIC_MAPPINGS: GroupMapping[] = [
  { groupName: "Student Experience Center", groupId: 3 },
  { groupName: "Content Team", groupId: 4 },
];

describe("GroupResolver", () => {
  describe("resolveByGroupName", () => {
    it("resolves a known group name to its groupId", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      expect(resolver.resolveByGroupName("Student Experience Center")).toBe(3);
    });

    it("is case-insensitive", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      expect(resolver.resolveByGroupName("CONTENT TEAM")).toBe(4);
    });

    it("trims whitespace", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      expect(resolver.resolveByGroupName("  Content Team  ")).toBe(4);
    });

    it("returns undefined for unknown group name", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      expect(resolver.resolveByGroupName("Unknown Group")).toBeUndefined();
    });
  });

  describe("resolveByAgentEmail", () => {
    it("resolves group via agent email → group name → groupId", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      resolver.setAgentGroupMap(new Map([
        ["agent@co.com", "Student Experience Center"],
      ]));

      expect(resolver.resolveByAgentEmail("agent@co.com")).toBe(3);
    });

    it("is case-insensitive for email lookup", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      resolver.setAgentGroupMap(new Map([
        ["agent@co.com", "Content Team"],
      ]));

      expect(resolver.resolveByAgentEmail("AGENT@CO.COM")).toBe(4);
    });

    it("returns undefined when agent has no group association", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      resolver.setAgentGroupMap(new Map());

      expect(resolver.resolveByAgentEmail("nobody@co.com")).toBeUndefined();
    });

    it("returns undefined when agent's group is not in the static map", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      resolver.setAgentGroupMap(new Map([
        ["agent@co.com", "Unknown Group"],
      ]));

      expect(resolver.resolveByAgentEmail("agent@co.com")).toBeUndefined();
    });
  });

  describe("initialization", () => {
    it("reports correct size", () => {
      const resolver = new GroupResolver(STATIC_MAPPINGS, logger);
      expect(resolver.size).toBe(2);
    });

    it("handles empty mappings", () => {
      const resolver = new GroupResolver([], logger);
      expect(resolver.size).toBe(0);
      expect(resolver.resolveByGroupName("anything")).toBeUndefined();
    });
  });
});
