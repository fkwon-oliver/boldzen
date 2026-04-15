export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly entityType: string,
    public readonly sourceId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly connector: "zendesk" | "bolddesk",
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export class MappingNotFoundError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly sourceId: string,
  ) {
    super(`No mapping found for ${entityType} with source ID ${sourceId}`);
    this.name = "MappingNotFoundError";
  }
}

/**
 * Classify whether an error is transient (worth retrying at the application level)
 * vs permanent (data issue, 4xx client error, missing mapping).
 *
 * HTTP-level retries (429, 5xx) are already handled inside the clients.
 * This classifier operates at the entity-migration level.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof MappingNotFoundError) return false;

  if (err instanceof ConnectorError) {
    const status = err.statusCode;
    if (!status) return true; // network / timeout — transient
    if (status === 429 || status >= 500) return true;
    return false; // 4xx (except 429) — permanent
  }

  if (err instanceof MigrationError) return false;

  // TopicMappingError is a data-quality issue — never transient
  if (err && typeof err === "object" && "name" in err && (err as Error).name === "TopicMappingError") {
    return false;
  }

  // Unknown errors are assumed transient (safe to retry)
  return true;
}
