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
