import {
  NormalizedTicket,
  NormalizedUser,
  NormalizedOrganization,
} from "../models";

export interface PaginatedResult<T> {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SourceConnector {
  fetchUsers(cursor?: string): Promise<PaginatedResult<NormalizedUser>>;
  fetchOrganizations(cursor?: string): Promise<PaginatedResult<NormalizedOrganization>>;
  fetchTickets(cursor?: string): Promise<PaginatedResult<NormalizedTicket>>;
  fetchTicketById(ticketId: string): Promise<NormalizedTicket>;
  fetchUserById(userId: string): Promise<NormalizedUser>;
  fetchOrganizationById(orgId: string): Promise<NormalizedOrganization>;

  downloadAttachment(url: string): Promise<Buffer>;
}
