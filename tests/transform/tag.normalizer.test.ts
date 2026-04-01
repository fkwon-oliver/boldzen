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
});
