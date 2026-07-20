import type { ParsedWorkbook } from "./import-xlsx";

export interface ClaimLineForMatching {
  lineItemId: string;
  tradeItemNo: number;
  lineItemNo: string;
  isHeader: boolean;
  contractSumCents: bigint;
  previousClaimCents: bigint;
}

export interface CertifiedMatch {
  lineItemId: string;
  certifiedThisClaimCents: number; // cents, safe as a plain number
}

export interface CertifyMatchResult {
  matches: CertifiedMatch[];
  matchedCount: number;
  unmatchedCount: number;
  parsedClaimNumber: number;
  warnings: string[];
}

// Matches an uploaded "certified" workbook (the same head-contract template,
// returned by the client/superintendent with their own % complete per line)
// against this claim's current line items, and computes the certified $ for
// each line using OUR contract sum / previous-claim baseline — not the
// uploaded file's own — so a stray mismatch in the returned file can't
// silently drift the ledger. Matches by (trade item no, line item no), the
// same identifiers the original claim was built from.
export function matchCertifiedFigures(
  parsed: ParsedWorkbook,
  claimLines: ClaimLineForMatching[]
): CertifyMatchResult {
  const byKey = new Map<string, ClaimLineForMatching>();
  for (const cl of claimLines) {
    if (cl.isHeader) continue;
    byKey.set(`${cl.tradeItemNo}::${cl.lineItemNo}`, cl);
  }

  const matches: CertifiedMatch[] = [];
  const warnings: string[] = [...parsed.warnings];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const trade of parsed.trades) {
    for (const li of trade.lineItems) {
      if (li.isHeader) continue;
      const key = `${trade.itemNo}::${li.itemNo}`;
      const claimLine = byKey.get(key);
      if (!claimLine) {
        unmatchedCount++;
        continue;
      }
      matchedCount++;
      const certifiedCumulativeCents =
        (claimLine.contractSumCents * BigInt(li.percentCompleteBps)) / 1_000_000n;
      const certifiedThisClaimCents = certifiedCumulativeCents - claimLine.previousClaimCents;
      matches.push({
        lineItemId: claimLine.lineItemId,
        certifiedThisClaimCents: Number(certifiedThisClaimCents),
      });
    }
  }

  if (unmatchedCount > 0) {
    warnings.push(
      `${unmatchedCount} line item(s) in the uploaded file didn't match this claim and were skipped.`
    );
  }
  const totalClaimLines = claimLines.filter((cl) => !cl.isHeader).length;
  if (matchedCount < totalClaimLines) {
    warnings.push(
      `${totalClaimLines - matchedCount} line item(s) on this claim weren't found in the uploaded file — left unchanged.`
    );
  }

  return {
    matches,
    matchedCount,
    unmatchedCount,
    parsedClaimNumber: parsed.claimNumber,
    warnings,
  };
}
