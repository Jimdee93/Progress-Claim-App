import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import type { ParsedWorkbook } from "./import-xlsx";

export interface ImportOptions {
  originalContractValueCents: bigint; // editable, defaults to parsed.suggestedOriginalContractValueCents
  retentionRateBps: number;
  retentionCapCents: bigint | null;
  gstRateBps: number;
}

// Creates the Project/Trade/LineItem structure from a parsed workbook, plus
// a seed Claim (marked APPROVED) holding that claim's own figures as the
// certified baseline — so the next claim created in-app rolls forward
// correctly from day one.
//
// A real workbook has 1000+ line items, so this pre-generates ids and does
// bulk createMany() calls (a handful of queries) instead of one create()
// per row (thousands of round trips, slow enough to stall the dev server).
export async function importParsedWorkbook(parsed: ParsedWorkbook, options: ImportOptions) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: parsed.projectName,
        originalContractValueCents: options.originalContractValueCents,
        retentionRateBps: options.retentionRateBps,
        retentionCapCents: options.retentionCapCents,
        gstRateBps: options.gstRateBps,
      },
    });

    const claim = await tx.claim.create({
      data: {
        projectId: project.id,
        claimNumber: parsed.claimNumber,
        periodEndDate: parsed.periodEndDate,
        status: "APPROVED",
        submittedAt: parsed.periodEndDate,
        approvedAt: parsed.periodEndDate,
        // Retention isn't in the source workbook's per-line data in a form
        // we can reliably re-derive here; starts at 0 and the admin sets
        // the real figure via /settings + the next claim's cover panel.
        retentionHeldCents: 0n,
        previousRetentionHeldCents: 0n,
      },
    });

    const tradeRows = parsed.trades.map((trade) => ({
      id: randomUUID(),
      projectId: project.id,
      itemNo: trade.itemNo,
      name: trade.name,
      sortOrder: trade.sortOrder,
      isVariations: trade.isVariations,
    }));
    await tx.trade.createMany({ data: tradeRows });

    const lineItemRows: {
      id: string;
      tradeId: string;
      itemNo: string;
      description: string;
      contractSumCents: bigint;
      isHeader: boolean;
      sortOrder: number;
    }[] = [];
    const claimLineRows: {
      id: string;
      claimId: string;
      lineItemId: string;
      description: string;
      contractSumCents: bigint;
      isHeader: boolean;
      percentCompleteBps: number;
      previousPercentBps: number;
      previousClaimCents: bigint;
      certifiedThisClaimCents: bigint;
    }[] = [];

    parsed.trades.forEach((trade, i) => {
      const tradeId = tradeRows[i].id;
      for (const li of trade.lineItems) {
        const lineItemId = randomUUID();
        lineItemRows.push({
          id: lineItemId,
          tradeId,
          itemNo: li.itemNo,
          description: li.description,
          contractSumCents: li.contractSumCents,
          isHeader: li.isHeader,
          sortOrder: li.sortOrder,
        });
        claimLineRows.push({
          id: randomUUID(),
          claimId: claim.id,
          lineItemId,
          description: li.description,
          contractSumCents: li.contractSumCents,
          isHeader: li.isHeader,
          // This seed claim represents an already-certified historical
          // claim, so its own "this claim" % IS the approved cumulative
          // baseline the next claim will roll forward from.
          percentCompleteBps: li.percentCompleteBps,
          previousPercentBps: li.previousPercentBps,
          previousClaimCents: li.previousClaimCents,
          certifiedThisClaimCents:
            (li.contractSumCents * BigInt(li.percentCompleteBps)) / 1_000_000n - li.previousClaimCents,
        });
      }
    });

    await tx.lineItem.createMany({ data: lineItemRows });
    await tx.claimLine.createMany({ data: claimLineRows });

    return { projectId: project.id, claimId: claim.id };
  }, { timeout: 60_000 });
}
