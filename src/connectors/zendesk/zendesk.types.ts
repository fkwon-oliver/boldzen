/**
 * Raw Zendesk API response shapes.
 * These represent what the API actually returns — do not conflate with normalized models.
 *
 * Zendesk uses cursor-based pagination (CBP) on list endpoints.
 * Auth: Basic {email}/token:{api_token}
 */

export interface ZendeskUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: "end-user" | "agent" | "admin";
  organization_id: number | null;
  active: boolean;
  suspended: boolean;
}

export interface ZendeskOrganization {
  id: number;
  name: string;
  details: string | null;
  notes: string | null;
  domain_names: string[];
  tags: string[];
}

export interface ZendeskTicket {
  id: number;
  subject: string;
  description: string;
  status: "new" | "open" | "pending" | "hold" | "solved" | "closed";
  priority: "low" | "normal" | "high" | "urgent" | null;
  type: "problem" | "incident" | "question" | "task" | null;
  requester_id: number;
  assignee_id: number | null;
  organization_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  custom_fields: ZendeskCustomField[];
  via: { channel: string };
}

export interface ZendeskCustomField {
  id: number;
  value: unknown;
}

export interface ZendeskComment {
  id: number;
  body: string;
  html_body: string;
  plain_body: string;
  public: boolean;
  author_id: number;
  created_at: string;
  attachments: ZendeskAttachment[];
}

export interface ZendeskAttachment {
  id: number;
  file_name: string;
  content_type: string;
  size: number;
  content_url: string;
}

// Zendesk cursor-based pagination (CBP) envelope
export interface ZendeskCBPMeta {
  has_more: boolean;
  after_cursor: string;
}

export interface ZendeskUsersResponse {
  users: ZendeskUser[];
  meta: ZendeskCBPMeta;
}

export interface ZendeskOrganizationsResponse {
  organizations: ZendeskOrganization[];
  meta: ZendeskCBPMeta;
}

export interface ZendeskTicketsResponse {
  tickets: ZendeskTicket[];
  meta: ZendeskCBPMeta;
}

export interface ZendeskCommentsResponse {
  comments: ZendeskComment[];
  meta: ZendeskCBPMeta;
}

export interface ZendeskTicketResponse {
  ticket: ZendeskTicket;
}
