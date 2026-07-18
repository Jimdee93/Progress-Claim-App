import ExcelJS from "exceljs";
import type { ClaimContextDTO } from "./claim-context";

const MONEY_FMT = "$#,##0.00;($#,##0.00);-";
const PERCENT_FMT = "0.00%";

function sheetSafeName(name: string, itemNo: number): string {
  // Excel sheet names: max 31 chars, no : \ / ? * [ ]
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim();
  const prefix = `${itemNo}_`;
  return (prefix + cleaned).slice(0, 31);
}

export function buildClaimWorkbook(ctx: ClaimContextDTO): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Head Contract Progress Claims";
  wb.created = new Date();

  const periodEndDate = new Date(ctx.claim.periodEndDate);
  const periodLabel = periodEndDate.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Add these first so they land as the first two tabs — their content is
  // filled in further down, once the trade sheets they reference exist.
  const cover = wb.addWorksheet("Claim Cover");
  const summary = wb.addWorksheet("Claim Summary");

  // --- Trade sheets -------------------------------------------------
  const tradeSheetNames = new Map<string, string>(); // tradeId -> sheet name
  const tradeTotalRow = new Map<string, number>(); // tradeId -> row number of its TOTAL row

  for (const trade of ctx.trades) {
    const name = sheetSafeName(trade.name, trade.itemNo);
    tradeSheetNames.set(trade.id, name);
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { width: 10 },
      { width: 44 },
      { width: 14 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
    ];

    ws.getCell("B2").value = trade.name;
    ws.getCell("B2").font = { bold: true, size: 13 };

    const headerRow = 5;
    ws.getCell(`F4`).value = "PREVIOUSLY CLAIMED";
    ws.getCell(`H4`).value = "THIS CLAIM";
    const headers = [
      "#",
      "DESCRIPTION OF WORKS",
      "TOTAL",
      "% COMPLETE",
      "CLAIM TO DATE",
      "PREVIOUS % COMPLETE",
      "PREVIOUS CLAIM",
      "% COMPLETE",
      "CLAIM AMOUNT",
      "COST TO COMPLETE",
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.border = { bottom: { style: "thin" } };
    });

    let r = headerRow + 1;
    const firstDataRow = r;
    for (const li of trade.lineItems) {
      ws.getCell(r, 1).value = li.itemNo;
      ws.getCell(r, 2).value = li.description;
      if (!li.isHeader) {
        ws.getCell(r, 3).value = li.contractSumCents / 100;
        ws.getCell(r, 4).value = li.percentCompleteBps / 1_000_000;
        ws.getCell(r, 5).value = { formula: `C${r}*D${r}` };
        ws.getCell(r, 6).value = { formula: `IF(C${r}=0,0,G${r}/C${r})` };
        ws.getCell(r, 7).value = li.previousClaimCents / 100;
        ws.getCell(r, 8).value = { formula: `D${r}-F${r}` };
        ws.getCell(r, 9).value = { formula: `E${r}-G${r}` };
        ws.getCell(r, 10).value = { formula: `C${r}-E${r}` };
        [3, 5, 7, 9, 10].forEach((c) => (ws.getCell(r, c).numFmt = MONEY_FMT));
        [4, 6, 8].forEach((c) => (ws.getCell(r, c).numFmt = PERCENT_FMT));
      } else {
        ws.getCell(r, 2).font = { bold: true };
      }
      r++;
    }

    const totalRow = r + 1;
    ws.getCell(totalRow, 2).value = "TOTAL :";
    ws.getCell(totalRow, 2).font = { bold: true };
    if (r > firstDataRow) {
      ws.getCell(totalRow, 3).value = { formula: `SUM(C${firstDataRow}:C${r - 1})` };
      ws.getCell(totalRow, 5).value = { formula: `SUM(E${firstDataRow}:E${r - 1})` };
      ws.getCell(totalRow, 7).value = { formula: `SUM(G${firstDataRow}:G${r - 1})` };
      ws.getCell(totalRow, 9).value = { formula: `SUM(I${firstDataRow}:I${r - 1})` };
      ws.getCell(totalRow, 10).value = { formula: `SUM(J${firstDataRow}:J${r - 1})` };
    } else {
      [3, 5, 7, 9, 10].forEach((c) => (ws.getCell(totalRow, c).value = 0));
    }
    [3, 5, 7, 9, 10].forEach((c) => {
      ws.getCell(totalRow, c).numFmt = MONEY_FMT;
      ws.getCell(totalRow, c).font = { bold: true };
      ws.getCell(totalRow, c).border = { top: { style: "thin" } };
    });
    tradeTotalRow.set(trade.id, totalRow);
  }

  // --- Claim Summary --------------------------------------------------
  summary.columns = [
    { width: 6 },
    { width: 40 },
    { width: 16 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];
  summary.getCell("B3").value = ctx.project.name;
  summary.getCell("B3").font = { bold: true, size: 14 };
  summary.getCell("B4").value = `Progress Claim No.${ctx.claim.claimNumber}`;
  summary.getCell("B5").value = "Claim Summary";
  summary.getCell("B6").value = `Works Completed up to ${periodLabel}`;

  const sHeaderRow = 8;
  const sHeaders = [
    "ITEM",
    "TRADE / WORK ELEMENTS",
    "CONTRACT SUM",
    "% COMPLETE",
    "CLAIMED TO DATE",
    "PREVIOUSLY CLAIMED",
    "THIS CLAIM",
    "COST TO COMPLETE",
  ];
  sHeaders.forEach((h, i) => {
    const cell = summary.getCell(sHeaderRow, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.border = { bottom: { style: "thin" } };
  });

  let sr = sHeaderRow + 1;
  const summaryFirstRow = sr;
  for (const trade of ctx.trades) {
    const sheetName = tradeSheetNames.get(trade.id)!;
    const totalRow = tradeTotalRow.get(trade.id)!;
    summary.getCell(sr, 1).value = trade.itemNo;
    summary.getCell(sr, 2).value = trade.name;
    summary.getCell(sr, 3).value = { formula: `'${sheetName}'!C${totalRow}` };
    summary.getCell(sr, 4).value = { formula: `IF(C${sr}=0,0,E${sr}/C${sr})` };
    summary.getCell(sr, 5).value = { formula: `'${sheetName}'!E${totalRow}` };
    summary.getCell(sr, 6).value = { formula: `'${sheetName}'!G${totalRow}` };
    summary.getCell(sr, 7).value = { formula: `E${sr}-F${sr}` };
    summary.getCell(sr, 8).value = { formula: `C${sr}-E${sr}` };
    [3, 5, 6, 7, 8].forEach((c) => (summary.getCell(sr, c).numFmt = MONEY_FMT));
    summary.getCell(sr, 4).numFmt = PERCENT_FMT;
    sr++;
  }
  const summaryLastRow = sr - 1;

  const totalsRow = sr + 1;
  summary.getCell(totalsRow, 2).value = "CLAIM AMOUNT (EXCL. GST) :";
  summary.getCell(totalsRow, 2).font = { bold: true };
  summary.getCell(totalsRow, 5).value = { formula: `SUM(E${summaryFirstRow}:E${summaryLastRow})` };
  summary.getCell(totalsRow, 6).value = { formula: `SUM(F${summaryFirstRow}:F${summaryLastRow})` };
  summary.getCell(totalsRow, 7).value = { formula: `SUM(G${summaryFirstRow}:G${summaryLastRow})` };
  [5, 6, 7].forEach((c) => {
    summary.getCell(totalsRow, c).numFmt = MONEY_FMT;
    summary.getCell(totalsRow, c).font = { bold: true };
  });

  // --- Claim Cover ------------------------------------------------------
  cover.columns = [{ width: 34 }, { width: 18 }];
  cover.getCell("A1").value = ctx.project.name;
  cover.getCell("A1").font = { bold: true, size: 14 };
  cover.getCell("A2").value = `Progress Claim No.${ctx.claim.claimNumber}`;
  cover.getCell("A3").value = `Works Completed up to ${periodLabel}`;

  cover.getCell("A5").value = "Original Contract Value";
  cover.getCell("B5").value = ctx.project.originalContractValueCents / 100;
  cover.getCell("A6").value = "Plus Approved Variations";
  cover.getCell("B6").value = ctx.cover.approvedVariationsCents / 100;
  cover.getCell("A7").value = "Total Contract Value";
  cover.getCell("B7").value = { formula: "SUM(B5:B6)" };

  cover.getCell("A9").value = "Total Value - Works Complete";
  cover.getCell("B9").value = ctx.cover.claimToDateCents / 100;
  cover.getCell("A10").value = "Less Works Completed Last Claim";
  cover.getCell("B10").value = ctx.cover.previousClaimCents / 100;
  cover.getCell("A11").value = "Gross Value - This Claim";
  cover.getCell("B11").value = { formula: "B9-B10" };

  cover.getCell("A13").value = "Total Retention To Date";
  cover.getCell("B13").value = ctx.cover.retentionHeldCents / 100;
  cover.getCell("A14").value = "Less Previous Retention Held";
  cover.getCell("B14").value = ctx.cover.previousRetentionHeldCents / 100;
  cover.getCell("A15").value = "Cash Retention - This Claim";
  cover.getCell("B15").value = { formula: "B13-B14" };

  cover.getCell("A17").value = "Sub Total - Amount Due after retention";
  cover.getCell("B17").value = { formula: "B11-B15" };
  cover.getCell("A18").value = `Add GST (${(ctx.project.gstRateBps / 10000).toFixed(1)}%)`;
  cover.getCell("B18").value = { formula: `B17*${ctx.project.gstRateBps / 1_000_000}` };
  cover.getCell("A19").value = "Amount due this Claim (including GST)";
  cover.getCell("B19").value = { formula: "B17+B18" };

  for (let r = 5; r <= 19; r++) {
    const cell = cover.getCell(r, 2);
    if (cell.value !== undefined && cell.value !== null) cell.numFmt = MONEY_FMT;
  }
  cover.getCell("A7").font = { bold: true };
  cover.getCell("B7").font = { bold: true };
  cover.getCell("A19").font = { bold: true };
  cover.getCell("B19").font = { bold: true };

  return wb;
}
