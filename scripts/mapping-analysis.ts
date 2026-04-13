import * as fs from "fs";
import * as path from "path";

// ── CSV parser (no external deps) ──────────────────────────────────────────

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

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function printTable(headers: string[], rows: string[][], widths: number[]): void {
  console.log(headers.map((h, i) => pad(h, widths[i])).join(" | "));
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i])).join(" | "));
  }
}

// ── Load CSVs ──────────────────────────────────────────────────────────────

const dataDir = path.resolve(__dirname, "..", "data");

function loadCSV(filename: string): Record<string, string>[] {
  const candidates = [filename, `${filename}.csv`];
  for (const name of candidates) {
    const fp = path.join(dataDir, name);
    if (fs.existsSync(fp)) return parseCSV(fs.readFileSync(fp, "utf-8"));
  }
  throw new Error(`CSV not found: tried ${candidates.join(", ")} in ${dataDir}`);
}

const agents = loadCSV("agents.csv");
const topics = loadCSV("topics.csv");
const orgs = loadCSV("organizations.csv");

// ════════════════════════════════════════════════════════════════════════════
//  1. ASSIGNEE ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(70));
console.log("  ASSIGNEE ANALYSIS");
console.log("=".repeat(70) + "\n");

interface Agent {
  name: string;
  email: string;
  role: string;
  group: string;
}

const parsed: Agent[] = agents.map((row) => ({
  name: (row["Full Name"] ?? "").trim(),
  email: (row["email"] ?? row["email "] ?? "").trim().toLowerCase(),
  role: (row["Role"] ?? "").trim(),
  group: (row["Group"] ?? "").trim(),
}));

const uniqueByEmail = new Map<string, Agent>();
for (const a of parsed) {
  const key = a.email || a.name;
  if (!uniqueByEmail.has(key)) uniqueByEmail.set(key, a);
}
const dedupedAgents = [...uniqueByEmail.values()];

const groups = [...new Set(parsed.map((a) => a.group).filter(Boolean))];

const issues: string[] = [];

// Missing emails
const noEmail = parsed.filter((a) => !a.email);
if (noEmail.length > 0) {
  issues.push(`Missing email: ${noEmail.map((a) => a.name).join(", ")}`);
}

// Duplicate names
const nameCounts = new Map<string, number>();
for (const a of parsed) {
  nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);
}
for (const [name, count] of nameCounts) {
  if (count > 1) issues.push(`Duplicate name: "${name}" appears ${count} times`);
}

// Inconsistent group assignments (same person in different groups)
const nameGroups = new Map<string, Set<string>>();
for (const a of parsed) {
  if (!nameGroups.has(a.name)) nameGroups.set(a.name, new Set());
  nameGroups.get(a.name)!.add(a.group);
}
for (const [name, grps] of nameGroups) {
  if (grps.size > 1) {
    issues.push(`Inconsistent groups for "${name}": ${[...grps].join(", ")}`);
  }
}

// Role normalization check
const roles = [...new Set(parsed.map((a) => a.role))];
const normalizedRoles = new Map<string, string[]>();
for (const r of roles) {
  const key = r.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalizedRoles.has(key)) normalizedRoles.set(key, []);
  normalizedRoles.get(key)!.push(r);
}
for (const [, variants] of normalizedRoles) {
  if (variants.length > 1) {
    issues.push(`Inconsistent role naming: ${variants.map((v) => `"${v}"`).join(" vs ")}`);
  }
}

console.log("Agents to create in BoldDesk:\n");
printTable(
  ["Name", "Email", "Role", "Group"],
  dedupedAgents.map((a) => [a.name, a.email, a.role, a.group]),
  [25, 38, 16, 28],
);

console.log(`\nGroups to create:\n`);
for (const g of groups) {
  const members = parsed.filter((a) => a.group === g);
  console.log(`  - ${g} (${members.length} agents)`);
}

