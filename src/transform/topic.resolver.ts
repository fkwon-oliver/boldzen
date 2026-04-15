import * as fs from "fs";
import * as path from "path";
import { Logger } from "../logger";

const ZENDESK_TOPIC_FIELD_ID = "29599516755099";

interface TopicCSVRow {
  tag: string;
  bolddeskId: number;
}

/**
 * CSV format: value,tag,default,bolddesk_id
 * We only need columns 1 (tag) and 3 (bolddesk_id).
 * Simple comma split — the `tag` column never contains commas.
 */
function loadTopicCSV(csvPath: string): TopicCSVRow[] {
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    const tag = (parts[1] ?? "").trim();
    const rawId = (parts[3] ?? "").trim();
    const bolddeskId = rawId ? parseInt(rawId, 10) : NaN;
    return { tag, bolddeskId };
  });
}

/**
 * Build a map from Zendesk tagger tag → BoldDesk dropdown value ID.
 */
export function buildTopicTagToIdMap(
  csvPath: string,
  logger?: Logger,
): Map<string, number> {
  const resolved = path.resolve(csvPath);
  const exists = fs.existsSync(resolved);

  logger?.debug({ resolvedPath: resolved, exists }, "Topic CSV path resolution");

  if (!exists) {
    logger?.warn({ resolvedPath: resolved }, "Topic CSV file not found — 0 mappings will be built");
    return new Map();
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const headerRow = lines[0] ?? "(empty)";
  const dataLines = lines.slice(1);

  logger?.debug(
    { headerRow, totalDataRows: dataLines.length },
    "Topic CSV raw content",
  );

  const rows = dataLines.map((line) => {
    const parts = line.split(",");
    const tag = (parts[1] ?? "").trim();
    const rawId = (parts[3] ?? "").trim();
    const bolddeskId = rawId ? parseInt(rawId, 10) : NaN;
    return { tag, bolddeskId };
  });

  if (logger) {
    const first5 = rows.slice(0, 5).map((r) => ({ tag: r.tag, bolddeskId: r.bolddeskId }));
    const withTag = rows.filter((r) => !!r.tag).length;
    const withValidId = rows.filter((r) => !isNaN(r.bolddeskId) && r.bolddeskId > 0).length;

    logger.debug(
      { first5Rows: first5, rowsWithTag: withTag, rowsWithValidBolddeskId: withValidId },
      "Topic CSV parsed rows",
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
      "Topic tag-to-ID map built",
    );
  }

  return map;
}

/**
 * Returns the set of all topic tagger tags (lowercased) for stripping from the tag list.
 */
export function getTopicTaggerTags(csvPath: string): Set<string> {
  const rows = loadTopicCSV(csvPath);
  return new Set(rows.map((r) => r.tag.toLowerCase()).filter(Boolean));
}

export interface TopicResolution {
  sourceTag: string;
  bolddeskId: number;
}

/**
 * Resolve the BoldDesk Topic dropdown value ID from a ticket's customFields.
 *
 * Returns { sourceTag, bolddeskId } when the tag maps successfully.
 * Returns `null` when the source ticket has no Topic value (safe to proceed).
 * Throws when a source Topic exists but has no valid mapping (fail-closed).
 */
export function resolveTopicValue(
  customFields: Record<string, unknown>,
  tagToId: Map<string, number>,
  ticketSourceId?: string,
): TopicResolution | null {
  const raw = customFields[ZENDESK_TOPIC_FIELD_ID];
  if (!raw || typeof raw !== "string") return null;

  const key = raw.trim().toLowerCase();
  if (!key) return null;

  const id = tagToId.get(key);
  if (id === undefined) {
    throw new TopicMappingError(ticketSourceId ?? "unknown", key);
  }

  return { sourceTag: key, bolddeskId: id };
}

export class TopicMappingError extends Error {
  constructor(
    public readonly ticketSourceId: string,
    public readonly sourceTag: string,
  ) {
    super(
      `Topic mapping failed for ticket #${ticketSourceId}: ` +
      `Zendesk tag "${sourceTag}" has no bolddesk_id in topics.csv — ` +
      `add the mapping or migration cannot proceed`,
    );
    this.name = "TopicMappingError";
  }
}
