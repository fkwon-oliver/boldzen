export interface NormalizedOrganization {
  sourceId: string;
  name: string;
  description?: string;
  domainNames: string[];
  tags: string[];
  raw?: Record<string, unknown>;
}
