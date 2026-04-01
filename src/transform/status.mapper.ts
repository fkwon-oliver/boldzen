import { TicketStatus } from "../models";

/**
 * Maps Zendesk ticket statuses to BoldDesk equivalents.
 * This is a critical mapping — see docs/status-and-ownership-rules.md for context.
 */

export type BoldDeskStatus = "new" | "open" | "pending" | "on_hold" | "resolved" | "closed";

const STATUS_MAP: Record<TicketStatus, BoldDeskStatus> = {
  new: "new",
  open: "open",
  pending: "pending",
  hold: "on_hold",
  solved: "resolved",
  closed: "closed",
};

export function mapTicketStatus(zendeskStatus: TicketStatus): BoldDeskStatus {
  const mapped = STATUS_MAP[zendeskStatus];
  if (!mapped) {
    throw new Error(`Unknown Zendesk status: ${zendeskStatus}`);
  }
  return mapped;
}
