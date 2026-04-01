export type MappedEntityType =
  | "user"
  | "organization"
  | "ticket"
  | "comment"
  | "attachment";

export interface EntityMapping {
  id?: number;
  entityType: MappedEntityType;
  sourceId: string;
  destinationId: string;
  createdAt: string;
}
