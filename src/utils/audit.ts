import { AuditLogModel } from "../models/audit-log.model.js";

export async function audit(action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  await AuditLogModel.create({
    action,
    entityType,
    entityId,
    metadata
  });
}
