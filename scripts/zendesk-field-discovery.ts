/**
 * Zendesk Field Discovery — Step 1
 *
 * Read-only script that:
 *   1. Fetches all ticket field definitions
 *   2. Pulls 10–15 diverse sample tickets with comments
 *   3. Outputs structured field-definition and observed-usage summaries
 */

import * as dotenv from "dotenv";
dotenv.config();

import { ZendeskClient } from "../src/connectors/zendesk/zendesk.client";

// ── Types for raw Zendesk field definitions ────────────────────────────────

interface ZendeskTicketFieldOption {
  id: number;
  name: string;
  value: string;
  default: boolean;
}

interface ZendeskTicketField {
  id: number;
  type: string;
  title: string;
  active: boolean;
  removable: boolean; // false = system field
  custom_field_options?: ZendeskTicketFieldOption[];
}

interface ZendeskTicketFieldsResponse {
  ticket_fields: ZendeskTicketField[];
}

interface RawTicket {
  id: number;
  subject: string;
  status: string;
  priority: string | null;
  type: string | null;
  requester_id: number;
  assignee_id: number | null;
  organization_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  custom_fields: Array<{ id: number; value: unknown }>;
  via: { channel: string };
}

interface RawComment {
  id: number;
  public: boolean;
  author_id: number;
  created_at: string;
  attachments: Array<{ id: number; file_name: string; size: number; content_type: string }>;
}

interface RawTicketsResponse {
  tickets: RawTicket[];
  meta: { has_more: boolean; after_cursor: string };
}

