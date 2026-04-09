import { deriveTicketSyncState, SyncStateInput } from "@/pilot/sync-state";
import { FailedItem } from "@/models";

function makeFailedItem(overrides: Partial<FailedItem> = {}): FailedItem {
  return {
    id: 1,
    jobId: 100,
    entityType: "comment",
    sourceId: "c1",
    error: "API error",
    retryCount: 0,
    lastAttemptAt: "2024-01-01T00:00:00Z",
    status: "pending",
    metadata: { ticketSourceId: "t1" },
    ...overrides,
  };
}

describe("deriveTicketSyncState", () => {
  it("returns 'pending' when no ticket mapping exists", () => {
    expect(
      deriveTicketSyncState({ hasTicketMapping: false, failedItems: [] }),
    ).toBe("pending");
  });

  it("returns 'pending' even if failed items exist but no mapping", () => {
    const input: SyncStateInput = {
      hasTicketMapping: false,
      failedItems: [makeFailedItem({ entityType: "ticket", sourceId: "t1" })],
    };
    expect(deriveTicketSyncState(input)).toBe("pending");
  });

  it("returns 'complete' when mapping exists and no unresolved failures", () => {
    expect(
      deriveTicketSyncState({ hasTicketMapping: true, failedItems: [] }),
    ).toBe("complete");
  });

  it("returns 'complete' when all failures are resolved", () => {
    const input: SyncStateInput = {
      hasTicketMapping: true,
      failedItems: [
        makeFailedItem({ status: "resolved" }),
        makeFailedItem({ id: 2, status: "resolved" }),
      ],
    };
    expect(deriveTicketSyncState(input)).toBe("complete");
  });

  it("returns 'partial' when pending (retryable) failures exist", () => {
    const input: SyncStateInput = {
      hasTicketMapping: true,
      failedItems: [makeFailedItem({ status: "pending" })],
    };
    expect(deriveTicketSyncState(input)).toBe("partial");
  });

  it("returns 'partial' with a mix of resolved and pending", () => {
    const input: SyncStateInput = {
      hasTicketMapping: true,
      failedItems: [
        makeFailedItem({ id: 1, status: "resolved" }),
        makeFailedItem({ id: 2, status: "pending" }),
      ],
    };
    expect(deriveTicketSyncState(input)).toBe("partial");
  });

  it("returns 'failed' when any item is exhausted", () => {
    const input: SyncStateInput = {
      hasTicketMapping: true,
      failedItems: [makeFailedItem({ status: "exhausted", retryCount: 3 })],
    };
    expect(deriveTicketSyncState(input)).toBe("failed");
  });

  it("returns 'failed' when exhausted items coexist with pending", () => {
    const input: SyncStateInput = {
      hasTicketMapping: true,
      failedItems: [
        makeFailedItem({ id: 1, status: "pending" }),
        makeFailedItem({ id: 2, status: "exhausted" }),
      ],
    };
    expect(deriveTicketSyncState(input)).toBe("failed");
  });

  it("returns 'complete' when exhausted items are all resolved", () => {
    const input: SyncStateInput = {
      hasTicketMapping: true,
      failedItems: [
        makeFailedItem({ id: 1, status: "resolved" }),
      ],
    };
    expect(deriveTicketSyncState(input)).toBe("complete");
  });
});
