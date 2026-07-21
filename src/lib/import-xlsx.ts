import * as XLSX from "xlsx";
import { centsFromDollarInput } from "./money";

// Parses the specific head-contract progress-claim workbook layout this app
// targets: a "Claim Summary" sheet rolling up one sheet per trade (named
// "<itemNo>_<Trade Name>"), each trade sheet using the columns:
// A=# B=DESCRIPTION C=TOTAL D=%COMPLETE E=CLAIM TO DATE F=PREVIOUS %COMPLETE
// G=PREVIOUS CLAIM H=%COMPLETE(delta) I=CLAIM AMOUNT J=COST TO COMPLETE
//
// We only ever read cached cell values (`.v`), never evaluate formulas —
// Excel caches computed results in the file, so this is equivalent to
// opening the workbook and reading what's on screen.

export interface ParsedLineItem {
  itemNo: string;
  description: string;
  contractSumCents: bigint;
  percentCompleteBps: number;
  previousPercentBps: number;
  previousClaimCents: bigint;
  isHeader: boolean;
  sortOrder: number;
}

export interface ParsedTrade {
  itemNo: number;
  name: string;
  isVariations: boolean;
  sortOrder: number;
  sourceSheet: string | null; // null => no dedicated sheet (e.g. Overheads & Profit)
  lineItems: ParsedLineItem[];
}

export interface ParsedWorkbook {
  projectName: string;
  claimNumber: number;
  periodEndDate: Date;
  trades: ParsedTrade[];
  suggestedOriginalContractValueCents: bigint;
  warnings: string[];
}

function cellValue(sheet: XLSX.WorkSheet, addr: string): unknown {
  const cell = sheet[addr];
  return cell ? cell.v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

function parseClaimNumber(text: string | undefined, warnings: string[]): number {
  const match = text?.match(/No\.?\s*(\d+)/i);
  if (match) return Number(match[1]);
  warnings.push(`Could not parse claim number from "${text}" — defaulting to 1.`);
  return 1;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseDateText(text: string | undefined, warnings: string[]): Date {
  if (text) {
    const match = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (match) {
      const day = Number(match[1]);
      const monthIndex = MONTHS.indexOf(match[2].toLowerCase());
      const year = Number(match[3]);
      if (monthIndex >= 0) return new Date(Date.UTC(year, monthIndex, day));
    }
  }
  warnings.push(`Could not parse period end date from "${text}" — defaulting to today.`);
  return new Date();
}

function findHeaderRow(sheet: XLSX.WorkSheet, range: XLSX.Range): number | null {
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 15); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = cellValue(sheet, XLSX.utils.encode_cell({ r, c }));
      if (typeof text === "string" && /description of works/i.test(text)) return r;
    }
  }
  return null;
}

// Scans the top block of a sheet (title/claim-number/date lines above the
// table) for a cell matching `pattern`, reading left-to-right, top-to-bottom
// across every column — the label's row/column varies between templates
// (e.g. project name sits at B3 in one workbook, D3 in another).
function findTextMatching(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  pattern: RegExp,
  maxRows = 15
): string | undefined {
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + maxRows); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = asString(cellValue(sheet, XLSX.utils.encode_cell({ r, c })));
      if (text && pattern.test(text)) return text;
    }
  }
  return undefined;
}

const HEADER_BOILERPLATE_PATTERNS = [
  /progress claim no/i,
  /^claim summary$/i,
  /payment claim under/i,
  /works completed/i,
  /claim submission date/i,
];

// The project name is whatever non-boilerplate text sits above the trade
// table — its exact row/column isn't consistent across templates, so this
// takes the first text cell in the top block that isn't one of the known
// fixed labels.
function findProjectName(sheet: XLSX.WorkSheet, range: XLSX.Range, maxRows = 15): string | undefined {
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + maxRows); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = asString(cellValue(sheet, XLSX.utils.encode_cell({ r, c })));
      if (text && !HEADER_BOILERPLATE_PATTERNS.some((p) => p.test(text))) return text;
    }
  }
  return undefined;
}

interface SummaryColumnMap {
  itemNo: number;
  name: number;
  contractSum: number;
  percentComplete: number;
  previouslyClaimed: number;
  previousPercent?: number;
}

// The Claim Summary sheet's header row (and which columns it has) varies
// between templates — some mirror the trade sheets with separate "PREVIOUS %
// COMPLETE" / "PREVIOUSLY CLAIMED" columns, others only have "PREVIOUSLY
// CLAIMED" and derive the % from it. Detect both the row and the columns
// from their labels rather than assuming fixed positions.
function findSummaryHeaderRow(sheet: XLSX.WorkSheet, range: XLSX.Range): number | null {
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 20); r++) {
    let hasItem = false;
    let hasTrade = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = asString(cellValue(sheet, XLSX.utils.encode_cell({ r, c })));
      if (!text) continue;
      const norm = text.toLowerCase().trim();
      if (norm === "item") hasItem = true;
      if (norm.startsWith("trade") || norm.includes("work element")) hasTrade = true;
    }
    if (hasItem && hasTrade) return r;
  }
  return null;
}

