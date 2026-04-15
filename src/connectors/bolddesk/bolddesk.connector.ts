import {
  DestinationConnector,
  CreatedEntity,
  TicketCreationContext,
  CommentContext,
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
import { resolveTopicValue } from "../../transform/topic.resolver";
import {
  buildTicketProvenanceBlock,
  buildCommentProvenanceHeader,
} from "../../transform/provenance";
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
import { Logger } from "../../logger";

export interface BoldDeskConfig {
  baseUrl: string;
  apiKey: string;
  defaultBrandId: number;
  ticketPortalValue: string;
  topicFieldKey?: string;
  topicTagToIdMap?: Map<string, number>;
  taggerTags?: Set<string>;
  zdIdFieldKey?: string;
  logger?: Logger;
}

export class BoldDeskConnector implements DestinationConnector {
  private readonly client: BoldDeskClient;
  private readonly brandId: number;
  private readonly ticketPortalValue: string;
  private readonly topicFieldKey: string | undefined;
  private readonly topicTagToIdMap: Map<string, number>;
  private readonly taggerTags: Set<string>;
  private readonly zdIdFieldKey: string | undefined;
  private readonly logger: Logger | undefined;

  constructor(config: BoldDeskConfig) {
    this.client = new BoldDeskClient(config);
    this.brandId = config.defaultBrandId;
    this.ticketPortalValue = config.ticketPortalValue;
    this.topicFieldKey = config.topicFieldKey || undefined;
    this.topicTagToIdMap = config.topicTagToIdMap ?? new Map();
    this.taggerTags = config.taggerTags ?? new Set();
    this.zdIdFieldKey = config.zdIdFieldKey || undefined;
    this.logger = config.logger;
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

    const customFields: Record<string, unknown> = {};

    // Topic: fail-closed — throws TopicMappingError if source tag exists but has no mapping
    const topicResolution = resolveTopicValue(
      ticket.customFields, this.topicTagToIdMap, ticket.sourceId,
    );
    if (topicResolution && this.topicFieldKey) {
      customFields[this.topicFieldKey] = topicResolution.bolddeskId;
      this.logger?.debug(
        {
          ticketSourceId: ticket.sourceId,
          sourceTag: topicResolution.sourceTag,
          bolddeskId: topicResolution.bolddeskId,
          topicFieldKey: this.topicFieldKey,
        },
        "Topic resolved to BoldDesk dropdown ID",
      );
    }

    if (this.zdIdFieldKey) {
      customFields[this.zdIdFieldKey] = ticket.sourceId;
    }

    const provenanceBlock = buildTicketProvenanceBlock({
      zendeskTicketId: ticket.sourceId,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    });
    const description = provenanceBlock + (ticket.htmlDescription ?? ticket.description);

    const statusId = BOLDDESK_STATUS_IDS[statusKey] ?? BOLDDESK_STATUS_IDS.new;
    const priorityId = priorityKey
      ? BOLDDESK_PRIORITY_IDS[priorityKey] ?? BOLDDESK_PRIORITY_IDS.medium
      : BOLDDESK_PRIORITY_IDS.medium;

    this.logger?.debug(
      { ticketSourceId: ticket.sourceId, statusKey, statusId, priorityId },
      "Mapped status/priority IDs — validate these match your BoldDesk instance",
    );

    const attachmentTokens = context.attachmentTokens;
    if (attachmentTokens && attachmentTokens.length > 1) {
      this.logger?.debug(
        { ticketSourceId: ticket.sourceId, tokenCount: attachmentTokens.length },
        "Multi-attachment ticket: tokens will be joined as comma-separated string — verify BoldDesk accepts this format",
      );
    }

    const finalCustomFields = Object.keys(customFields).length > 0 ? customFields : undefined;

    this.logger?.info(
      {
        ticketSourceId: ticket.sourceId,
        topicFieldKey: this.topicFieldKey ?? "(not set)",
        topicValue: topicResolution ? topicResolution.bolddeskId : "(no source topic)",
        zdIdFieldKey: this.zdIdFieldKey ?? "(not set)",
        zdSourceId: ticket.sourceId,
        customFields: finalCustomFields,
      },
      "customFields payload for ticket creation",
    );

    const body: BoldDeskCreateTicketRequest = {
      brandId: this.brandId,
      subject: ticket.subject,
      description,
      requesterEmailId: context.requesterEmail,
      requesterName: context.requesterName,
      priorityId,
      statusId,
      tags: normalizeTags(ticket.tags, this.taggerTags),
      isVisibleInCustomerPortal: true,
      ticketPortalValue: this.ticketPortalValue,
      contactGroupId: context.contactGroupDestId
        ? parseInt(context.contactGroupDestId, 10)
        : undefined,
      agentId: context.assigneeAgentId,
      groupId: context.groupId,
      customFields: finalCustomFields,
      attachments: attachmentTokens?.length
        ? attachmentTokens.join(",")
        : undefined,
    };

    const result = await this.client.post<BoldDeskCreateTicketResponse>(
      "/api/v1.0/tickets",
      body,
      { skipDependencyValidation: true },
    );

    return { destinationId: String(result.id) };
  }

  // -----------------------------------------------------------------------
  // Conversation items (comments / notes)
  // -----------------------------------------------------------------------

  async addComment(
    ticketDestId: string,
    comment: NormalizedComment,
    attachmentTokens?: string[],
    commentContext?: CommentContext,
  ): Promise<CreatedEntity> {
    if (comment.isPublic) {
      return this.addReply(ticketDestId, comment, attachmentTokens, commentContext);
    }
    return this.addNote(ticketDestId, comment, attachmentTokens, commentContext);
  }

  private async addReply(
    ticketDestId: string,
    comment: NormalizedComment,
    attachmentTokens?: string[],
    commentContext?: CommentContext,
  ): Promise<CreatedEntity> {
    const provenanceHeader = buildCommentProvenanceHeader({
      authorName: commentContext?.authorName,
      authorEmail: commentContext?.authorEmail,
      authorSourceId: comment.authorSourceId,
      createdAt: comment.createdAt,
      isPublic: true,
    });
    const description = provenanceHeader + (comment.htmlBody ?? comment.body);

    if (attachmentTokens && attachmentTokens.length > 1) {
      this.logger?.debug(
        { ticketDestId, commentSourceId: comment.sourceId, tokenCount: attachmentTokens.length },
        "Multi-attachment reply: tokens joined as comma-separated string",
      );
    }

    const body: BoldDeskCreateReplyRequest = {
      description,
      skipEmailNotification: true,
      dontAppendOnBehalfOfRequesterMessage: true,
      updateDetailsFromPortal: false,
      // Best-effort: BoldDesk may honour this for agent emails only
      updatedByuserIdorEmailId: commentContext?.authorEmail,
      attachments: attachmentTokens?.length ? attachmentTokens.join(",") : undefined,
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
    attachmentTokens?: string[],
    commentContext?: CommentContext,
  ): Promise<CreatedEntity> {
    const provenanceHeader = buildCommentProvenanceHeader({
      authorName: commentContext?.authorName,
      authorEmail: commentContext?.authorEmail,
      authorSourceId: comment.authorSourceId,
      createdAt: comment.createdAt,
      isPublic: false,
    });
    const description = provenanceHeader + (comment.htmlBody ?? comment.body);

    if (attachmentTokens && attachmentTokens.length > 1) {
      this.logger?.debug(
        { ticketDestId, commentSourceId: comment.sourceId, tokenCount: attachmentTokens.length },
        "Multi-attachment note: tokens joined as comma-separated string",
      );
    }

    const body: BoldDeskCreateNoteRequest = {
      description,
      skipEmailNotification: true,
      updatedByuserIdorEmailId: commentContext?.authorEmail,
      attachments: attachmentTokens?.length ? attachmentTokens.join(",") : undefined,
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
      "/api/v1/attachments",
      attachment.fileName,
      fileBuffer,
      attachment.contentType,
    );

    return { destinationId: result.token };
  }
}