interface RawCommentsResponse {
  comments: RawComment[];
  meta: { has_more: boolean; after_cursor: string };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function rpad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  const sep = colWidths.map((w) => "-".repeat(w)).join("-+-");
  console.log(headers.map((h, i) => pad(h, colWidths[i])).join(" | "));
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, colWidths[i])).join(" | "));
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const apiToken = process.env.ZENDESK_API_TOKEN;

  if (!subdomain || !email || !apiToken) {
    console.error("Missing ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, or ZENDESK_API_TOKEN in .env");
    process.exit(1);
  }

  const client = new ZendeskClient({ subdomain, email, apiToken });

  // ── 1. Fetch ticket field definitions ──────────────────────────────────

  console.log("Fetching ticket field definitions...\n");
  const fieldsRes = await client.get<ZendeskTicketFieldsResponse>("/ticket_fields");
  const fields = fieldsRes.ticket_fields;

  // ── 2. Fetch sample tickets (aim for 10–15 with diversity) ─────────────
  //    Use search API to find tickets across different statuses.

  interface SearchResponse {
    results: RawTicket[];
    count: number;
  }

  console.log("Fetching diverse ticket sample via search...\n");

  const statuses = ["new", "open", "pending", "hold", "solved", "closed"];
  const allCandidates: RawTicket[] = [];
  const statusCounts: Record<string, number> = {};

  for (const status of statuses) {
    try {
      const res = await client.get<SearchResponse>("/search", {
        query: `type:ticket status:${status}`,
        per_page: 3,
        sort_by: "created_at",
        sort_order: "desc",
      });
      statusCounts[status] = res.count;
      allCandidates.push(...res.results);
      console.log(`  status:${status} → ${res.count} total, fetched ${res.results.length}`);
    } catch {
      console.log(`  status:${status} → search failed or 0 results`);
      statusCounts[status] = 0;
    }
  }

  console.log("");

  // De-duplicate and select up to 15 diverse tickets
  const seenIds = new Set<number>();
  const selected: RawTicket[] = [];

  for (const t of allCandidates) {
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    selected.push(t);
    if (selected.length >= 15) break;
  }

  console.log(`Total candidates: ${allCandidates.length} → selected ${selected.length} (de-duped) for analysis`);
  console.log(`Zendesk ticket counts by status: ${Object.entries(statusCounts).map(([s, c]) => `${s}=${c}`).join(", ")}\n`);

  // ── 3. Fetch comments for each selected ticket ─────────────────────────

  interface TicketAnalysis {
    ticket: RawTicket;
    commentCount: number;
    hasInternalNotes: boolean;
    hasAttachments: boolean;
    attachmentCount: number;
    populatedCustomFields: Array<{ id: number; value: unknown }>;
  }

  const analyses: TicketAnalysis[] = [];

  for (const ticket of selected) {
    let allComments: RawComment[] = [];
    let cursor: string | undefined;

    do {
      const params: Record<string, string | number> = { "page[size]": 100 };
      if (cursor) params["page[after]"] = cursor;
      const commRes = await client.get<RawCommentsResponse>(
        `/tickets/${ticket.id}/comments`,
        params,
      );
      allComments.push(...commRes.comments);
      cursor = commRes.meta.has_more ? commRes.meta.after_cursor : undefined;
    } while (cursor);

    const hasInternalNotes = allComments.some((c) => !c.public);
    const attachmentCount = allComments.reduce((sum, c) => sum + (c.attachments?.length ?? 0), 0);
    const populatedCustomFields = ticket.custom_fields.filter(
      (cf) => cf.value !== null && cf.value !== "" && cf.value !== undefined,
    );

    analyses.push({
      ticket,
      commentCount: allComments.length,
      hasInternalNotes,
      hasAttachments: attachmentCount > 0,
      attachmentCount,
      populatedCustomFields,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  OUTPUT
  // ═══════════════════════════════════════════════════════════════════════

  console.log("\n" + "=".repeat(90));
  console.log("  A. FIELD DEFINITION SUMMARY");
  console.log("=".repeat(90) + "\n");

  // System fields
  const systemFields = fields.filter((f) => !f.removable);
  const customFields = fields.filter((f) => f.removable);

  console.log(`Total fields: ${fields.length}  |  System: ${systemFields.length}  |  Custom: ${customFields.length}\n`);

  const fieldRows = fields.map((f) => [
    String(f.id),
    f.type,
    truncate(f.title, 35),
    f.active ? "Y" : "N",
    f.removable ? "custom" : "system",
    f.custom_field_options
      ? `${f.custom_field_options.length} opts`
      : "-",
  ]);

  printTable(
    ["ID", "Type", "Title", "Active", "Kind", "Dropdown"],
    fieldRows,
    [14, 18, 35, 6, 7, 12],
  );

  // Show dropdown options for fields that have them
  const dropdownFields = fields.filter(
    (f) => f.custom_field_options && f.custom_field_options.length > 0,
  );
  if (dropdownFields.length > 0) {
    console.log("\n--- Dropdown Option Details ---\n");
    for (const f of dropdownFields) {
      console.log(`  [${f.id}] ${f.title}:`);
      for (const opt of f.custom_field_options!) {
        console.log(`    - "${opt.value}" → ${opt.name}${opt.default ? " (default)" : ""}`);
      }
    }
  }

  // ── B. Observed Field Usage ────────────────────────────────────────────

  console.log("\n\n" + "=".repeat(90));
  console.log("  B. OBSERVED FIELD USAGE (from " + analyses.length + " sample tickets)");
  console.log("=".repeat(90) + "\n");

  // Ticket-level summary table
  const ticketRows = analyses.map((a) => [
    String(a.ticket.id),
    truncate(a.ticket.subject ?? "(no subject)", 30),
    a.ticket.status,
    a.ticket.priority ?? "-",
    a.ticket.type ?? "-",
    a.ticket.via?.channel ?? "-",
    String(a.commentCount),
    a.hasInternalNotes ? "YES" : "no",
    a.hasAttachments ? `YES (${a.attachmentCount})` : "no",
    a.ticket.tags.length > 0 ? String(a.ticket.tags.length) : "-",
    String(a.populatedCustomFields.length),
  ]);

  printTable(
    ["ID", "Subject", "Status", "Pri", "Type", "Channel", "Cmts", "IntNotes", "Attach", "Tags", "CFs"],
    ticketRows,
    [8, 30, 8, 7, 10, 10, 5, 8, 10, 5, 4],
  );

  // ── Custom field frequency ─────────────────────────────────────────────

  console.log("\n--- Custom Field Frequency ---\n");

  const fieldFreq = new Map<number, { count: number; examples: unknown[] }>();
  for (const a of analyses) {
    for (const cf of a.populatedCustomFields) {
      const entry = fieldFreq.get(cf.id) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push(cf.value);
      fieldFreq.set(cf.id, entry);
    }
  }

  const fieldLookup = new Map(fields.map((f) => [f.id, f]));

  const cfRows: string[][] = [];
  for (const [id, data] of [...fieldFreq.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const def = fieldLookup.get(id);
    cfRows.push([
      String(id),
      truncate(def?.title ?? "(unknown)", 30),
      def?.type ?? "?",
      `${data.count}/${analyses.length}`,
      truncate(data.examples.map((e) => JSON.stringify(e)).join(", "), 45),
    ]);
  }

  if (cfRows.length > 0) {
    printTable(
      ["Field ID", "Title", "Type", "Freq", "Example Values"],
      cfRows,
      [14, 30, 14, 8, 45],
    );
  } else {
    console.log("  (no custom fields populated in sample)");
  }

  // ── Standard field frequency ───────────────────────────────────────────

  console.log("\n--- Standard Field Population ---\n");

  const stdCounts = {
    status: 0,
    priority: 0,
    type: 0,
    assignee: 0,
    organization: 0,
    tags: 0,
    channel: 0,
  };
  const stdExamples: Record<string, Set<string>> = {
    status: new Set(),
    priority: new Set(),
    type: new Set(),
    channel: new Set(),
  };

  for (const a of analyses) {
    const t = a.ticket;
    if (t.status) { stdCounts.status++; stdExamples.status.add(t.status); }
    if (t.priority) { stdCounts.priority++; stdExamples.priority.add(t.priority); }
    if (t.type) { stdCounts.type++; stdExamples.type.add(t.type); }
    if (t.assignee_id) stdCounts.assignee++;
    if (t.organization_id) stdCounts.organization++;
    if (t.tags.length > 0) stdCounts.tags++;
    if (t.via?.channel) { stdCounts.channel++; stdExamples.channel.add(t.via.channel); }
  }

  const stdRows = Object.entries(stdCounts).map(([field, count]) => [
    field,
    `${count}/${analyses.length}`,
    stdExamples[field] ? [...stdExamples[field]].join(", ") : "-",
  ]);

  printTable(["Field", "Populated", "Observed Values"], stdRows, [15, 12, 55]);

  // ── Tag frequency ──────────────────────────────────────────────────────

  console.log("\n--- Tag Frequency ---\n");

  const tagFreq = new Map<string, number>();
  for (const a of analyses) {
    for (const tag of a.ticket.tags) {
      tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
    }
  }

  const tagRows = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([tag, count]) => [tag, `${count}/${analyses.length}`]);

  if (tagRows.length > 0) {
    printTable(["Tag", "Freq"], tagRows, [40, 10]);
  } else {
    console.log("  (no tags in sample)");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  C. KEY OBSERVATIONS
  // ═══════════════════════════════════════════════════════════════════════

  console.log("\n\n" + "=".repeat(90));
  console.log("  C. KEY OBSERVATIONS");
  console.log("=".repeat(90) + "\n");

  // Fields defined but not used
  const usedFieldIds = new Set(fieldFreq.keys());
  const definedButUnused = customFields.filter(
    (f) => f.active && !usedFieldIds.has(f.id),
  );

  if (definedButUnused.length > 0) {
    console.log("DEFINED but NOT USED in sample:");
    for (const f of definedButUnused) {
      console.log(`  - [${f.id}] ${f.title} (${f.type})`);
    }
  } else {
    console.log("All active custom fields appear in the sample.");
  }

  console.log("");

  // Inactive fields
  const inactiveFields = fields.filter((f) => !f.active);
  if (inactiveFields.length > 0) {
    console.log(`INACTIVE fields (${inactiveFields.length}):`);
    for (const f of inactiveFields) {
      console.log(`  - [${f.id}] ${f.title} (${f.type})`);
    }
  }

  console.log("");

  // Custom fields used on tickets but unknown in field definitions
  const definedIds = new Set(fields.map((f) => f.id));
  const unknownFields: number[] = [];
  for (const a of analyses) {
    for (const cf of a.ticket.custom_fields) {
      if (!definedIds.has(cf.id) && cf.value !== null) {
        unknownFields.push(cf.id);
      }
    }
  }
  const uniqueUnknown = [...new Set(unknownFields)];
  if (uniqueUnknown.length > 0) {
    console.log("USED but NOT in field definitions:");
    for (const id of uniqueUnknown) {
      console.log(`  - Field ID ${id}`);
    }
  }

  // Attachment and internal note summary
  const withAttachments = analyses.filter((a) => a.hasAttachments).length;
  const withInternalNotes = analyses.filter((a) => a.hasInternalNotes).length;
  const totalAttachments = analyses.reduce((s, a) => s + a.attachmentCount, 0);

  console.log(`\nATTACHMENTS: ${withAttachments}/${analyses.length} tickets have attachments (${totalAttachments} total)`);
  console.log(`INTERNAL NOTES: ${withInternalNotes}/${analyses.length} tickets have internal notes`);

  // Status distribution
  const statusDist = new Map<string, number>();
  for (const a of analyses) {
    statusDist.set(a.ticket.status, (statusDist.get(a.ticket.status) ?? 0) + 1);
  }
  console.log(`\nSTATUS DISTRIBUTION: ${[...statusDist.entries()].map(([s, c]) => `${s}=${c}`).join(", ")}`);

  // ═══════════════════════════════════════════════════════════════════════
  //  D. RECOMMENDED NEXT STEP
  // ═══════════════════════════════════════════════════════════════════════

  console.log("\n\n" + "=".repeat(90));
  console.log("  D. RECOMMENDED NEXT STEP");
  console.log("=".repeat(90) + "\n");

  console.log("1. Review custom field usage above — decide which fields need BoldDesk mapping");
  console.log("2. Expand sample to 50–100 tickets to validate frequency patterns");
  console.log("3. Build field mapping table: Zendesk field → BoldDesk field (or skip/transform)");
  console.log("4. Flag any dropdown values that don't map cleanly to BoldDesk");
  console.log("5. Validate tag strategy — will tags migrate as-is or need normalization?");
  console.log("");
}

main().catch((err) => {
  console.error("Discovery failed:", err.message ?? err);
  process.exit(1);
});
