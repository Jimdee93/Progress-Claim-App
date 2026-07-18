import { readFileSync } from "node:fs";
import { parseHeadContractWorkbook } from "../src/lib/import-xlsx";

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx scripts/test-import.ts <path-to-xlsx>");
  process.exit(1);
}

const buffer = readFileSync(path);
const parsed = parseHeadContractWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

console.log("Project:", parsed.projectName);
console.log("Claim number:", parsed.claimNumber);
console.log("Period end:", parsed.periodEndDate.toISOString());
console.log("Trades:", parsed.trades.length);
console.log("Suggested original contract value (cents):", parsed.suggestedOriginalContractValueCents.toString());
console.log(
  "Suggested original contract value ($):",
  (Number(parsed.suggestedOriginalContractValueCents) / 100).toLocaleString()
);
if (parsed.warnings.length) {
  console.log("\nWarnings:");
  parsed.warnings.forEach((w) => console.log(" -", w));
}

let claimToDateCents = 0n;
let previousClaimCents = 0n;
let variationsContractSumCents = 0n;

for (const trade of parsed.trades) {
  const tradeCTD = trade.lineItems.reduce((s, li) => s + (li.contractSumCents * BigInt(li.percentCompleteBps)) / 1_000_000n, 0n);
  const tradePrev = trade.lineItems.reduce((s, li) => s + li.previousClaimCents, 0n);
  claimToDateCents += tradeCTD;
  previousClaimCents += tradePrev;
  if (trade.isVariations) {
    variationsContractSumCents += trade.lineItems.reduce((s, li) => s + li.contractSumCents, 0n);
  }
}

const gross = claimToDateCents - previousClaimCents;
console.log("\n--- Claim Cover cross-check ---");
console.log("Claim to date (excl GST): $", (Number(claimToDateCents) / 100).toLocaleString());
console.log("Previous claim (excl GST): $", (Number(previousClaimCents) / 100).toLocaleString());
console.log("Gross value this claim (excl GST): $", (Number(gross) / 100).toLocaleString());
console.log("Approved variations total: $", (Number(variationsContractSumCents) / 100).toLocaleString());
console.log(
  "Total contract value (original + variations): $",
  (Number(parsed.suggestedOriginalContractValueCents + variationsContractSumCents) / 100).toLocaleString()
);

console.log("\nFirst trade sample:", JSON.stringify(parsed.trades[0], (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
