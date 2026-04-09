import { ZendeskConnector, ZendeskTicketUpdate } from "../connectors/zendesk/zendesk.connector";
import { MappingRepository } from "../persistence/mapping.repository";
import { JobRepository } from "../persistence/job.repository";
import { AuditRepository } from "../persistence/audit.repository";
import { MigrationService } from "../migration/migration.service";
import { TicketSyncState } from "../models";
import { Logger } from "../logger";
import { deriveTicketSyncState } from "./sync-state";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PilotConfig {
  ownerSystemFieldId: number;
  syncStateFieldId: number;
  bolddeskTicketIdFieldId: number;
  handoffTag: string;
  pendingSyncTag: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface HandoffResult {
  ticketSourceId: string;
  ticketDestId: string;
  status: "handed_off" | "already_active" | "blocked" | "failed";
  syncState?: TicketSyncState;
  blockedReasons?: string[];
  error?: string;
}

export interface RollbackResult {
  ticketSourceId: string;
  status: "rolled_back" | "not_active" | "failed";
  error?: string;
}

export interface PilotStatusResult {
  ticketSourceId: string;
  ownerSystem: "zendesk" | "bolddesk" | "unknown";
  derivedSyncState: TicketSyncState;
  zendeskSyncField: string;
  bolddeskTicketId: string | null;
  hasMigrationMapping: boolean;
  unresolvedFailedItems: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PilotOwnershipService {
  constructor(
    private readonly source: ZendeskConnector,
    private readonly mappings: MappingRepository,
    private readonly jobs: JobRepository,
    private readonly audit: AuditRepository,
    private readonly migration: MigrationService,
    private readonly config: PilotConfig,
    private readonly logger: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // Handoff — strict gate: sync state must be "complete"
  // -------------------------------------------------------------------------

  async handoff(zendeskTicketId: string): Promise<HandoffResult> {
    this.validateConfig();

    const ticket = await this.source.fetchTicketById(zendeskTicketId);
    const currentOwner = this.readCustomField(ticket.customFields, this.config.ownerSystemFieldId);
    const currentZdSync = this.readCustomField(ticket.customFields, this.config.syncStateFieldId);

    // Already active — idempotent success, but re-verify derived state
    if (currentOwner === "bolddesk" && currentZdSync === "pilot_active") {
      const existing = await this.mappings.findBySource("ticket", zendeskTicketId);
      const failedItems = await this.jobs.getFailedItemsForTicket(zendeskTicketId);
      const syncState = deriveTicketSyncState({
        hasTicketMapping: !!existing,
        failedItems,
      });

      if (syncState !== "complete") {
        const unresolvedCount = failedItems.filter((i) => i.status !== "resolved").length;
        this.logger.warn(
          { ticketId: zendeskTicketId, syncState, unresolvedCount },
          "Ticket is already_active in Zendesk but derived sync state has degraded",
        );
        await this.audit.log({
          entityType: "ticket",
          sourceId: zendeskTicketId,
          action: "pilot_handoff_degraded",
          detail: { syncState, unresolvedCount },
        });
      }

      return {
        ticketSourceId: zendeskTicketId,
        ticketDestId: existing?.destinationId ?? "",
        status: "already_active",
        syncState,
      };
    }

    // ── Gate checks ────────────────────────────────────────────
    const blockedReasons: string[] = [];

    if (ticket.status === "closed") {
      blockedReasons.push("Ticket is closed in Zendesk");
    }

    if (currentOwner === "bolddesk") {
      blockedReasons.push(`Ticket already owned by bolddesk (sync_state=${currentZdSync})`);
    }

    const mapping = await this.mappings.findBySource("ticket", zendeskTicketId);
    const failedItems = await this.jobs.getFailedItemsForTicket(zendeskTicketId);
    const syncState = deriveTicketSyncState({
      hasTicketMapping: !!mapping,
      failedItems,
    });

    if (syncState !== "complete") {
      const unresolvedCount = failedItems.filter((i) => i.status !== "resolved").length;
      blockedReasons.push(
        `Derived sync state is "${syncState}" (requires "complete"). ` +
        `Unresolved failed items: ${unresolvedCount}`,
      );
    }

    if (blockedReasons.length > 0) {
      this.logger.warn(
        { ticketId: zendeskTicketId, syncState, blockedReasons },
        "Handoff blocked",
      );

      await this.audit.log({
        entityType: "ticket",
        sourceId: zendeskTicketId,
        action: "pilot_handoff_blocked",
        detail: { syncState, blockedReasons },
      });

      return {
        ticketSourceId: zendeskTicketId,
        ticketDestId: mapping?.destinationId ?? "",
        status: "blocked",
        syncState,
        blockedReasons,
      };
    }

    // ── Gate passed — execute handoff ──────────────────────────
    const bolddeskId = mapping!.destinationId;

    try {
      const update: ZendeskTicketUpdate = {
        custom_fields: [
          { id: this.config.ownerSystemFieldId, value: "bolddesk" },
          { id: this.config.syncStateFieldId, value: "pilot_active" },
          { id: this.config.bolddeskTicketIdFieldId, value: bolddeskId },
        ],
        additional_tags: [this.config.handoffTag],
        comment: {
          body: `This ticket is now managed in BoldDesk (ticket #${bolddeskId}). Do not work this ticket in Zendesk.`,
          public: false,
        },
      };

      await this.source.updateTicket(zendeskTicketId, update);

      await this.audit.log({
        entityType: "ticket",
        sourceId: zendeskTicketId,
        action: "pilot_handoff",
        detail: {
          bolddeskTicketId: bolddeskId,
          previousOwner: currentOwner ?? "zendesk",
          previousSyncState: currentZdSync ?? "not_synced",
        },
      });

      this.logger.info(
        { ticketId: zendeskTicketId, bolddeskId },
        "Pilot handoff complete",
      );

      return {
        ticketSourceId: zendeskTicketId,
        ticketDestId: bolddeskId,
        status: "handed_off",
        syncState: "complete",
      };
    } catch (err) {
      this.logger.error({ ticketId: zendeskTicketId, err }, "Handoff write-back failed");

      try {
        await this.source.updateTicket(zendeskTicketId, {
          custom_fields: [
            { id: this.config.ownerSystemFieldId, value: "zendesk" },
            { id: this.config.syncStateFieldId, value: "sync_error" },
          ],
        });
      } catch {
        this.logger.error({ ticketId: zendeskTicketId }, "Failed to revert ownership and set sync_error");
      }

      await this.audit.log({
        entityType: "ticket",
        sourceId: zendeskTicketId,
        action: "pilot_handoff_failed",
        detail: { error: String(err) },
      });

      return {
        ticketSourceId: zendeskTicketId,
        ticketDestId: bolddeskId,
        status: "failed",
        error: String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Rollback
  // -------------------------------------------------------------------------

  async rollback(zendeskTicketId: string): Promise<RollbackResult> {
    this.validateConfig();

    const ticket = await this.source.fetchTicketById(zendeskTicketId);
    const currentOwner = this.readCustomField(ticket.customFields, this.config.ownerSystemFieldId);

    if (currentOwner !== "bolddesk") {
      return { ticketSourceId: zendeskTicketId, status: "not_active" };
    }

    try {
      const update: ZendeskTicketUpdate = {
        custom_fields: [
          { id: this.config.ownerSystemFieldId, value: "zendesk" },
          { id: this.config.syncStateFieldId, value: "migrated" },
        ],
        remove_tags: [this.config.handoffTag],
        comment: {
          body: "Ticket returned to Zendesk ownership.",
          public: false,
        },
      };

      await this.source.updateTicket(zendeskTicketId, update);

      await this.audit.log({
        entityType: "ticket",
        sourceId: zendeskTicketId,
        action: "pilot_rollback",
        detail: { previousOwner: "bolddesk" },
      });

      this.logger.info({ ticketId: zendeskTicketId }, "Pilot rollback complete");
      return { ticketSourceId: zendeskTicketId, status: "rolled_back" };
    } catch (err) {
      this.logger.error({ ticketId: zendeskTicketId, err }, "Rollback failed");
      return {
        ticketSourceId: zendeskTicketId,
        status: "failed",
        error: String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Status — returns derived sync state (not just Zendesk field)
  // -------------------------------------------------------------------------

  async status(zendeskTicketId: string): Promise<PilotStatusResult> {
    const ticket = await this.source.fetchTicketById(zendeskTicketId);
    const mapping = await this.mappings.findBySource("ticket", zendeskTicketId);
    const failedItems = await this.jobs.getFailedItemsForTicket(zendeskTicketId);

    const derivedSyncState = deriveTicketSyncState({
      hasTicketMapping: !!mapping,
      failedItems,
    });

    const ownerRaw = this.readCustomField(ticket.customFields, this.config.ownerSystemFieldId);
    const zdSync = this.readCustomField(ticket.customFields, this.config.syncStateFieldId);
    const bdId = this.readCustomField(ticket.customFields, this.config.bolddeskTicketIdFieldId);

    return {
      ticketSourceId: zendeskTicketId,
      ownerSystem: ownerRaw === "bolddesk" ? "bolddesk" : ownerRaw === "zendesk" ? "zendesk" : "unknown",
      derivedSyncState,
      zendeskSyncField: typeof zdSync === "string" ? zdSync : "not_synced",
      bolddeskTicketId: typeof bdId === "string" ? bdId : null,
      hasMigrationMapping: !!mapping,
      unresolvedFailedItems: failedItems.filter((i) => i.status !== "resolved").length,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readCustomField(fields: Record<string, unknown>, fieldId: number): unknown {
    return fields[String(fieldId)] ?? null;
  }

  private validateConfig(): void {
    if (!this.config.ownerSystemFieldId || !this.config.syncStateFieldId || !this.config.bolddeskTicketIdFieldId) {
      throw new Error(
        "Pilot custom field IDs not configured. Set ZD_FIELD_OWNER_SYSTEM, ZD_FIELD_SYNC_STATE, and ZD_FIELD_BOLDDESK_TICKET_ID.",
      );
    }
  }
}
