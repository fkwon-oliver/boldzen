import { TicketPriority } from "../models";

export type BoldDeskPriority = "low" | "medium" | "high" | "urgent";

const PRIORITY_MAP: Record<TicketPriority, BoldDeskPriority> = {
  low: "low",
  normal: "medium",
  high: "high",
  urgent: "urgent",
};

export function mapTicketPriority(
  zendeskPriority: TicketPriority | undefined,
): BoldDeskPriority | undefined {
  if (!zendeskPriority) return undefined;
  const mapped = PRIORITY_MAP[zendeskPriority];
  if (!mapped) {
    throw new Error(`Unknown Zendesk priority: ${zendeskPriority}`);
  }
  return mapped;
}
