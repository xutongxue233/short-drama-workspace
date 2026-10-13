import type { PublicUser } from "../../types";

export interface AuthSession {
  setupRequired: boolean;
  user: PublicUser | null;
  csrfToken?: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  actorId?: string;
  actorName?: string;
  targetId?: string;
  createdAt: string;
  outcome?: string;
}
