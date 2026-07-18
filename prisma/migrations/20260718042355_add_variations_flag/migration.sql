-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "itemNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isVariations" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Trade_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Trade" ("id", "itemNo", "name", "projectId", "sortOrder") SELECT "id", "itemNo", "name", "projectId", "sortOrder" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
CREATE INDEX "Trade_projectId_idx" ON "Trade"("projectId");
CREATE UNIQUE INDEX "Trade_projectId_itemNo_key" ON "Trade"("projectId", "itemNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