function buildSummaryColumnMap(sheet: XLSX.WorkSheet, headerRow: number, lastCol: number): Partial<SummaryColumnMap> {
  const map: Partial<SummaryColumnMap> = {};
  let sawFirstPercent = false;

  for (let c = 0; c <= lastCol; c++) {
    const text = asString(cellValue(sheet, XLSX.utils.encode_cell({ r: headerRow, c })));
    if (!text) continue;
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();

    if (norm === "item" || norm === "#") map.itemNo = c;
    else if (norm.startsWith("trade") || norm.includes("work element")) map.name = c;
    else if (norm === "contract sum") map.contractSum = c;
    else if (norm.includes("previous") && norm.includes("%")) map.previousPercent = c;
    else if (norm.includes("previous") && norm.includes("claim")) map.previouslyClaimed = c;
    else if (norm === "% complete" && !sawFirstPercent) {
      map.percentComplete = c;
      sawFirstPercent = true;
    }
  }

  return map;
}

interface TradeColumnMap {
  itemNo: number;
  description: number;
  contractSum: number;
  percentComplete: number;
  previousPercent: number;
  previousClaim: number;
}

// Some trade sheets insert QTY/UNIT/RATE columns before TOTAL, shifting
// everything right (A-M instead of A-J). Read the header row's own labels
// rather than assuming fixed column letters, so both layouts parse the same.
function buildColumnMap(sheet: XLSX.WorkSheet, headerRow: number, lastCol: number): Partial<TradeColumnMap> {
  const map: Partial<TradeColumnMap> = {};
  let pastPreviousClaim = false;

  for (let c = 0; c <= lastCol; c++) {
    const text = asString(cellValue(sheet, XLSX.utils.encode_cell({ r: headerRow, c })));
    if (!text) continue;
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();

    if (norm === "#") map.itemNo = c;
    else if (norm.startsWith("description")) map.description = c;
    else if (norm === "total") map.contractSum = c;
    else if (norm === "previous % complete") map.previousPercent = c;
    else if (norm === "previous claim") {
      map.previousClaim = c;
      pastPreviousClaim = true;
    } else if (norm === "% complete" && !pastPreviousClaim) map.percentComplete = c;
  }

  return map;
}

function parseTradeSheet(sheet: XLSX.WorkSheet, warnings: string[], sheetName: string): ParsedLineItem[] {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const headerRow = findHeaderRow(sheet, range);
  if (headerRow === null) {
    warnings.push(`Sheet "${sheetName}": couldn't find the column header row — skipped.`);
    return [];
  }

  const cols = buildColumnMap(sheet, headerRow, range.e.c);
  if (
    cols.itemNo === undefined ||
    cols.description === undefined ||
    cols.contractSum === undefined ||
    cols.percentComplete === undefined ||
    cols.previousPercent === undefined ||
    cols.previousClaim === undefined
  ) {
    warnings.push(`Sheet "${sheetName}": couldn't identify all expected columns — skipped.`);
    return [];
  }
  const map = cols as TradeColumnMap;

  const items: ParsedLineItem[] = [];
  let sortOrder = 0;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row = (c: number) => cellValue(sheet, XLSX.utils.encode_cell({ r, c }));

    const description = asString(row(map.description));
    if (!description) continue; // spacer row
    if (/^total\s*:?$/i.test(description)) break; // reached the trade's TOTAL row

    const itemNoRaw = row(map.itemNo);
    const contractSum = asNumber(row(map.contractSum));
    const isHeader = contractSum === undefined;

    let percentCompleteBps = 0;
    let previousPercentBps = 0;
    let previousClaimCents = 0n;
    let contractSumCents = 0n;

    if (!isHeader) {
      contractSumCents = centsFromDollarInput(contractSum!);
      const d = asNumber(row(map.percentComplete)) ?? 0;
      const g = asNumber(row(map.previousClaim)) ?? 0;
      const f = asNumber(row(map.previousPercent));
      percentCompleteBps = Math.round(d * 1_000_000);
      previousClaimCents = centsFromDollarInput(g);
      previousPercentBps = Math.round((f ?? (contractSum ? g / contractSum : 0)) * 1_000_000);
    }

    items.push({
      itemNo: asString(itemNoRaw) ?? String(sortOrder + 1),
      description,
      contractSumCents,
      percentCompleteBps,
      previousPercentBps,
      previousClaimCents,
      isHeader,
      sortOrder: sortOrder++,
    });
  }

  return items;
}

