import { NormalizedAttachment } from "./attachment";

export interface NormalizedComment {
  sourceId: string;
  ticketSourceId: string;
  authorSourceId: string;
  body: string;
  htmlBody?: string;
  isPublic: boolean;
  createdAt: string;
  attachments: NormalizedAttachment[];
  raw?: Record<string, unknown>;
}
