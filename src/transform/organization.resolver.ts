import * as fs from "fs";
import * as path from "path";
import { Logger } from "../logger";

const ZENDESK_ORGANIZATION_FIELD_ID = "33084594878747";

interface OrgCSVRow {
  tag: string;
  bolddeskId: number;
}

function headerColumnIndices(headerLine: string): { tagIdx: number; idIdx: number } | null {
  const cols = headerLine.split(",").map((c) => c.trim().toLowerCase());
  const tagIdx = cols.indexOf("tag");
  const idIdx = cols.indexOf("bolddesk_id");
  if (tagIdx < 0 || idIdx < 0) return null;
  return { tagIdx, idIdx };
}

function parseOrgRow(line: string, tagIdx: number, idIdx: number): OrgCSVRow {
  const parts = line.split(",");
  const tag = (parts[tagIdx] ?? "").trim();
  const rawId = (parts[idIdx] ?? "").trim();
  const bolddeskId = rawId ? parseInt(rawId, 10) : NaN;
  return { tag, bolddeskId };
}

/**
 * Build a map from Zendesk Organization tagger tag → BoldDesk dropdown value ID.
 * Uses CSV headers `tag` and `bolddesk_id` (case-insensitive header names).
 */
export function buildOrganizationTagToIdMap(
  csvPath: string,
  logger?: Logger,
): Map<string, number> {
  const resolved = path.resolve(csvPath);
  const exists = fs.existsSync(resolved);

  logger?.debug({ resolvedPath: resolved, exists }, "Organization CSV path resolution");

  if (!exists) {
    logger?.warn({ resolvedPath: resolved }, "Organization CSV file not found — 0 mappings will be built");
    return new Map();
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const headerLine = lines[0] ?? "";
  const dataLines = lines.slice(1);

  const indices = headerColumnIndices(headerLine);
  if (!indices) {
    logger?.warn(
      { resolvedPath: resolved, headerLine },
      "Organization CSV missing required columns tag and/or bolddesk_id — 0 mappings",
    );
    return new Map();
  }

  const { tagIdx, idIdx } = indices;

  logger?.debug(
    { headerLine, totalDataRows: dataLines.length, tagIdx, idIdx },
    "Organization CSV raw content",
  );

  const rows = dataLines.map((line) => parseOrgRow(line, tagIdx, idIdx));

  if (logger) {
    const first5 = rows.slice(0, 5).map((r) => ({ tag: r.tag, bolddeskId: r.bolddeskId }));
    const withTag = rows.filter((r) => !!r.tag).length;
    const withValidId = rows.filter((r) => !isNaN(r.bolddeskId) && r.bolddeskId > 0).length;

    logger.debug(
      { first5Rows: first5, rowsWithTag: withTag, rowsWithValidBolddeskId: withValidId },
      "Organization CSV parsed rows",
    );
  }

  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.tag && !isNaN(r.bolddeskId) && r.bolddeskId > 0) {
      map.set(r.tag.toLowerCase(), r.bolddeskId);
    }
  }

  if (logger) {
    const first5Mappings = Array.from(map.entries()).slice(0, 5)
      .map(([tag, id]) => `${tag} -> ${id}`);
    logger.debug(
      { mappingCount: map.size, first5Mappings },
      "Organization tag-to-ID map built",
    );
    logger.info(
      {
        organizationCsvMappingCount: map.size,
        organizationCsvFirst5Mappings: first5Mappings,
      },
      "[org-debug] Organization CSV map (tag → bolddesk_id)",
    );
  }

  return map;
}

export interface OrganizationResolution {
  sourceTag: string;
  bolddeskId: number;
}

/**
 * Resolve the BoldDesk Organization dropdown value ID from a ticket's customFields.
 *
 * Returns { sourceTag, bolddeskId } when the tag maps successfully.
 * Returns `null` when the source ticket has no Organization value (safe to proceed).
 * Throws when a source Organization exists but has no valid mapping (fail-closed).
 */
export function resolveOrganizationValue(
  customFields: Record<string, unknown>,
  tagToId: Map<string, number>,
  ticketSourceId?: string,
): OrganizationResolution | null {
  const raw = customFields[ZENDESK_ORGANIZATION_FIELD_ID];
  if (!raw || typeof raw !== "string") return null;

  const key = raw.trim().toLowerCase();
  if (!key) return null;

  const id = tagToId.get(key);
  if (id === undefined) {
    throw new OrganizationMappingError(ticketSourceId ?? "unknown", key);
  }

  return { sourceTag: key, bolddeskId: id };
}

export class OrganizationMappingError extends Error {
  constructor(
    public readonly ticketSourceId: string,
    public readonly sourceTag: string,
  ) {
    super(
      `Organization field mapping failed for ticket #${ticketSourceId}: ` +
      `Zendesk tag "${sourceTag}" has no bolddesk_id in organizations.csv — ` +
      `add the mapping or migration cannot proceed`,
    );
    this.name = "OrganizationMappingError";
  }
}
