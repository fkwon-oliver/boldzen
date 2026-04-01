export type UserRole = "end_user" | "agent" | "admin";

export interface NormalizedUser {
  sourceId: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  organizationSourceId?: string;
  active: boolean;
  raw?: Record<string, unknown>;
}
