import { FailedItem, TicketSyncState } from "../models";

export interface SyncStateInput {
  hasTicketMapping: boolean;
  failedItems: FailedItem[];
}

/**
 * Deterministically derive a ticket's sync state from mapping + failed-item data.
 *
 * Only unresolved items (status !== "resolved") are considered blockers.
 * Exhausted items → failed (terminal).  Pending items → partial (retryable).
 */
export function deriveTicketSyncState(input: SyncStateInput): TicketSyncState {
  if (!input.hasTicketMapping) return "pending";

  const unresolved = input.failedItems.filter((i) => i.status !== "resolved");

  if (unresolved.length === 0) return "complete";

  if (unresolved.some((i) => i.status === "exhausted")) return "failed";

  return "partial";
}
