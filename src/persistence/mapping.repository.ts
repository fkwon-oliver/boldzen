import { EntityMapping, MappedEntityType } from "../models";

export interface MappingRepository {
  save(mapping: EntityMapping): Promise<void>;
  findBySource(entityType: MappedEntityType, sourceId: string): Promise<EntityMapping | null>;
  findAllByType(entityType: MappedEntityType): Promise<EntityMapping[]>;
  exists(entityType: MappedEntityType, sourceId: string): Promise<boolean>;
}
