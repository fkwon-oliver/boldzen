import { SourceConnector, PaginatedResult } from "../source.interface";
import {
  NormalizedTicket,
  NormalizedUser,
  NormalizedOrganization,
} from "../../models";
import { ZendeskClient } from "./zendesk.client";
import {
  normalizeUser,
  normalizeOrganization,
  normalizeTicket,
  normalizeComment,
} from "./zendesk.normalizers";
import {
  ZendeskUsersResponse,
  ZendeskOrganizationsResponse,
  ZendeskTicketsResponse,
  ZendeskCommentsResponse,
  ZendeskTicketResponse,
  ZendeskUserResponse,
  ZendeskOrganizationResponse,
} from "./zendesk.types";

export interface ZendeskConfig {
  subdomain: string;
  email: string;
  apiToken: string;
}

export interface ZendeskTicketUpdate {
  custom_fields?: Array<{ id: number; value: unknown }>;
  tags?: string[];
  additional_tags?: string[];
  remove_tags?: string[];
  comment?: { body: string; public: boolean };
}

export class ZendeskConnector implements SourceConnector {
  private readonly client: ZendeskClient;

  constructor(config: ZendeskConfig) {
    this.client = new ZendeskClient(config);
  }

  async updateTicket(ticketId: string, update: ZendeskTicketUpdate): Promise<void> {
    await this.client.put(`/tickets/${ticketId}`, { ticket: update });
  }

  async fetchUsers(cursor?: string): Promise<PaginatedResult<NormalizedUser>> {
    const params = this.client.buildCBPParams(cursor);
    const res = await this.client.get<ZendeskUsersResponse>("/users", params);

    return {
      data: res.users.map(normalizeUser),
      nextCursor: res.meta.has_more ? res.meta.after_cursor : undefined,
      hasMore: res.meta.has_more,
    };
  }

  async fetchOrganizations(
    cursor?: string,
  ): Promise<PaginatedResult<NormalizedOrganization>> {
    const params = this.client.buildCBPParams(cursor);
    const res = await this.client.get<ZendeskOrganizationsResponse>(
      "/organizations",
      params,
    );

    return {
      data: res.organizations.map(normalizeOrganization),
      nextCursor: res.meta.has_more ? res.meta.after_cursor : undefined,
      hasMore: res.meta.has_more,
    };
  }

  async fetchTickets(
    cursor?: string,
  ): Promise<PaginatedResult<NormalizedTicket>> {
    const params = this.client.buildCBPParams(cursor);
    const res = await this.client.get<ZendeskTicketsResponse>("/tickets", params);

    const tickets = res.tickets.map((t) => normalizeTicket(t));

    return {
      data: tickets,
      nextCursor: res.meta.has_more ? res.meta.after_cursor : undefined,
      hasMore: res.meta.has_more,
    };
  }

  async fetchTicketById(ticketId: string): Promise<NormalizedTicket> {
    const ticketRes = await this.client.get<ZendeskTicketResponse>(
      `/tickets/${ticketId}`,
    );

    const comments = await this.fetchAllComments(ticketId);
    return normalizeTicket(ticketRes.ticket, comments);
  }

  async fetchUserById(userId: string): Promise<NormalizedUser> {
    const res = await this.client.get<ZendeskUserResponse>(`/users/${userId}`);
    return normalizeUser(res.user);
  }

  async fetchOrganizationById(orgId: string): Promise<NormalizedOrganization> {
    const res = await this.client.get<ZendeskOrganizationResponse>(
      `/organizations/${orgId}`,
    );
    return normalizeOrganization(res.organization);
  }

  async downloadAttachment(url: string): Promise<Buffer> {
    return this.client.getBuffer(url);
  }

  private async fetchAllComments(ticketId: string) {
    const allComments = [];
    let cursor: string | undefined;

    do {
      const params = this.client.buildCBPParams(cursor);
      const res = await this.client.get<ZendeskCommentsResponse>(
        `/tickets/${ticketId}/comments`,
        params,
      );

      const normalized = res.comments.map((c) => normalizeComment(c, ticketId));
      allComments.push(...normalized);

      cursor = res.meta.has_more ? res.meta.after_cursor : undefined;
    } while (cursor);

    return allComments;
  }
}
