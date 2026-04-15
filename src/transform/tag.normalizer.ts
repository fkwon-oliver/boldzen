import * as fs from "fs";
import * as path from "path";

/**
 * Loads the `tag` column from a tagger CSV (topics.csv or organizations.csv)
 * and returns all values lowercased.
 */
function loadTaggerTags(csvPath: string): string[] {
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    return (parts[1] ?? "").trim().toLowerCase();
  }).filter(Boolean);
}

/**
 * Build a Set of all tagger-injected tag values (Topic + Organization)
 * that Zendesk auto-adds and must be stripped before sending to BoldDesk.
 */
export function buildTaggerTagSet(
  topicsCsvPath: string,
  orgsCsvPath: string,
): Set<string> {
  const tags = [
    ...loadTaggerTags(topicsCsvPath),
    ...loadTaggerTags(orgsCsvPath),
  ];
  return new Set(tags);
}

export function normalizeTags(
  tags: string[],
  taggerTagsToStrip?: Set<string>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    if (taggerTagsToStrip?.has(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