console.log(`\nIssues:\n`);
if (issues.length === 0) {
  console.log("  (none)");
} else {
  for (const issue of issues) {
    console.log(`  ⚠ ${issue}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  2. TOPIC ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

console.log("\n\n" + "=".repeat(70));
console.log("  TOPIC ANALYSIS");
console.log("=".repeat(70) + "\n");

interface TopicEntry {
  displayValue: string;
  tag: string;
  normalized: string;
  isDefault: boolean;
}

const topicEntries: TopicEntry[] = topics.map((row) => {
  const display = (row["value"] ?? "").trim();
  const tag = (row["tag"] ?? "").trim();
  const normalized = display
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[()&]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return {
    displayValue: display,
    tag,
    normalized,
    isDefault: (row["default"] ?? "").trim().toLowerCase() === "true",
  };
});

// Detect trailing whitespace / inconsistencies in source
const topicIssues: string[] = [];
for (const t of topicEntries) {
  if (t.displayValue !== t.displayValue.trim()) {
    topicIssues.push(`Trailing whitespace in display value: "${t.displayValue}"`);
  }
  if (t.tag.endsWith("_")) {
    topicIssues.push(`Tag has trailing underscore: "${t.tag}"`);
  }
}

// Detect duplicates after normalization
const normCounts = new Map<string, string[]>();
for (const t of topicEntries) {
  if (!normCounts.has(t.normalized)) normCounts.set(t.normalized, []);
  normCounts.get(t.normalized)!.push(t.displayValue);
}
for (const [norm, displays] of normCounts) {
  if (displays.length > 1) {
    topicIssues.push(`Duplicate after normalization "${norm}": ${displays.join(", ")}`);
  }
}

// Categorize topics
const generalTopics = topicEntries.filter(
  (t) => !t.tag.startsWith("gc_") && !t.tag.startsWith("tico_") && !t.tag.includes("speedpass"),
);
const gcTopics = topicEntries.filter((t) => t.tag.startsWith("gc_"));
const ticoTopics = topicEntries.filter((t) => t.tag.startsWith("tico_"));
const otherTopics = topicEntries.filter((t) => t.tag.includes("speedpass"));

console.log("Clean topic list:\n");
printTable(
  ["Display Value", "Zendesk Tag", "Normalized", "Category"],
  topicEntries.map((t) => {
    let cat = "general";
    if (t.tag.startsWith("gc_")) cat = "GC";
    else if (t.tag.startsWith("tico_")) cat = "TICO";
    else if (t.tag.includes("speedpass")) cat = "SpeedPass";
    return [t.displayValue, t.tag, t.normalized, cat];
  }),
  [42, 42, 42, 10],
);

console.log(`\nRecommended format: DROPDOWN (custom field in BoldDesk)`);
console.log(`  Rationale: ${topicEntries.length} closed-list values with clear display names.`);
console.log(`  Tags would pollute the tag namespace; a dropdown preserves the single-select constraint.`);

console.log(`\nFinal normalized values (${topicEntries.length}):\n`);
console.log(`  General (${generalTopics.length}): ${generalTopics.map((t) => t.normalized).join(", ")}`);
console.log(`  GC (${gcTopics.length}): ${gcTopics.map((t) => t.normalized).join(", ")}`);
console.log(`  TICO (${ticoTopics.length}): ${ticoTopics.map((t) => t.normalized).join(", ")}`);
console.log(`  Other (${otherTopics.length}): ${otherTopics.map((t) => t.normalized).join(", ")}`);

if (topicIssues.length > 0) {
  console.log(`\nIssues:\n`);
  for (const issue of topicIssues) {
    console.log(`  ⚠ ${issue}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  3. ORGANIZATION ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

console.log("\n\n" + "=".repeat(70));
console.log("  ORGANIZATION ANALYSIS");
console.log("=".repeat(70) + "\n");

interface OrgEntry {
  displayValue: string;
  tag: string;
  normalized: string;
  isCallPrefix: boolean;
}

const orgEntries: OrgEntry[] = orgs.map((row) => {
  const display = (row["value"] ?? "").trim();
  const tag = (row["tag"] ?? "").trim();
  const isCallPrefix = display.startsWith("CALL - ") || tag.startsWith("call_-_");

  const normalized = display
    .replace(/^CALL\s*-\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/['']/g, "")
    .replace(/_+/g, "_");

  return { displayValue: display, tag, normalized, isCallPrefix };
});

// Group by normalized name to find duplicates
const orgNormGroups = new Map<string, OrgEntry[]>();
for (const o of orgEntries) {
  if (!orgNormGroups.has(o.normalized)) orgNormGroups.set(o.normalized, []);
  orgNormGroups.get(o.normalized)!.push(o);
}

const duplicatePairs: Array<{ normalized: string; entries: OrgEntry[] }> = [];
const uniqueOrgs: Array<{ normalized: string; entries: OrgEntry[] }> = [];

for (const [normalized, entries] of orgNormGroups) {
  if (entries.length > 1) {
    duplicatePairs.push({ normalized, entries });
  }
  uniqueOrgs.push({ normalized, entries });
}

// Non-paired entries (only CALL or only plain)
const callOnly = orgEntries.filter(
  (o) => o.isCallPrefix && !orgEntries.some((x) => !x.isCallPrefix && x.normalized === o.normalized),
);
const plainOnly = orgEntries.filter(
  (o) => !o.isCallPrefix && !orgEntries.some((x) => x.isCallPrefix && x.normalized === o.normalized),
);

console.log(`Total entries: ${orgEntries.length}`);
console.log(`  CALL-prefixed: ${orgEntries.filter((o) => o.isCallPrefix).length}`);
console.log(`  Plain: ${orgEntries.filter((o) => !o.isCallPrefix).length}`);
console.log(`  Unique after normalization: ${orgNormGroups.size}\n`);

console.log("Clean organization list:\n");
printTable(
  ["Normalized", "Display Value(s)", "Zendesk Tag(s)", "Dup?"],
  uniqueOrgs.map((g) => [
    g.normalized,
    g.entries.map((e) => e.displayValue).join(" / "),
    g.entries.map((e) => e.tag).join(" / "),
    g.entries.length > 1 ? "YES" : "",
  ]),
  [22, 42, 48, 5],
);

console.log(`\nDuplicate patterns (${duplicatePairs.length} pairs):\n`);
if (duplicatePairs.length === 0) {
  console.log("  (none)");
} else {
  for (const pair of duplicatePairs) {
    const tags = pair.entries.map((e) => `"${e.tag}"`).join(" ↔ ");
    console.log(`  "${pair.normalized}" → ${tags}`);
  }
}

if (callOnly.length > 0) {
  console.log(`\nCALL-prefixed with no plain counterpart (${callOnly.length}):`);
  for (const o of callOnly) {
    console.log(`  - ${o.displayValue} → ${o.tag}`);
  }
}

if (plainOnly.length > 0) {
  console.log(`\nPlain with no CALL counterpart (${plainOnly.length}):`);
  for (const o of plainOnly) {
    console.log(`  - ${o.displayValue} → ${o.tag}`);
  }
}

console.log(`\nRecommendation: NATIVE ORGANIZATIONS in BoldDesk`);
console.log(`  - Merge CALL-prefixed and plain entries into ${orgNormGroups.size} unique orgs`);
console.log(`  - Map both tag variants to the same BoldDesk organization`);
console.log(`  - Drop "CALL - " prefix; use clean display names`);
console.log(`  - Handle special entries (Unknown, Spam/Junk) as tags or exclude`);

// ════════════════════════════════════════════════════════════════════════════
//  4. FINAL MAPPING SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log("\n\n" + "=".repeat(70));
console.log("  FINAL MAPPING DECISION");
console.log("=".repeat(70) + "\n");

const topicDecision = "custom dropdown field";
const orgDecision = "native BoldDesk organization (merge CALL/plain duplicates)";

printTable(
  ["Zendesk Field", "BoldDesk Target", "Action Required"],
  [
    ["Requester", "Contact (direct map)", "Pre-create contacts or auto-create on import"],
    ["Assignee", "Agent (direct map)", `Pre-create ${dedupedAgents.length} agents in ${groups.length} group(s)`],
    ["Followers", "(excluded)", "Not migrating — low value, high complexity"],
    ["Topic", topicDecision, `Create dropdown with ${topicEntries.length} options`],
    [
      "Organization Name",
      orgDecision,
      `Create ${orgNormGroups.size} orgs (from ${orgEntries.length} dropdown values)`,
    ],
    ["Priority", "(skip)", "Field is deactivated and never populated in Zendesk"],
    ["Type", "(skip)", "Always 'incident'; field deactivated in Zendesk"],
    ["Status", "Status (direct map)", "Map: new→New, open→Open, pending→OnHold, solved→Closed, closed→Closed"],
    ["Tags", "Tags (direct map)", "Exclude tagger-injected tags (Topic/Org); keep manual tags only"],
  ],
  [20, 40, 55],
);

console.log("\n--- Tag Deduplication Strategy ---\n");
console.log("  Tagger fields (Topic, Organization Name) inject their selected value as a ticket tag.");
console.log("  To avoid double-mapping:");
console.log("    1. Migrate Topic value → BoldDesk custom dropdown (NOT as tag)");
console.log("    2. Migrate Organization Name value → BoldDesk native org (NOT as tag)");
console.log("    3. Strip tagger-injected tags from the tag list before migration");
console.log("    4. Migrate remaining manual tags as BoldDesk tags\n");

// Build the full set of tagger-injected tag values to strip
const taggerTags = new Set([
  ...topicEntries.map((t) => t.tag),
  ...orgEntries.map((o) => o.tag),
]);
console.log(`  Tagger tags to strip (${taggerTags.size}): first 10 shown`);
const sample = [...taggerTags].slice(0, 10);
for (const t of sample) {
  console.log(`    - ${t}`);
}
if (taggerTags.size > 10) console.log(`    ... and ${taggerTags.size - 10} more`);

console.log("");
