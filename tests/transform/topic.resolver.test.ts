import { resolveTopicValue, TopicMappingError } from "@/transform/topic.resolver";

describe("resolveTopicValue", () => {
  const tagToId = new Map<string, number>([
    ["customer_support", 22],
    ["technical_support", 23],
    ["exam_support", 24],
    ["refunds", 26],
  ]);

  it("resolves a known tag to its BoldDesk dropdown ID", () => {
    const customFields = { "29599516755099": "customer_support" };
    const result = resolveTopicValue(customFields, tagToId, "t1");
    expect(result).toEqual({ sourceTag: "customer_support", bolddeskId: 22 });
  });

  it("is case-insensitive on the tag value", () => {
    const customFields = { "29599516755099": "TECHNICAL_SUPPORT" };
    const result = resolveTopicValue(customFields, tagToId, "t1");
    expect(result).toEqual({ sourceTag: "technical_support", bolddeskId: 23 });
  });

  it("returns null when field is missing (no topic on source)", () => {
    const customFields = {};
    expect(resolveTopicValue(customFields, tagToId, "t1")).toBeNull();
  });

  it("returns null when field is null", () => {
    const customFields = { "29599516755099": null };
    expect(resolveTopicValue(customFields, tagToId, "t1")).toBeNull();
  });

  it("returns null when field is empty string", () => {
    const customFields = { "29599516755099": "" };
    expect(resolveTopicValue(customFields, tagToId, "t1")).toBeNull();
  });

  it("throws TopicMappingError when tag exists but is not in map", () => {
    const customFields = { "29599516755099": "unknown_topic" };
    expect(() => resolveTopicValue(customFields, tagToId, "t99")).toThrow(
      TopicMappingError,
    );
    expect(() => resolveTopicValue(customFields, tagToId, "t99")).toThrow(
      /ticket #t99.*unknown_topic.*bolddesk_id/,
    );
  });

  it("throws when tag exists but bolddesk_id is missing from CSV map", () => {
    const emptyMap = new Map<string, number>();
    const customFields = { "29599516755099": "customer_support" };
    expect(() => resolveTopicValue(customFields, emptyMap, "t5")).toThrow(
      TopicMappingError,
    );
  });

  it("does NOT fall back to raw tag value or display label", () => {
    const partialMap = new Map<string, number>([["other_tag", 99]]);
    const customFields = { "29599516755099": "customer_support" };
    expect(() => resolveTopicValue(customFields, partialMap, "t1")).toThrow(
      TopicMappingError,
    );
  });
});
