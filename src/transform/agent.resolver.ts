import { Logger } from "../logger";

export interface AgentMapping {
  email: string;
  agentId: number;
}

/**
 * Resolves Zendesk assignee emails to BoldDesk numeric agent IDs.
 *
 * Primary: deterministic lookup from a preloaded email→agentId map.
 * Fallback (optional): runtime fetch from the BoldDesk agents API.
 */
export class AgentResolver {
  private readonly map = new Map<string, number>();

  constructor(
    staticMappings: AgentMapping[],
    private readonly logger: Logger,
    private readonly apiFallback?: (email: string) => Promise<number | null>,
  ) {
    for (const m of staticMappings) {
      this.map.set(m.email.toLowerCase().trim(), m.agentId);
    }
    logger.info(
      { count: this.map.size },
      "AgentResolver initialized with static mappings",
    );
  }

  async resolve(email: string): Promise<number | undefined> {
    const key = email.toLowerCase().trim();

    const staticId = this.map.get(key);
    if (staticId !== undefined) {
      this.logger.debug({ email: key, agentId: staticId }, "Agent resolved via static map");
      return staticId;
    }

    if (this.apiFallback) {
      const apiId = await this.apiFallback(key);
      if (apiId !== null) {
        this.map.set(key, apiId);
        this.logger.info({ email: key, agentId: apiId }, "Agent resolved via API fallback (cached)");
        return apiId;
      }
    }

    this.logger.warn({ email: key }, "Agent not found — ticket will be created unassigned");
    return undefined;
  }

  get size(): number {
    return this.map.size;
  }
}
