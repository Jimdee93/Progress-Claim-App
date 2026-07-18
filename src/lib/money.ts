// Money is stored in the DB as integer cents (BigInt) and percentages as
// integer basis points (0-1,000,000 = 0.0000%-100.0000%) to avoid the
// floating-point drift seen throughout the source workbook (e.g.
// 0.9999999999999996 instead of 1). All dollar figures in this app stay well
// under Number.MAX_SAFE_INTEGER in cents, so we convert to/from plain
// numbers at the DB boundary rather than threading BigInt through the UI.

export const BPS_SCALE = 1_000_000; // 1,000,000 bps = 100%

export function centsToNumber(cents: bigint): number {
  return Number(cents);
}

export function numberToCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

export function centsFromDollarInput(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

export function formatCents(cents: bigint | number, opts?: { signDisplay?: "auto" | "always" }): string {
  const dollars = (typeof cents === "bigint" ? Number(cents) : cents) / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    signDisplay: opts?.signDisplay ?? "auto",
  }).format(dollars);
}

export function bpsToPercentNumber(bps: number): number {
  return bps / (BPS_SCALE / 100);
}

export function percentNumberToBps(percent: number): number {
  return Math.round(percent * (BPS_SCALE / 100));
}

export function formatBps(bps: number, fractionDigits = 2): string {
  return `${bpsToPercentNumber(bps).toFixed(fractionDigits)}%`;
}

export function clampBps(bps: number): number {
  return Math.max(0, Math.min(BPS_SCALE, bps));
}
