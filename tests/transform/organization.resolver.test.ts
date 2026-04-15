import * as fs from "fs";
import * as path from "path";
import {
  buildOrganizationTagToIdMap,
  resolveOrganizationValue,
  OrganizationMappingError,
} from "@/transform/organization.resolver";

describe("resolveOrganizationValue", () => {
  const tagToId = new Map<string, number>([
    ["wfg", 62],
    ["call_-_wfg", 44],
  ]);

  it("resolves a known tag to its BoldDesk dropdown ID", () => {
    const customFields = { "33084594878747": "wfg" };
    const result = resolveOrganizationValue(customFields, tagToId, "t1");
    expect(result).toEqual({ sourceTag: "wfg", bolddeskId: 62 });
  });

  it("is case-insensitive on the tag value", () => {
    const customFields = { "33084594878747": "CALL_-_WFG" };
    const result = resolveOrganizationValue(customFields, tagToId, "t1");
    expect(result).toEqual({ sourceTag: "call_-_wfg", bolddeskId: 44 });
  });

  it("returns null when field is missing", () => {
    const customFields = {};
    expect(resolveOrganizationValue(customFields, tagToId, "t1")).toBeNull();
  });

  it("returns null when field is null", () => {
    const customFields = { "33084594878747": null };
    expect(resolveOrganizationValue(customFields, tagToId, "t1")).toBeNull();
  });

  it("returns null when field is empty string", () => {
    const customFields = { "33084594878747": "" };
    expect(resolveOrganizationValue(customFields, tagToId, "t1")).toBeNull();
  });

  it("throws OrganizationMappingError when tag exists but is not in map", () => {
    const customFields = { "33084594878747": "unknown_org" };
    expect(() => resolveOrganizationValue(customFields, tagToId, "t99")).toThrow(
      OrganizationMappingError,
    );
    expect(() => resolveOrganizationValue(customFields, tagToId, "t99")).toThrow(
      /ticket #t99.*unknown_org.*bolddesk_id/,
    );
  });

  it("throws when tag exists but bolddesk_id is missing from CSV map", () => {
    const emptyMap = new Map<string, number>();
    const customFields = { "33084594878747": "wfg" };
    expect(() => resolveOrganizationValue(customFields, emptyMap, "t5")).toThrow(
      OrganizationMappingError,
    );
  });

  it("does NOT fall back to raw tag value or display label", () => {
    const partialMap = new Map<string, number>([["other_tag", 99]]);
    const customFields = { "33084594878747": "wfg" };
    expect(() => resolveOrganizationValue(customFields, partialMap, "t1")).toThrow(
      OrganizationMappingError,
    );
  });
});

describe("buildOrganizationTagToIdMap", () => {
  it("omits rows without a valid bolddesk_id", () => {
    const csvPath = path.join(
      __dirname,
      "../fixtures/organizations-missing-bolddesk-id.csv",
    );
    const map = buildOrganizationTagToIdMap(csvPath);
    expect(map.has("orphan_tag")).toBe(false);
    expect(map.size).toBe(0);
  });

  it("throws on resolve when CSV omitted the tag from map", () => {
    const csvPath = path.join(
      __dirname,
      "../fixtures/organizations-missing-bolddesk-id.csv",
    );
    const map = buildOrganizationTagToIdMap(csvPath);
    const customFields = { "33084594878747": "orphan_tag" };
    expect(() => resolveOrganizationValue(customFields, map, "501")).toThrow(
      OrganizationMappingError,
    );
  });

  it("builds map from real organizations.csv headers", () => {
    const csvPath = path.join(__dirname, "../../data/organizations.csv");
    if (!fs.existsSync(csvPath)) return;
    const map = buildOrganizationTagToIdMap(csvPath);
    expect(map.get("wfg")).toBe(62);
  });
});
