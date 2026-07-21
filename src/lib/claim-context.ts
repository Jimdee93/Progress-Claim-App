import { prisma } from "./prisma";
import { calcLineItem, rollupTrade, calcClaimCover } from "./calc";
import { centsToNumber } from "./money";

export interface LineItemDTO {
  id: string;
  itemNo: string;
  description: string;
  isHeader: boolean;
  contractSumCents: number;
  percentCompleteBps: number;
  previousPercentBps: number;
  previousClaimCents: number;
  certifiedThisClaimCents: number | null;
  claimToDateCents: number;
  deltaPercentBps: number;
  thisClaimAmountCents: number;
  costToCompleteCents: number;
  // True only when this line item was first added on the claim being
  // viewed (no earlier claim has ever referenced it) — deleting it can't
  // erase a past payment claim's figures.
  canDelete: boolean;
}

export interface TradeDTO {
  id: string;
  itemNo: number;
  name: string;
  isVariations: boolean;
  lineItems: LineItemDTO[];
  rollup: {
    contractSumCents: number;
    claimToDateCents: number;
    previousClaimCents: number;
    thisClaimAmountCents: number;
    costToCompleteCents: number;
    percentCompleteBps: number;
  };
}

export interface ClaimCoverDTO {
  originalContractValueCents: number;
  approvedVariationsCents: number;
  totalContractValueCents: number;
  claimToDateCents: number;
  previousClaimCents: number;
  grossValueThisClaimCents: number;
  suggestedRetentionHeldCents: number;
  retentionHeldCents: number;
  previousRetentionHeldCents: number;
  retentionThisClaimCents: number;
  subTotalAfterRetentionCents: number;
  gstCents: number;
  amountDueCents: number;
  costToCompleteCents: number;
}

export interface ClaimContextDTO {
  claim: {
    id: string;
    claimNumber: number;
    periodEndDate: string;
    status: "DRAFT" | "SUBMITTED" | "APPROVED";
    retentionHeldCents: number;
    previousRetentionHeldCents: number;
    retentionManualOverride: boolean;
    retentionNote: string | null;
  };
  project: {
    id: string;
    name: string;
    originalContractValueCents: number;
    retentionRateBps: number;
    retentionCapCents: number | null;
    gstRateBps: number;
  };
  trades: TradeDTO[];
  cover: ClaimCoverDTO;
  previousClaimId: string | null;
  nextClaimExists: boolean;
}

