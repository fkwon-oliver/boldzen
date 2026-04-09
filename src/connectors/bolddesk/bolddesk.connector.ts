import {
  DestinationConnector,
  CreatedEntity,
  TicketCreationContext,
} from "../destination.interface";
import {
  NormalizedTicket,
  NormalizedComment,
  NormalizedUser,
  NormalizedOrganization,
  NormalizedAttachment,
} from "../../models";
import { BoldDeskClient } from "./bolddesk.client";
import { mapTicketStatus } from "../../transform/status.mapper";
import { mapTicketPriority } from "../../transform/priority.mapper";
import { normalizeTags } from "../../transform/tag.normalizer";
import {
  BoldDeskContact,
  BoldDeskContactGroup,
  BoldDeskContactListResponse,
  BoldDeskContactGroupListResponse,
  BoldDeskCreateTicketResponse,
  BoldDeskConversationItem,
  BoldDeskAttachmentUploadResult,
  BoldDeskCreateTicketRequest,
  BoldDeskCreateReplyRequest,
  BoldDeskCreateNoteRequest,
  BOLDDESK_STATUS_IDS,
  BOLDDESK_PRIORITY_IDS,
} from "./bolddesk.types";

export interface BoldDeskConfig {
  baseUrl: string;
  apiKey: string;
  defaultBrandId: number;
}

export class BoldDeskConnector implements DestinationConnector {
  private readonly client: BoldDeskClient;
  private readonly brandId: number;

  constructor(config: BoldDeskConfig) {
    this.client = new BoldDeskClient(config);
    this.brandId = config.defaultBrandId;
  }

  // -----------------------------------------------------------------------
  // Contacts
  // -----------------------------------------------------------------------

  async createContact(user: NormalizedUser): Promise<CreatedEntity> {
    const body = {
      name: user.name || user.email,
      email: user.email.toLowerCase(),
      phone: user.phone ?? undefined,
    };

    const result = await this.client.post<BoldDeskContact>(
      "/api/v1/contacts",
      body,
    );

    return { destinationId: String(result.contactId) };
  }

  async findContactByEmail(email: string): Promise<CreatedEntity | null> {
    const res = await this.client.get<BoldDeskContactListResponse>(
      "/api/v1/contacts",
      { email: email.toLowerCase(), pageSize: 1 },
    );

    if (res.data.length === 0) return null;
    return { destinationId: String(res.data[0].contactId) };
  }

  // -----------------------------------------------------------------------
  // Organizations → BoldDesk Contact Groups
  // -----------------------------------------------------------------------

  async createOrganization(
    org: NormalizedOrganization,
  ): Promise<CreatedEntity> {
    const body = {
      name: org.name,
      description: org.description ?? undefined,
    };

    const result = await this.client.post<BoldDeskContactGroup>(
      "/api/v1/contact_groups",
      body,
    );

    return { destinationId: String(result.contactGroupId) };
  }

  async findOrganizationByName(
    name: string,
  ): Promise<CreatedEntity | null> {
    const res = await this.client.get<BoldDeskContactGroupListResponse>(
      "/api/v1/contact_groups",
      { searchText: name, pageSize: 1 },
    );

    if (res.data.length === 0) return null;
    return { destinationId: String(res.data[0].contactGroupId) };
  }

  // -----------------------------------------------------------------------
  // Tickets
  // -----------------------------------------------------------------------

  async createTicket(
    ticket: NormalizedTicket,
    context: TicketCreationContext,
  ): Promise<CreatedEntity> {
    const statusKey = mapTicketStatus(ticket.status);
    const priorityKey = ticket.priority
      ? mapTicketPriority(ticket.priority)
      : undefined;

    const body: BoldDeskCreateTicketRequest = {
      brandId: this.brandId,
      subject: ticket.subject,
      description: ticket.htmlDescription ?? ticket.description,
      requesterEmailId: context.requesterEmail,
      requesterName: context.requesterName,
      priorityId: priorityKey
        ? BOLDDESK_PRIORITY_IDS[priorityKey] ?? BOLDDESK_PRIORITY_IDS.medium
        : BOLDDESK_PRIORITY_IDS.medium,
      statusId: BOLDDESK_STATUS_IDS[statusKey] ?? BOLDDESK_STATUS_IDS.new,
      tags: normalizeTags(ticket.tags),
      isVisibleInCustomerPortal: true,
      skipDependencyValidation: true,
      contactGroupId: context.contactGroupDestId
        ? parseInt(context.contactGroupDestId, 10)
        : undefined,
    };

    const result = await this.client.post<BoldDeskCreateTicketResponse>(
      "/api/v1.0/tickets",
      body,
    );

    return { destinationId: String(result.id) };
  }

  // -----------------------------------------------------------------------
  // Conversation items (comments / notes)
  // -----------------------------------------------------------------------

  async addComment(
    ticketDestId: string,
    comment: NormalizedComment,
  ): Promise<CreatedEntity> {
    if (comment.isPublic) {
      return this.addReply(ticketDestId, comment);
    }
    return this.addNote(ticketDestId, comment);
  }

  private async addReply(
    ticketDestId: string,
    comment: NormalizedComment,
  ): Promise<CreatedEntity> {
    const body: BoldDeskCreateReplyRequest = {
      description: comment.htmlBody ?? comment.body,
      skipEmailNotification: true,
      dontAppendOnBehalfOfRequesterMessage: true,
    };

    const result = await this.client.post<BoldDeskConversationItem>(
      `/api/v1/tickets/${ticketDestId}/updates`,
      body,
    );

    return { destinationId: String(result.conversationItemId) };
  }

  private async addNote(
    ticketDestId: string,
    comment: NormalizedComment,
  ): Promise<CreatedEntity> {
    const body: BoldDeskCreateNoteRequest = {
      description: comment.htmlBody ?? comment.body,
      skipEmailNotification: true,
    };

    const result = await this.client.post<BoldDeskConversationItem>(
      `/api/v1/tickets/${ticketDestId}/notes`,
      { ...body, isPublicNote: false },
    );

    return { destinationId: String(result.conversationItemId) };
  }

  // -----------------------------------------------------------------------
  // Attachments
  // -----------------------------------------------------------------------

  async uploadAttachment(
    attachment: NormalizedAttachment,
    fileBuffer: Buffer,
  ): Promise<CreatedEntity> {
    const result = await this.client.postMultipart<BoldDeskAttachmentUploadResult>(
      "/api/v1/tickets/attachment",
      attachment.fileName,
      fileBuffer,
      attachment.contentType,
    );

    return { destinationId: result.token };
  }
}
