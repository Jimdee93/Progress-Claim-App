import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  parseHeadContractWorkbook,
  findHeaderRow,
  buildColumnMap,
  findSummaryHeaderRow,
  buildSummaryColumnMap,
  findTextCellMatching,
  cellValue,
  cellIsFormula,
  asString,
  asNumber,
  type SummaryColumnMap,
  type TradeColumnMap,
} from "./import-xlsx";
import { matchCertifiedFigures, type ClaimLineForMatching } from "./certify-import";

// The Claim Reset Module: given the workbook a claim was just submitted with
// and a copy of that same template re-keyed with the client/superintendent's
// certified figures, produces a new copy of the ORIGINAL file with only the
// baseline cells updated — certified cumulative % / $ becomes the new
// "previous claim" baseline, and this claim's own % is reset to match (so
// next month starts at zero delta). Everything else — formulas, styling,
// sheet structure, column layout — is whatever the uploaded file already
// had; we only ever touch cells that hold a plain value, never a formula.

function matchKey(tradeItemNo: number, lineItemNo: string): string {
  return `${tradeItemNo}::${lineItemNo}`;
}

export interface ResetLineResult {
  tradeItemNo: number;
  tradeName: string;
  lineItemNo: string;
  description: string;
  matched: boolean;
  oldPreviousClaimCents: number;
  newPreviousClaimCents: number;
  newPreviousPercentBps: number;
}

export interface ResetPreview {
  currentProjectName: string;
  currentClaimNumber: number;
  certifiedClaimNumberInFile: number;
  results: ResetLineResult[];
  matchedCount: number;
  unmatchedCount: number;
  warnings: string[];
}

function buildResetLines(currentBuffer: ArrayBuffer, certifiedBuffer: ArrayBuffer) {
  const current = parseHeadContractWorkbook(currentBuffer);
  const certified = parseHeadContractWorkbook(certifiedBuffer);

  const claimLines: (ClaimLineForMatching & { tradeName: string; description: string })[] = [];
  for (const trade of current.trades) {
    for (const li of trade.lineItems) {
      if (li.isHeader) continue;
      claimLines.push({
        lineItemId: matchKey(trade.itemNo, li.itemNo),
        tradeItemNo: trade.itemNo,
        lineItemNo: li.itemNo,
        isHeader: false,
        contractSumCents: li.contractSumCents,
        previousClaimCents: li.previousClaimCents,
        tradeName: trade.name,
        description: li.description,
      });
    }
  }

  const matchResult = matchCertifiedFigures(certified, claimLines);
  const matchedByKey = new Map(matchResult.matches.map((m) => [m.lineItemId, m]));

  const results: ResetLineResult[] = claimLines.map((cl) => {
    const m = matchedByKey.get(cl.lineItemId);
    const newPreviousClaimCents = m ? cl.previousClaimCents + BigInt(m.certifiedThisClaimCents) : cl.previousClaimCents;
    const newPreviousPercentBps =
      cl.contractSumCents !== 0n ? Number((newPreviousClaimCents * 1_000_000n) / cl.contractSumCents) : 0;
    return {
      tradeItemNo: cl.tradeItemNo,
      tradeName: cl.tradeName,
      lineItemNo: cl.lineItemNo,
      description: cl.description,
      matched: !!m,
      oldPreviousClaimCents: Number(cl.previousClaimCents),
      newPreviousClaimCents: Number(newPreviousClaimCents),
      newPreviousPercentBps,
    };
  });

  return { current, certified, matchResult, results };
}

export function previewReset(currentBuffer: ArrayBuffer, certifiedBuffer: ArrayBuffer): ResetPreview {
  const { current, certified, matchResult, results } = buildResetLines(currentBuffer, certifiedBuffer);
  return {
    currentProjectName: current.projectName,
    currentClaimNumber: current.claimNumber,
    certifiedClaimNumberInFile: certified.claimNumber,
    results,
    matchedCount: matchResult.matchedCount,
    unmatchedCount: matchResult.unmatchedCount,
    warnings: matchResult.warnings,
  };
}

