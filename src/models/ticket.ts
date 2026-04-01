import { NormalizedComment } from "./comment";

export type TicketStatus = "new" | "open" | "pending" | "hold" | "solved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface NormalizedTicket {
  sourceId: string;
  subject: string;
  description: string;
  htmlDescription?: string;
  status: TicketStatus;
  priority?: TicketPriority;
  requesterSourceId: string;
  assigneeSourceId?: string;
  organizationSourceId?: string;
  tags: string[];
  channel?: string;
  createdAt: string;
  updatedAt: string;
  comments: NormalizedComment[];
  customFields: Record<string, unknown>;
  raw?: Record<string, unknown>;
}
