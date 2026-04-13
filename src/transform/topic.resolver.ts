import * as fs from "fs";
import * as path from "path";

const ZENDESK_TOPIC_FIELD_ID = "29599516755099";

interface TopicCSVRow {
  value: string;
  tag: string;
}

let topicRows: TopicCSVRow[] | null = null;

function loadTopicCSV(csvPath: string): TopicCSVRow[] {
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const match = line.match(/^"?([^"]*)"?,([^,]*),/);
    if (!match) return { value: line.split(",")[0].trim(), tag: line.split(",")[1]?.trim() ?? "" };
    return { value: match[1].trim(), tag: match[2].trim() };
  });
}

/**
 * Build a map from Zendesk tagger tag → display value for normalization.
 * The CSV `tag` column holds what Zendesk stores; `value` is the display label.
 */
export function buildTopicTagToValueMap(csvPath: string): Map<string, string> {
  const rows = loadTopicCSV(csvPath);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.tag) map.set(r.tag.toLowerCase(), r.value.trim());
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

/**
 * Resolve the Topic value from a ticket's customFields.
 *
 * The Zendesk tagger field stores the tag string (e.g. "customer_support").
 * We normalize it to the display value (e.g. "Customer Support (Question & Answer)")
 * so BoldDesk receives the human-readable dropdown option.
 */
export function resolveTopicValue(
  customFields: Record<string, unknown>,
  tagToValue: Map<string, string>,
): string | undefined {
  const raw = customFields[ZENDESK_TOPIC_FIELD_ID];
  if (!raw || typeof raw !== "string") return undefined;

  const key = raw.trim().toLowerCase();
  if (!key) return undefined;

  return tagToValue.get(key) ?? raw.trim();
}
