import {
  NormalizedTicket,
  NormalizedComment,
  NormalizedUser,
  NormalizedOrganization,
  NormalizedAttachment,
} from "../models";

export interface CreatedEntity {
  destinationId: string;
}

/** Resolved references the migration service passes to the connector at ticket creation time. */
export interface TicketCreationContext {
  requesterEmail: string;
  requesterName: string;
  contactGroupDestId?: string;
  assigneeEmail?: string;
}

export interface DestinationConnector {
  createContact(user: NormalizedUser): Promise<CreatedEntity>;
  createOrganization(org: NormalizedOrganization): Promise<CreatedEntity>;
  createTicket(ticket: NormalizedTicket, context: TicketCreationContext): Promise<CreatedEntity>;
  addComment(ticketDestId: string, comment: NormalizedComment): Promise<CreatedEntity>;

  uploadAttachment(
    attachment: NormalizedAttachment,
    fileBuffer: Buffer,
  ): Promise<CreatedEntity>;

  findContactByEmail(email: string): Promise<CreatedEntity | null>;
  findOrganizationByName(name: string): Promise<CreatedEntity | null>;
}
