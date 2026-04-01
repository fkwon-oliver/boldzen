import { Pool } from "pg";
import { MappingRepository } from "../mapping.repository";
import { EntityMapping, MappedEntityType } from "../../models";

export class PgMappingRepository implements MappingRepository {
  constructor(private readonly pool: Pool) {}

  async save(mapping: EntityMapping): Promise<void> {
    await this.pool.query(
      `INSERT INTO entity_mappings (entity_type, source_id, destination_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (entity_type, source_id) DO UPDATE SET destination_id = $3`,
      [mapping.entityType, mapping.sourceId, mapping.destinationId],
    );
  }

  async findBySource(
    entityType: MappedEntityType,
    sourceId: string,
  ): Promise<EntityMapping | null> {
    const result = await this.pool.query(
      `SELECT id, entity_type, source_id, destination_id, created_at
       FROM entity_mappings WHERE entity_type = $1 AND source_id = $2`,
      [entityType, sourceId],
    );
    if (result.rows.length === 0) return null;
    return this.toMapping(result.rows[0]);
  }

  async findAllByType(entityType: MappedEntityType): Promise<EntityMapping[]> {
    const result = await this.pool.query(
      `SELECT id, entity_type, source_id, destination_id, created_at
       FROM entity_mappings WHERE entity_type = $1`,
      [entityType],
    );
    return result.rows.map(this.toMapping);
  }

  async exists(entityType: MappedEntityType, sourceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM entity_mappings WHERE entity_type = $1 AND source_id = $2`,
      [entityType, sourceId],
    );
    return result.rows.length > 0;
  }

  private toMapping(row: Record<string, unknown>): EntityMapping {
    return {
      id: row.id as number,
      entityType: row.entity_type as MappedEntityType,
      sourceId: row.source_id as string,
      destinationId: row.destination_id as string,
      createdAt: (row.created_at as Date).toISOString(),
    };
  }
}
