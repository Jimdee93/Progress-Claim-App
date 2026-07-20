import { BPS_SCALE, clampBps } from "./money";

// Mirrors the source workbook's per-line-item columns:
// C=contractSum(TOTAL)  D=percentComplete(this claim, cumulative)
// E=claimToDate(=C*D)   F=previousPercent   G=previousClaim($)
// H=deltaPercent(=D-F)  I=thisClaimAmount(=E-G)  J=costToComplete(=C-E)

export interface LineItemCalcInput {
  lineItemId: string;
  contractSumCents: bigint;
  percentCompleteBps: number;
  previousPercentBps: number;
  previousClaimCents: bigint;
}

export interface LineItemCalcResult extends LineItemCalcInput {
  claimToDateCents: bigint;
  deltaPercentBps: number;
  thisClaimAmountCents: bigint;
  costToCompleteCents: bigint;
}

export function calcLineItem(input: LineItemCalcInput): LineItemCalcResult {
  const percentCompleteBps = clampBps(input.percentCompleteBps);
  const claimToDateCents =
    (input.contractSumCents * BigInt(percentCompleteBps)) / BigInt(BPS_SCALE);

  return {
    ...input,
    percentCompleteBps,
    claimToDateCents,
    deltaPercentBps: percentCompleteBps - input.previousPercentBps,
    thisClaimAmountCents: claimToDateCents - input.previousClaimCents,
    costToCompleteCents: input.contractSumCents - claimToDateCents,
  };
}

export interface TradeRollup {
  tradeId: string;
  name: string;
  itemNo: number;
  isVariations: boolean;
  contractSumCents: bigint;
  claimToDateCents: bigint;
  previousClaimCents: bigint;
  thisClaimAmountCents: bigint;
  costToCompleteCents: bigint;
  percentCompleteBps: number;
}

export function rollupTrade(
  trade: { id: string; name: string; itemNo: number; isVariations: boolean },
  lineResults: LineItemCalcResult[]
): TradeRollup {
  const totals = lineResults.reduce(
    (acc, l) => ({
      contractSumCents: acc.contractSumCents + l.contractSumCents,
      claimToDateCents: acc.claimToDateCents + l.claimToDateCents,
      previousClaimCents: acc.previousClaimCents + l.previousClaimCents,
      thisClaimAmountCents: acc.thisClaimAmountCents + l.thisClaimAmountCents,
      costToCompleteCents: acc.costToCompleteCents + l.costToCompleteCents,
    }),
    {
      contractSumCents: 0n,
      claimToDateCents: 0n,
      previousClaimCents: 0n,
      thisClaimAmountCents: 0n,
      costToCompleteCents: 0n,
    }
  );

  const percentCompleteBps =
    totals.contractSumCents === 0n
      ? 0
      : Number((totals.claimToDateCents * BigInt(BPS_SCALE)) / totals.contractSumCents);

  return {
    tradeId: trade.id,
    name: trade.name,
    itemNo: trade.itemNo,
    isVariations: trade.isVariations,
    ...totals,
    percentCompleteBps,
  };
}

export interface ClaimCoverInput {
  originalContractValueCents: bigint;
  retentionRateBps: number;
  retentionCapCents: bigint | null;
  gstRateBps: number;
  retentionHeldCents: bigint; // this claim's cumulative retention held (manual/confirmed)
  previousRetentionHeldCents: bigint;
  tradeRollups: TradeRollup[];
}

export interface ClaimCoverResult {
  originalContractValueCents: bigint;
  approvedVariationsCents: bigint;
  totalContractValueCents: bigint;
  claimToDateCents: bigint; // cumulative, excl GST, all trades
  previousClaimCents: bigint; // cumulative, excl GST, all trades
  grossValueThisClaimCents: bigint; // excl GST, this period delta
  suggestedRetentionHeldCents: bigint;
  retentionHeldCents: bigint;
  previousRetentionHeldCents: bigint;
  retentionThisClaimCents: bigint;
  subTotalAfterRetentionCents: bigint;
  gstCents: bigint;
  amountDueCents: bigint;
  costToCompleteCents: bigint;
}

export function calcClaimCover(input: ClaimCoverInput): ClaimCoverResult {
  const approvedVariationsCents = input.tradeRollups
    .filter((t) => t.isVariations)
    .reduce((sum, t) => sum + t.contractSumCents, 0n);

  const totals = input.tradeRollups.reduce(
    (acc, t) => ({
      claimToDateCents: acc.claimToDateCents + t.claimToDateCents,
      previousClaimCents: acc.previousClaimCents + t.previousClaimCents,
      costToCompleteCents: acc.costToCompleteCents + t.costToCompleteCents,
    }),
    { claimToDateCents: 0n, previousClaimCents: 0n, costToCompleteCents: 0n }
  );

  const totalContractValueCents = input.originalContractValueCents + approvedVariationsCents;

  const grossValueThisClaimCents = totals.claimToDateCents - totals.previousClaimCents;

  const uncappedRetentionCents =
    (totals.claimToDateCents * BigInt(input.retentionRateBps)) / BigInt(BPS_SCALE);
  const suggestedRetentionHeldCents =
    input.retentionCapCents !== null && uncappedRetentionCents > input.retentionCapCents
      ? input.retentionCapCents
      : uncappedRetentionCents;

  const retentionThisClaimCents = input.retentionHeldCents - input.previousRetentionHeldCents;
  const subTotalAfterRetentionCents = grossValueThisClaimCents - retentionThisClaimCents;
  const gstCents = (subTotalAfterRetentionCents * BigInt(input.gstRateBps)) / BigInt(BPS_SCALE);
  const amountDueCents = subTotalAfterRetentionCents + gstCents;

  return {
    originalContractValueCents: input.originalContractValueCents,
    approvedVariationsCents,
    totalContractValueCents,
    claimToDateCents: totals.claimToDateCents,
    previousClaimCents: totals.previousClaimCents,
    grossValueThisClaimCents,
    suggestedRetentionHeldCents,
    retentionHeldCents: input.retentionHeldCents,
    previousRetentionHeldCents: input.previousRetentionHeldCents,
    retentionThisClaimCents,
    subTotalAfterRetentionCents,
    gstCents,
    amountDueCents,
    costToCompleteCents: totals.costToCompleteCents,
  };
}
