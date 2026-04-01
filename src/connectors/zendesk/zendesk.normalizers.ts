import {
  NormalizedUser,
  NormalizedOrganization,
  NormalizedTicket,
  NormalizedComment,
  NormalizedAttachment,
  UserRole,
  TicketStatus,
  TicketPriority,
} from "../../models";
import {
  ZendeskUser,
  ZendeskOrganization,
  ZendeskTicket,
  ZendeskComment,
  ZendeskAttachment,
} from "./zendesk.types";

const ROLE_MAP: Record<ZendeskUser["role"], UserRole> = {
  "end-user": "end_user",
  agent: "agent",
  admin: "admin",
};

export function normalizeUser(raw: ZendeskUser): NormalizedUser {
  return {
    sourceId: String(raw.id),
    name: raw.name || "(unnamed)",
    email: (raw.email || "").toLowerCase().trim(),
    phone: raw.phone ?? undefined,
    role: ROLE_MAP[raw.role] ?? "end_user",
    organizationSourceId: raw.organization_id ? String(raw.organization_id) : undefined,
    active: raw.active && !raw.suspended,
    raw: raw as unknown as Record<string, unknown>,
  };
}

export function normalizeOrganization(raw: ZendeskOrganization): NormalizedOrganization {
  return {
    sourceId: String(raw.id),
    name: raw.name,
    description: [raw.details, raw.notes].filter(Boolean).join("\n") || undefined,
    domainNames: raw.domain_names ?? [],
    tags: raw.tags ?? [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export function normalizeTicket(
  raw: ZendeskTicket,
  comments: NormalizedComment[] = [],
): NormalizedTicket {
  const customFields: Record<string, unknown> = {};
  for (const cf of raw.custom_fields ?? []) {
    customFields[String(cf.id)] = cf.value;
  }

  return {
    sourceId: String(raw.id),
    subject: raw.subject,
    description: raw.description,
    status: raw.status as TicketStatus,
    priority: (raw.priority as TicketPriority) ?? undefined,
    requesterSourceId: String(raw.requester_id),
    assigneeSourceId: raw.assignee_id ? String(raw.assignee_id) : undefined,
    organizationSourceId: raw.organization_id ? String(raw.organization_id) : undefined,
    tags: raw.tags ?? [],
    channel: raw.via?.channel,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    comments,
    customFields,
    raw: raw as unknown as Record<string, unknown>,
  };
}

export function normalizeComment(
  raw: ZendeskComment,
  ticketSourceId: string,
): NormalizedComment {
  return {
    sourceId: String(raw.id),
    ticketSourceId,
    authorSourceId: String(raw.author_id),
    body: raw.plain_body || raw.body,
    htmlBody: raw.html_body || undefined,
    isPublic: raw.public,
    createdAt: raw.created_at,
    attachments: (raw.attachments ?? []).map((a) =>
      normalizeAttachment(a, String(raw.id)),
    ),
    raw: raw as unknown as Record<string, unknown>,
  };
}

export function normalizeAttachment(
  raw: ZendeskAttachment,
  commentSourceId: string,
): NormalizedAttachment {
  return {
    sourceId: String(raw.id),
    fileName: raw.file_name,
    contentType: raw.content_type,
    size: raw.size,
    sourceUrl: raw.content_url,
    commentSourceId,
    raw: raw as unknown as Record<string, unknown>,
  };
}
