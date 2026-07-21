-- AlterTable: add ClaimLine's own snapshot columns, nullable at first so we
-- can backfill from the current LineItem before enforcing NOT NULL.
ALTER TABLE "ClaimLine" ADD COLUMN     "contractSumCents" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isHeader" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing rows from the LineItem they were originally created
-- from, so every already-submitted/approved claim keeps showing exactly
-- what it always has.
UPDATE "ClaimLine" cl
SET "description" = li.description,
    "contractSumCents" = li."contractSumCents",
    "isHeader" = li."isHeader"
FROM "LineItem" li
WHERE li.id = cl."lineItemId";

ALTER TABLE "ClaimLine" ALTER COLUMN "description" SET NOT NULL;
