import { normalizeTags } from "@/transform/tag.normalizer";

describe("normalizeTags", () => {
  it("lowercases tags", () => {
    expect(normalizeTags(["VIP", "Urgent"])).toEqual(["vip", "urgent"]);
  });

  it("trims whitespace", () => {
    expect(normalizeTags(["  billing ", "support "])).toEqual(["billing", "support"]);
  });

  it("removes duplicates (case-insensitive)", () => {
    expect(normalizeTags(["VIP", "vip", "Vip"])).toEqual(["vip"]);
  });

  it("strips empty strings", () => {
    expect(normalizeTags(["", "  ", "valid"])).toEqual(["valid"]);
  });

  it("preserves order of first occurrence", () => {
    expect(normalizeTags(["B", "A", "b"])).toEqual(["b", "a"]);
  });

  describe("tagger tag stripping", () => {
    const taggerTags = new Set([
      "customer_support",
      "technical_support",
      "exam_support",
      "refunds",
      "call_-_wfg",
      "oliver_solutions",
      "wfg",
    ]);

    it("strips tagger-injected topic tags", () => {
      const tags = ["customer_support", "billing", "vip"];
      expect(normalizeTags(tags, taggerTags)).toEqual(["billing", "vip"]);
    });

    it("strips tagger-injected org tags", () => {
      const tags = ["call_-_wfg", "escalation", "wfg"];
      expect(normalizeTags(tags, taggerTags)).toEqual(["escalation"]);
    });

    it("strips both topic and org tagger tags in one pass", () => {
      const tags = ["customer_support", "call_-_wfg", "manual_tag", "oliver_solutions"];
      expect(normalizeTags(tags, taggerTags)).toEqual(["manual_tag"]);
    });

    it("preserves manual tags that are not in the tagger set", () => {
      const tags = ["billing", "escalation", "vip"];
      expect(normalizeTags(tags, taggerTags)).toEqual(["billing", "escalation", "vip"]);
    });

    it("stripping is case-insensitive", () => {
      const tags = ["CUSTOMER_SUPPORT", "Billing"];
      expect(normalizeTags(tags, taggerTags)).toEqual(["billing"]);
    });

    it("works with empty tagger set (no stripping)", () => {
      const tags = ["customer_support", "billing"];
      expect(normalizeTags(tags, new Set())).toEqual(["customer_support", "billing"]);
    });

    it("returns empty array when all tags are tagger-injected", () => {
      const tags = ["customer_support", "wfg"];
      expect(normalizeTags(tags, taggerTags)).toEqual([]);
    });

    it("still deduplicates after stripping", () => {
      const tags = ["billing", "customer_support", "BILLING"];
      expect(normalizeTags(tags, taggerTags)).toEqual(["billing"]);
    });
  });
});
