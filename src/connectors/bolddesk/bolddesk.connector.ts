import { DestinationConnector, CreatedEntity } from "../destination.interface";
import {
  NormalizedTicket,
  NormalizedComment,
  NormalizedUser,
  NormalizedOrganization,
  NormalizedAttachment,
} from "../../models";

export interface BoldDeskConfig {
  baseUrl: string;
  apiKey: string;
}

export class BoldDeskConnector implements DestinationConnector {
  constructor(private readonly config: BoldDeskConfig) {}

  async createContact(_user: NormalizedUser): Promise<CreatedEntity> {
    // TODO: implement BoldDesk contact creation API
    throw new Error("Not implemented");
  }

  async createOrganization(
    _org: NormalizedOrganization,
  ): Promise<CreatedEntity> {
    // TODO: implement BoldDesk organization creation API
    throw new Error("Not implemented");
  }

  async createTicket(_ticket: NormalizedTicket): Promise<CreatedEntity> {
    // TODO: implement BoldDesk ticket creation API
    throw new Error("Not implemented");
  }

  async addComment(
    _ticketDestId: string,
    _comment: NormalizedComment,
  ): Promise<CreatedEntity> {
    // TODO: implement BoldDesk conversation item API (public reply vs internal note)
    throw new Error("Not implemented");
  }

  async uploadAttachment(
    _attachment: NormalizedAttachment,
    _fileBuffer: Buffer,
  ): Promise<CreatedEntity> {
    // TODO: implement BoldDesk attachment upload + binding
    throw new Error("Not implemented");
  }

  async findContactByEmail(_email: string): Promise<CreatedEntity | null> {
    // TODO: implement BoldDesk contact lookup
    throw new Error("Not implemented");
  }

  async findOrganizationByName(
    _name: string,
  ): Promise<CreatedEntity | null> {
    // TODO: implement BoldDesk org lookup
    throw new Error("Not implemented");
  }
}
