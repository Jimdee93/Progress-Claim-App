-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "claimNumber" INTEGER NOT NULL,
    "periodEndDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "retentionHeldCents" BIGINT NOT NULL DEFAULT 0,
    "previousRetentionHeldCents" BIGINT NOT NULL DEFAULT 0,
    "retentionManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "retentionNote" TEXT,
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("approvedAt", "claimNumber", "createdAt", "id", "periodEndDate", "projectId", "retentionHeldCents", "retentionManualOverride", "retentionNote", "status", "submittedAt", "updatedAt") SELECT "approvedAt", "claimNumber", "createdAt", "id", "periodEndDate", "projectId", "retentionHeldCents", "retentionManualOverride", "retentionNote", "status", "submittedAt", "updatedAt" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE INDEX "Claim_projectId_idx" ON "Claim"("projectId");
CREATE UNIQUE INDEX "Claim_projectId_claimNumber_key" ON "Claim"("projectId", "claimNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
