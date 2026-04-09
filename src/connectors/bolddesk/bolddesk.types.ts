/**
 * BoldDesk API request/response shapes.
 *
 * Auth: x-api-key header
 * Base: https://{domain}.bolddesk.com/api/v1.0
 *
 * Shapes derived from BoldDesk developer docs + swagger.
 * Fields marked TODO need verification against a live instance.
 */

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface BoldDeskCreateContactRequest {
  name: string;
  email: string;
  phone?: string;
  contactGroupId?: number;
  // TODO: confirm if custom fields can be passed inline
}

export interface BoldDeskContact {
  contactId: number;
  name: string;
  email: string;
  phone?: string;
  contactGroupId?: number;
}

export interface BoldDeskContactListResponse {
  data: BoldDeskContact[];
  itemCount: number;
  pageIndex: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Contact Groups (BoldDesk's equivalent of Zendesk organizations)
// ---------------------------------------------------------------------------

export interface BoldDeskCreateContactGroupRequest {
  name: string;
  description?: string;
  // TODO: confirm additional fields (domain matching, custom fields)
}

export interface BoldDeskContactGroup {
  contactGroupId: number;
  name: string;
  description?: string;
}

export interface BoldDeskContactGroupListResponse {
  data: BoldDeskContactGroup[];
  itemCount: number;
  pageIndex: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface BoldDeskCreateTicketRequest {
  brandId: number;
  subject: string;
  description: string;
  priorityId: number;
  statusId?: number;
  requesterEmailId: string;
  requesterName?: string;
  requesterId?: number | null;
  contactGroupId?: number;
  agentId?: number;
  tags?: string[];
  isVisibleInCustomerPortal: boolean;
  skipDependencyValidation?: boolean;
  // attachment tokens returned from the upload endpoint
  attachments?: string[];
  customFields?: Record<string, unknown>;
}

export interface BoldDeskCreateTicketResponse {
  id: number;
  isFileUploadSuccess: boolean;
}

export interface BoldDeskTicket {
  ticketId: number;
  subject: string;
  description: string;
  statusId: number;
  priorityId: number;
  contactId: number;
  agentId?: number;
  tags?: string[];
  createdOn?: string;
  lastUpdatedOn?: string;
}

// ---------------------------------------------------------------------------
// Conversation Items  (replies & notes)
// ---------------------------------------------------------------------------

/**
 * Public reply: POST /api/v1/{ticketId}/updates
 */
export interface BoldDeskCreateReplyRequest {
  description: string;
  updatedByuserIdorEmailId?: string;
  ticketStatusId?: number;
  skipEmailNotification?: boolean;
  dontAppendOnBehalfOfRequesterMessage?: boolean;
  attachments?: string[];
}

/**
 * Internal / public note: POST /api/v1/tickets/{ticketId}/notes?isPublicNote={bool}
 */
export interface BoldDeskCreateNoteRequest {
  description: string;
  updatedByuserIdorEmailId?: string;
  skipEmailNotification?: boolean;
  attachments?: string[];
}

export interface BoldDeskConversationItem {
  conversationItemId: number;
  ticketId: number;
  content: string;
  isPrivate: boolean;
  createdByContactId?: number;
  createdByAgentId?: number;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Returned from POST /api/v1/tickets/attachment (multipart/form-data) */
export interface BoldDeskAttachmentUploadResult {
  token: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Status / Priority ID mappings
// BoldDesk uses numeric IDs. These defaults should be confirmed per-instance.
// ---------------------------------------------------------------------------

export const BOLDDESK_STATUS_IDS: Record<string, number> = {
  new: 1,
  open: 2,
  pending: 3,       // "Waiting for Customer" in BoldDesk UI
  on_hold: 4,
  resolved: 5,      // "Solved" in BoldDesk UI
  closed: 6,
};

export const BOLDDESK_PRIORITY_IDS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

// ---------------------------------------------------------------------------
// Generic envelope
// ---------------------------------------------------------------------------

export interface BoldDeskApiResponse<T> {
  data: T;
}

export interface BoldDeskListResponse<T> {
  data: T[];
  itemCount: number;
  pageIndex: number;
  pageSize: number;
}
