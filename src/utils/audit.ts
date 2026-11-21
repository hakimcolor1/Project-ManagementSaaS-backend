import type { Prisma } from "../generated/prisma/client.js";
import type { AuditAction, AuditEntity } from "../generated/prisma/enums.js";
import type { Tx } from "../lib/prisma.js";

type AuditEntry = {
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  metadata?: Prisma.InputJsonObject;
};

/**
 * Writes one audit log row. Always pass the transaction client of the change it describes,
 * so the change and its log row are saved together or not at all (BR-25).
 */
export async function writeAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({ data: entry, select: { id: true } });
}
