import { resolveTopicValue } from "@/transform/topic.resolver";

describe("resolveTopicValue", () => {
  const tagToValue = new Map<string, string>([
    ["customer_support", "Customer Support (Question & Answer)"],
    ["technical_support", "Technical Support (Account updates)"],
    ["exam_support", "Exam Support"],
    ["refunds", "Refunds"],
  ]);

  it("resolves a known tag to its display value", () => {
    const customFields = { "29599516755099": "customer_support" };
    expect(resolveTopicValue(customFields, tagToValue)).toBe(
      "Customer Support (Question & Answer)",
    );
  });

  it("is case-insensitive on the tag value", () => {
    const customFields = { "29599516755099": "TECHNICAL_SUPPORT" };
    expect(resolveTopicValue(customFields, tagToValue)).toBe(
      "Technical Support (Account updates)",
    );
  });

  it("returns undefined when field is missing", () => {
    const customFields = {};
    expect(resolveTopicValue(customFields, tagToValue)).toBeUndefined();
  });

  it("returns undefined when field is null", () => {
    const customFields = { "29599516755099": null };
    expect(resolveTopicValue(customFields, tagToValue)).toBeUndefined();
  });

  it("returns undefined when field is empty string", () => {
    const customFields = { "29599516755099": "" };
    expect(resolveTopicValue(customFields, tagToValue)).toBeUndefined();
  });

  it("falls back to raw value when tag not in map", () => {
    const customFields = { "29599516755099": "unknown_topic" };
    expect(resolveTopicValue(customFields, tagToValue)).toBe("unknown_topic");
  });
});
