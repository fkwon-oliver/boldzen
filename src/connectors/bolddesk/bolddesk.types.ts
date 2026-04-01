/**
 * Raw BoldDesk API response shapes.
 * Marked TBD where actual API contract is not yet confirmed.
 */

export interface BoldDeskContact {
  contactId: number;
  name: string;
  email: string;
  phone?: string;
  // TODO: confirm full response shape from BoldDesk API docs
}

export interface BoldDeskOrganization {
  organizationId: number;
  organizationName: string;
  // TODO: confirm additional fields
}

export interface BoldDeskTicket {
  ticketId: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  contactId: number;
  agentId?: number;
  // TODO: confirm full response shape from BoldDesk API docs
}

export interface BoldDeskConversationItem {
  conversationItemId: number;
  ticketId: number;
  content: string;
  isPrivate: boolean;
  createdByContactId?: number;
  createdByAgentId?: number;
  // TODO: confirm conversation item structure
}

export interface BoldDeskAttachmentUploadResult {
  attachmentId: number;
  fileName: string;
  // TODO: confirm upload response shape
}

export interface BoldDeskApiResponse<T> {
  data: T;
  // TODO: confirm pagination / envelope shape
}

export interface BoldDeskListResponse<T> {
  data: T[];
  totalCount: number;
  pageNumber: number;
  pageSize: number;
  // TODO: confirm list response envelope
}
