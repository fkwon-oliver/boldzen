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

export interface DestinationConnector {
  createContact(user: NormalizedUser): Promise<CreatedEntity>;
  createOrganization(org: NormalizedOrganization): Promise<CreatedEntity>;
  createTicket(ticket: NormalizedTicket): Promise<CreatedEntity>;
  addComment(ticketDestId: string, comment: NormalizedComment): Promise<CreatedEntity>;

  uploadAttachment(
    attachment: NormalizedAttachment,
    fileBuffer: Buffer,
  ): Promise<CreatedEntity>;

  findContactByEmail(email: string): Promise<CreatedEntity | null>;
  findOrganizationByName(name: string): Promise<CreatedEntity | null>;
}