export function parseHeadContractWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const warnings: string[] = [];

  const summary = workbook.Sheets["Claim Summary"];
  if (!summary) {
    throw new Error('This workbook has no "Claim Summary" sheet — is it a head contract progress claim?');
  }

  const summaryRange = XLSX.utils.decode_range(summary["!ref"] ?? "A1:A1");

  const projectName = findProjectName(summary, summaryRange) ?? "Imported Project";
  const claimNumber = parseClaimNumber(findTextMatching(summary, summaryRange, /progress claim no/i), warnings);
  const periodEndDate = parseDateText(
    findTextMatching(summary, summaryRange, /works completed/i),
    warnings
  );

  const headerRow = findSummaryHeaderRow(summary, summaryRange);
  if (headerRow === null) {
    throw new Error(
      'Couldn\'t find the trade table header on "Claim Summary" (looking for "ITEM" and "TRADE / WORK ELEMENTS" columns).'
    );
  }
  const summaryCols = buildSummaryColumnMap(summary, headerRow, summaryRange.e.c);
  if (
    summaryCols.itemNo === undefined ||
    summaryCols.name === undefined ||
    summaryCols.contractSum === undefined ||
    summaryCols.percentComplete === undefined ||
    summaryCols.previouslyClaimed === undefined
  ) {
    throw new Error(
      'Couldn\'t identify all expected columns on "Claim Summary" (need ITEM, TRADE / WORK ELEMENTS, CONTRACT SUM, % COMPLETE, and PREVIOUSLY CLAIMED).'
    );
  }
  const sCols = summaryCols as SummaryColumnMap;

  const trades: ParsedTrade[] = [];
  let tradeSortOrder = 0;

  for (let r = headerRow + 1; r <= summaryRange.e.r; r++) {
    const row = (c: number) => cellValue(summary, XLSX.utils.encode_cell({ r, c }));
    const itemNo = asNumber(row(sCols.itemNo));
    if (itemNo === undefined || !Number.isInteger(itemNo)) continue;

    const name = asString(row(sCols.name)) ?? `Trade ${itemNo}`;
    const isVariations = /variation/i.test(name);

    // Sheet names aren't always zero-padded consistently with the item
    // number (e.g. "01_Concrete" for item 1 but "9_Masonry" for item 9), so
    // match on the sheet name's own leading number rather than the exact
    // "<itemNo>_" string prefix.
    const sheetName =
      workbook.SheetNames.find((n) => {
        const m = n.match(/^(\d+)_/);
        return m !== null && Number(m[1]) === itemNo;
      }) ?? null;

    let lineItems: ParsedLineItem[];
    if (sheetName) {
      lineItems = parseTradeSheet(workbook.Sheets[sheetName], warnings, sheetName);
    } else {
      // No dedicated sheet (e.g. "Overheads & Profit") — take the summary
      // row's own figures as a single line item.
      const contractSum = asNumber(row(sCols.contractSum)) ?? 0;
      const d = asNumber(row(sCols.percentComplete)) ?? 0;
      const previouslyClaimed = asNumber(row(sCols.previouslyClaimed)) ?? 0;
      const previousPercent =
        sCols.previousPercent !== undefined
          ? asNumber(row(sCols.previousPercent)) ?? 0
          : contractSum
            ? previouslyClaimed / contractSum
            : 0;
      lineItems = [
        {
          itemNo: `${itemNo}.01`,
          description: name,
          contractSumCents: centsFromDollarInput(contractSum),
          percentCompleteBps: Math.round(d * 1_000_000),
          previousPercentBps: Math.round(previousPercent * 1_000_000),
          previousClaimCents: centsFromDollarInput(previouslyClaimed),
          isHeader: false,
          sortOrder: 0,
        },
      ];
      warnings.push(`Trade "${name}" has no dedicated sheet — imported as a single line item.`);
    }

    trades.push({
      itemNo,
      name,
      isVariations,
      sourceSheet: sheetName,
      sortOrder: tradeSortOrder++,
      lineItems,
    });
  }

  if (trades.length === 0) {
    throw new Error('No trade rows found on "Claim Summary" below its header row.');
  }

  const suggestedOriginalContractValueCents = trades
    .filter((t) => !t.isVariations)
    .flatMap((t) => t.lineItems)
    .reduce((sum, li) => sum + li.contractSumCents, 0n);

  return {
    projectName,
    claimNumber,
    periodEndDate,
    trades,
    suggestedOriginalContractValueCents,
    warnings,
  };
}