export interface ApplyResetOptions {
  newClaimNumber?: number;
  newPeriodEndLabel?: string; // free text, e.g. "31 August 2026" — substituted into the existing label sentence
}

export interface ApplyResetResult {
  buffer: Buffer;
  matchedCount: number;
  unmatchedCount: number;
  cellsUpdated: number;
  cellsSkippedAsFormula: string[];
  warnings: string[];
}

function colLetter(c: number): string {
  return XLSX.utils.encode_col(c);
}

export async function applyReset(
  currentBuffer: ArrayBuffer,
  certifiedBuffer: ArrayBuffer,
  options: ApplyResetOptions = {}
): Promise<ApplyResetResult> {
  const { matchResult, results } = buildResetLines(currentBuffer, certifiedBuffer);
  const resultByKey = new Map(results.map((r) => [matchKey(r.tradeItemNo, r.lineItemNo), r]));

  // Re-read with SheetJS to redo the same header/column detection the parser
  // used, so we know exactly which sheet/row/column each figure lives in —
  // parseHeadContractWorkbook only gives us values, not coordinates.
  const rawWorkbook = XLSX.read(currentBuffer, { type: "buffer" });

  const excelWorkbook = new ExcelJS.Workbook();
  // exceljs's bundled Buffer type declaration doesn't line up with this
  // project's @types/node version; the value itself is a plain Node Buffer
  // at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await excelWorkbook.xlsx.load(Buffer.from(currentBuffer) as any);

  let cellsUpdated = 0;
  const cellsSkippedAsFormula: string[] = [];

  function writeIfPlainValue(sheetName: string, rawSheet: XLSX.WorkSheet, row: number, col: number, value: number) {
    const addr = `${colLetter(col)}${row + 1}`;
    if (cellIsFormula(rawSheet, addr)) {
      cellsSkippedAsFormula.push(`${sheetName}!${addr}`);
      return;
    }
    const excelSheet = excelWorkbook.getWorksheet(sheetName);
    if (!excelSheet) return;
    excelSheet.getCell(row + 1, col + 1).value = value;
    cellsUpdated++;
  }

  const summarySheetName = rawWorkbook.SheetNames.find((n) => n === "Claim Summary");
  const summaryRaw = summarySheetName ? rawWorkbook.Sheets[summarySheetName] : undefined;
  const summaryRange = summaryRaw ? XLSX.utils.decode_range(summaryRaw["!ref"] ?? "A1:A1") : null;

  // Re-derive, per trade, which sheet its line items live on (dedicated
  // sheet vs. a single row on Claim Summary), the same way the importer
  // does, so we can locate the exact cells to update.
  const tradeItemNos = [...new Set(results.map((r) => r.tradeItemNo))];
  for (const tradeItemNo of tradeItemNos) {
    const sheetName = rawWorkbook.SheetNames.find((n) => {
      const m = n.match(/^(\d+)_/);
      return m !== null && Number(m[1]) === tradeItemNo;
    });

    if (sheetName) {
      const rawSheet = rawWorkbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(rawSheet["!ref"] ?? "A1:A1");
      const headerRow = findHeaderRow(rawSheet, range);
      if (headerRow === null) continue;
      const cols = buildColumnMap(rawSheet, headerRow, range.e.c) as Partial<TradeColumnMap>;
      if (
        cols.description === undefined ||
        cols.itemNo === undefined ||
        cols.previousClaim === undefined ||
        cols.percentComplete === undefined
      ) {
        continue;
      }

      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const row = (c: number) => cellValue(rawSheet, `${colLetter(c)}${r + 1}`);
        const description = asString(row(cols.description!));
        if (!description) continue;
        if (/^total\s*:?$/i.test(description)) break;
        const itemNo = asString(row(cols.itemNo!));
        if (!itemNo) continue;
        const result = resultByKey.get(matchKey(tradeItemNo, itemNo));
        if (!result || !result.matched) continue;

        writeIfPlainValue(sheetName, rawSheet, r, cols.previousClaim!, result.newPreviousClaimCents / 100);
        if (cols.previousPercent !== undefined) {
          writeIfPlainValue(sheetName, rawSheet, r, cols.previousPercent, result.newPreviousPercentBps / 1_000_000);
        }
        // Reset this claim's own % to match the new baseline, so next
        // month's delta starts at zero.
        writeIfPlainValue(sheetName, rawSheet, r, cols.percentComplete!, result.newPreviousPercentBps / 1_000_000);
      }
    } else if (summaryRaw && summaryRange) {
      // No dedicated sheet — the trade's own row on Claim Summary carries
      // its figures directly.
      const headerRow = findSummaryHeaderRow(summaryRaw, summaryRange);
      if (headerRow === null) continue;
      const sCols = buildSummaryColumnMap(summaryRaw, headerRow, summaryRange.e.c) as Partial<SummaryColumnMap>;
      if (sCols.itemNo === undefined || sCols.previouslyClaimed === undefined || sCols.percentComplete === undefined) continue;

      for (let r = headerRow + 1; r <= summaryRange.e.r; r++) {
        const row = (c: number) => cellValue(summaryRaw, `${colLetter(c)}${r + 1}`);
        const rowItemNo = asNumber(row(sCols.itemNo!));
        if (rowItemNo !== tradeItemNo) continue;
        const result = resultByKey.get(matchKey(tradeItemNo, `${tradeItemNo}.01`));
        if (!result || !result.matched) break;

        writeIfPlainValue("Claim Summary", summaryRaw, r, sCols.previouslyClaimed!, result.newPreviousClaimCents / 100);
        if (sCols.previousPercent !== undefined) {
          writeIfPlainValue("Claim Summary", summaryRaw, r, sCols.previousPercent, result.newPreviousPercentBps / 1_000_000);
        }
        writeIfPlainValue("Claim Summary", summaryRaw, r, sCols.percentComplete!, result.newPreviousPercentBps / 1_000_000);
        break;
      }
    }
  }

  // Bump the claim-number / period-date labels wherever they appear (Claim
  // Summary and Claim Cover both commonly carry their own copy) — skip any
  // that turn out to be formulas (e.g. Cover pulling the label live from
  // Claim Summary already updates itself once Summary's own cell changes).
  const warnings = [...matchResult.warnings];
  for (const sheetName of rawWorkbook.SheetNames) {
    const rawSheet = rawWorkbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(rawSheet["!ref"] ?? "A1:A1");

    if (options.newClaimNumber !== undefined) {
      const hit = findTextCellMatching(rawSheet, range, /progress claim no/i, 20);
      if (hit) {
        const addr = `${colLetter(hit.col)}${hit.row + 1}`;
        if (!cellIsFormula(rawSheet, addr)) {
          const newText = hit.text.replace(/no\.?\s*\d+/i, (m) => m.replace(/\d+/, String(options.newClaimNumber)));
          const excelSheet = excelWorkbook.getWorksheet(sheetName);
          if (excelSheet) excelSheet.getCell(hit.row + 1, hit.col + 1).value = newText;
        }
      }
    }

    if (options.newPeriodEndLabel) {
      const hit = findTextCellMatching(rawSheet, range, /works completed/i, 20);
      if (hit) {
        const addr = `${colLetter(hit.col)}${hit.row + 1}`;
        if (!cellIsFormula(rawSheet, addr)) {
          const newText = hit.text.replace(/(up to)\s+.+?(?=\s+carried out|\s*$)/i, `$1 ${options.newPeriodEndLabel}`);
          const excelSheet = excelWorkbook.getWorksheet(sheetName);
          if (excelSheet) excelSheet.getCell(hit.row + 1, hit.col + 1).value = newText;
        }
      }
    }
  }

  const buffer = (await excelWorkbook.xlsx.writeBuffer()) as unknown as Buffer;

  return {
    buffer,
    matchedCount: matchResult.matchedCount,
    unmatchedCount: matchResult.unmatchedCount,
    cellsUpdated,
    cellsSkippedAsFormula,
    warnings,
  };
}
