import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";

export class RolloverError extends Error {}

// Creates the next claim, carrying each line's certified cumulative %/$ from
// the prior APPROVED claim forward as this claim's starting point — the
// "reset for next month" automation. Previous % is re-derived from
// certified $ / contract sum (not copied from the prior claim's own %), so
// a certified figure that differs from what was claimed never drifts out of
// sync with the contract sum — same convention as the source workbook's own
// "PREVIOUS % COMPLETE = PREVIOUS CLAIM / TOTAL" formula.
export async function createNextClaim(projectId: string, periodEndDate: Date) {
  const latest = await prisma.claim.findFirst({
    where: { projectId },
    orderBy: { claimNumber: "desc" },
    include: { claimLines: { include: { lineItem: true } } },
  });

  if (!latest) {
    throw new RolloverError("No existing claim to roll forward from — import a workbook first.");
  }
  if (latest.status !== "APPROVED") {
    throw new RolloverError(
      `Claim No.${latest.claimNumber} must be certified (APPROVED) before starting the next claim.`
    );
  }

  return prisma.$transaction(async (tx) => {
    const nextClaim = await tx.claim.create({
      data: {
        projectId,
        claimNumber: latest.claimNumber + 1,
        periodEndDate,
        status: "DRAFT",
        retentionHeldCents: latest.retentionHeldCents,
        previousRetentionHeldCents: latest.retentionHeldCents,
      },
    });

    const claimLineRows = latest.claimLines.map((cl) => {
      const certified = cl.certifiedThisClaimCents ?? 0n;
      const cumulativeCertifiedCents = cl.previousClaimCents + certified;
      const contractSum = cl.lineItem.contractSumCents;
      // contractSum can be negative (variation credits) — only guard the
      // true zero case, a plain truthiness/">0" check would wrongly zero
      // out every credit line's carried-forward percentage.
      const previousPercentBps =
        contractSum !== 0n ? Number((cumulativeCertifiedCents * 1_000_000n) / contractSum) : 0;

      return {
        id: randomUUID(),
        claimId: nextClaim.id,
        lineItemId: cl.lineItemId,
        percentCompleteBps: previousPercentBps,
        previousPercentBps,
        previousClaimCents: cumulativeCertifiedCents,
        certifiedThisClaimCents: null,
      };
    });
    await tx.claimLine.createMany({ data: claimLineRows });

    return nextClaim;
  }, { timeout: 60_000 });
}