export async function getClaimContext(claimId: string): Promise<ClaimContextDTO | null> {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      project: true,
      claimLines: {
        include: { lineItem: { include: { trade: true } } },
      },
    },
  });
  if (!claim) return null;

  // A line item is only safe to delete if no other claim (necessarily a
  // past SUBMITTED/APPROVED one, since only one claim per project is ever
  // DRAFT) has ever referenced it.
  const claimLineCounts = await prisma.claimLine.groupBy({
    by: ["lineItemId"],
    where: { lineItemId: { in: claim.claimLines.map((cl) => cl.lineItemId) } },
    _count: { _all: true },
  });
  const otherClaimCount = new Map(claimLineCounts.map((c) => [c.lineItemId, c._count._all]));

  const tradesMap = new Map<string, { trade: (typeof claim.claimLines)[number]["lineItem"]["trade"]; lines: typeof claim.claimLines }>();
  for (const cl of claim.claimLines) {
    const tradeId = cl.lineItem.tradeId;
    if (!tradesMap.has(tradeId)) {
      tradesMap.set(tradeId, { trade: cl.lineItem.trade, lines: [] });
    }
    tradesMap.get(tradeId)!.lines.push(cl);
  }

  const trades: TradeDTO[] = [...tradesMap.values()]
    .sort((a, b) => a.trade.sortOrder - b.trade.sortOrder)
    .map(({ trade, lines }) => {
      const sortedLines = [...lines].sort((a, b) => a.lineItem.sortOrder - b.lineItem.sortOrder);

      const lineResults = sortedLines.map((cl) =>
        calcLineItem({
          lineItemId: cl.lineItemId,
          contractSumCents: cl.contractSumCents,
          percentCompleteBps: cl.percentCompleteBps,
          previousPercentBps: cl.previousPercentBps,
          previousClaimCents: cl.previousClaimCents,
        })
      );

      const rollup = rollupTrade(
        { id: trade.id, name: trade.name, itemNo: trade.itemNo, isVariations: trade.isVariations },
        lineResults.filter((_, i) => !sortedLines[i].isHeader)
      );

      const lineItems: LineItemDTO[] = sortedLines.map((cl, i) => {
        const r = lineResults[i];
        return {
          id: cl.lineItem.id,
          itemNo: cl.lineItem.itemNo,
          description: cl.description,
          isHeader: cl.isHeader,
          contractSumCents: centsToNumber(cl.contractSumCents),
          percentCompleteBps: r.percentCompleteBps,
          previousPercentBps: r.previousPercentBps,
          previousClaimCents: centsToNumber(r.previousClaimCents),
          certifiedThisClaimCents: cl.certifiedThisClaimCents !== null ? centsToNumber(cl.certifiedThisClaimCents) : null,
          claimToDateCents: centsToNumber(r.claimToDateCents),
          deltaPercentBps: r.deltaPercentBps,
          thisClaimAmountCents: centsToNumber(r.thisClaimAmountCents),
          costToCompleteCents: centsToNumber(r.costToCompleteCents),
          canDelete: (otherClaimCount.get(cl.lineItemId) ?? 1) <= 1,
        };
      });

      return {
        id: trade.id,
        itemNo: trade.itemNo,
        name: trade.name,
        isVariations: trade.isVariations,
        lineItems,
        rollup: {
          contractSumCents: centsToNumber(rollup.contractSumCents),
          claimToDateCents: centsToNumber(rollup.claimToDateCents),
          previousClaimCents: centsToNumber(rollup.previousClaimCents),
          thisClaimAmountCents: centsToNumber(rollup.thisClaimAmountCents),
          costToCompleteCents: centsToNumber(rollup.costToCompleteCents),
          percentCompleteBps: rollup.percentCompleteBps,
        },
      };
    });

  const tradeRollupsForCover = [...tradesMap.values()]
    .sort((a, b) => a.trade.sortOrder - b.trade.sortOrder)
    .map(({ trade, lines }) => {
      const lineResults = lines
        .filter((cl) => !cl.isHeader)
        .map((cl) =>
          calcLineItem({
            lineItemId: cl.lineItemId,
            contractSumCents: cl.contractSumCents,
            percentCompleteBps: cl.percentCompleteBps,
            previousPercentBps: cl.previousPercentBps,
            previousClaimCents: cl.previousClaimCents,
          })
        );
      return rollupTrade(
        { id: trade.id, name: trade.name, itemNo: trade.itemNo, isVariations: trade.isVariations },
        lineResults
      );
    });

  const cover = calcClaimCover({
    originalContractValueCents: claim.project.originalContractValueCents,
    retentionRateBps: claim.project.retentionRateBps,
    retentionCapCents: claim.project.retentionCapCents,
    gstRateBps: claim.project.gstRateBps,
    retentionHeldCents: claim.retentionHeldCents,
    previousRetentionHeldCents: claim.previousRetentionHeldCents,
    tradeRollups: tradeRollupsForCover,
  });

  const [previousClaim, nextClaim] = await Promise.all([
    prisma.claim.findUnique({
      where: { projectId_claimNumber: { projectId: claim.projectId, claimNumber: claim.claimNumber - 1 } },
      select: { id: true },
    }),
    prisma.claim.findUnique({
      where: { projectId_claimNumber: { projectId: claim.projectId, claimNumber: claim.claimNumber + 1 } },
      select: { id: true },
    }),
  ]);

  return {
    claim: {
      id: claim.id,
      claimNumber: claim.claimNumber,
      periodEndDate: claim.periodEndDate.toISOString(),
      status: claim.status,
      retentionHeldCents: centsToNumber(claim.retentionHeldCents),
      previousRetentionHeldCents: centsToNumber(claim.previousRetentionHeldCents),
      retentionManualOverride: claim.retentionManualOverride,
      retentionNote: claim.retentionNote,
    },
    project: {
      id: claim.project.id,
      name: claim.project.name,
      originalContractValueCents: centsToNumber(claim.project.originalContractValueCents),
      retentionRateBps: claim.project.retentionRateBps,
      retentionCapCents: claim.project.retentionCapCents !== null ? centsToNumber(claim.project.retentionCapCents) : null,
      gstRateBps: claim.project.gstRateBps,
    },
    trades,
    cover: {
      originalContractValueCents: centsToNumber(cover.originalContractValueCents),
      approvedVariationsCents: centsToNumber(cover.approvedVariationsCents),
      totalContractValueCents: centsToNumber(cover.totalContractValueCents),
      claimToDateCents: centsToNumber(cover.claimToDateCents),
      previousClaimCents: centsToNumber(cover.previousClaimCents),
      grossValueThisClaimCents: centsToNumber(cover.grossValueThisClaimCents),
      suggestedRetentionHeldCents: centsToNumber(cover.suggestedRetentionHeldCents),
      retentionHeldCents: centsToNumber(cover.retentionHeldCents),
      previousRetentionHeldCents: centsToNumber(cover.previousRetentionHeldCents),
      retentionThisClaimCents: centsToNumber(cover.retentionThisClaimCents),
      subTotalAfterRetentionCents: centsToNumber(cover.subTotalAfterRetentionCents),
      gstCents: centsToNumber(cover.gstCents),
      amountDueCents: centsToNumber(cover.amountDueCents),
      costToCompleteCents: centsToNumber(cover.costToCompleteCents),
    },
    previousClaimId: previousClaim?.id ?? null,
    nextClaimExists: !!nextClaim,
  };
}
