import { Logger } from "../logger";

export interface GroupMapping {
  groupName: string;
  groupId: number;
}

/**
 * Resolves Zendesk group names to BoldDesk numeric group IDs
 * using a static name→ID map. Lookup is case-insensitive.
 */
export class GroupResolver {
  private readonly map = new Map<string, number>();
  private readonly agentGroupMap = new Map<string, string>();

  constructor(
    staticMappings: GroupMapping[],
    private readonly logger: Logger,
  ) {
    for (const m of staticMappings) {
      this.map.set(m.groupName.toLowerCase().trim(), m.groupId);
    }
    logger.info(
      { count: this.map.size },
      "GroupResolver initialized with static mappings",
    );
  }

  setAgentGroupMap(emailToGroup: Map<string, string>): void {
    for (const [email, group] of emailToGroup) {
      this.agentGroupMap.set(email.toLowerCase().trim(), group);
    }
    this.logger.info(
      { count: this.agentGroupMap.size },
      "GroupResolver loaded agent→group associations",
    );
  }

  resolveByGroupName(groupName: string): number | undefined {
    const key = groupName.toLowerCase().trim();
    const id = this.map.get(key);
    if (id !== undefined) {
      this.logger.debug({ groupName: key, groupId: id }, "Group resolved via static map");
      return id;
    }
    this.logger.warn({ groupName: key }, "Group not mapped — ticket will be created without group");
    return undefined;
  }

  resolveByAgentEmail(email: string): number | undefined {
    const key = email.toLowerCase().trim();
    const groupName = this.agentGroupMap.get(key);
    if (!groupName) {
      this.logger.debug({ email: key }, "No group association found for agent");
      return undefined;
    }
    return this.resolveByGroupName(groupName);
  }

  get size(): number {
    return this.map.size;
  }
}
