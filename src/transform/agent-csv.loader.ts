import * as fs from "fs";
import * as path from "path";
import { AgentMapping } from "./agent.resolver";
import { Logger } from "../logger";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

export interface AgentCSVLoadResult {
  mappings: AgentMapping[];
  agentGroupMap: Map<string, string>;
  skipped: number;
  duplicates: number;
}

/**
 * Loads agent mappings from a CSV file with columns: email, bolddesk_id.
 * Skips rows with missing/invalid email or bolddesk_id.
 * Deduplicates by email (first occurrence wins).
 */
export function loadAgentMappingsFromCSV(
  csvPath: string,
  logger: Logger,
): AgentCSVLoadResult {
  const resolved = path.resolve(csvPath);

  if (!fs.existsSync(resolved)) {
    logger.error({ path: resolved }, "Agent CSV file not found");
    return { mappings: [], agentGroupMap: new Map(), skipped: 0, duplicates: 0 };
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  return parseAgentCSV(raw, logger);
}

export function parseAgentCSV(
  raw: string,
  logger: Logger,
): AgentCSVLoadResult {
  const rows = parseCSV(raw);
  const mappings: AgentMapping[] = [];
  const agentGroupMap = new Map<string, string>();
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const email = (row["email"] ?? "").trim().toLowerCase();
    const rawId = (row["bolddesk_id"] ?? "").trim();
    const agentId = parseInt(rawId, 10);
    const group = (row["Group"] ?? "").trim();

    if (!email) {
      skipped++;
      logger.warn({ row }, "Agent CSV row skipped: missing email");
      continue;
    }

    if (!rawId || isNaN(agentId)) {
      skipped++;
      logger.warn({ email }, "Agent CSV row skipped: missing or invalid bolddesk_id");
      continue;
    }

    if (seen.has(email)) {
      duplicates++;
      logger.warn({ email }, "Agent CSV duplicate email — keeping first occurrence");
      continue;
    }

    seen.add(email);
    mappings.push({ email, agentId });

    if (group) {
      agentGroupMap.set(email, group);
    }
  }

  logger.info(
    { loaded: mappings.length, groups: agentGroupMap.size, skipped, duplicates },
    "Agent CSV parsing complete",
  );

  if (mappings.length === 0) {
    logger.error("Zero valid agent mappings found in CSV — tickets will be created unassigned");
  }

  return { mappings, agentGroupMap, skipped, duplicates };
}
