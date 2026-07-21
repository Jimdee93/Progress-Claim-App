import PDFDocument from "pdfkit";
import type { ClaimContextDTO } from "./claim-context";
import { formatCents, bpsToPercentNumber } from "./money";

const PAGE_MARGIN = 50;
const PAGE_SIZE = "A4";
const ROW_HEIGHT = 14; // comfortably above Helvetica's real line height at 8-9pt, pinned per-row so pdfkit never auto-paginates mid-row

function coverLine(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  opts?: { bold?: boolean; gap?: number }
) {
  const y = doc.y;
  doc.font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
  doc.text(label, PAGE_MARGIN, y, { continued: false, width: 320 });
  doc.text(value, PAGE_MARGIN + 320, y, { width: 150, align: "right" });
  doc.moveDown(opts?.gap ?? 0.5);
}

function drawCoverPage(doc: PDFKit.PDFDocument, ctx: ClaimContextDTO) {
  const periodLabel = new Date(ctx.claim.periodEndDate).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  doc.font("Helvetica-Bold").fontSize(16).text(ctx.project.name, PAGE_MARGIN);
  doc.font("Helvetica-Bold").fontSize(13).text(`Progress Claim No.${ctx.claim.claimNumber}`);
  doc.font("Helvetica").fontSize(10).text(`Works Completed up to ${periodLabel}`);
  doc.moveDown(0.5);
  doc
    .font("Helvetica-Oblique")
    .fontSize(9)
    .fillColor("#555555")
    .text("This is a Payment Claim under the Building and Construction Industry Security of Payment Act 1999")
    .fillColor("black");
  doc.moveDown(1.5);

  coverLine(doc, "Original Contract Value", formatCents(ctx.cover.originalContractValueCents));
  coverLine(doc, "Plus Approved Variations", formatCents(ctx.cover.approvedVariationsCents));
  coverLine(doc, "Total Contract Value", formatCents(ctx.cover.totalContractValueCents), { bold: true, gap: 1 });

  coverLine(doc, "Total Value - Works Complete", formatCents(ctx.cover.claimToDateCents));
  coverLine(doc, "Less Works Completed Last Claim", formatCents(ctx.cover.previousClaimCents));
  coverLine(doc, "Gross Value - This Claim", formatCents(ctx.cover.grossValueThisClaimCents), {
    bold: true,
    gap: 1,
  });

  coverLine(doc, "Total Retention To Date", formatCents(ctx.cover.retentionHeldCents));
  coverLine(doc, "Less Previous Retention Held", formatCents(ctx.cover.previousRetentionHeldCents));
  coverLine(doc, "Cash Retention - This Claim", formatCents(ctx.cover.retentionThisClaimCents), {
    bold: true,
    gap: 1,
  });

  coverLine(doc, "Sub Total - Amount Due after retention", formatCents(ctx.cover.subTotalAfterRetentionCents));
  coverLine(
    doc,
    `Add GST (${(ctx.project.gstRateBps / 10000).toFixed(1)}%)`,
    formatCents(ctx.cover.gstCents)
  );
  doc.moveDown(0.3);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).strokeColor("#cccccc").stroke();
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(11);
  coverLine(
    doc,
    "Amount due this Claim (including GST)",
    formatCents(ctx.cover.amountDueCents, { signDisplay: "always" }),
    { bold: true }
  );
}

interface TableColumn<T> {
  header: string;
  width: number;
  align: "left" | "right";
  bold?: boolean;
  value: (row: T) => string;
}

/**
 * Draws a table where every cell's vertical extent is pinned to the row's
 * own y (via an explicit `height` option), not the page's bottom margin.
 * pdfkit's LineWrapper only auto-paginates using the page-relative bound
 * when no `height` is given; without this, a row positioned close to the
 * bottom margin can trigger a fresh page on its very first cell, and every
 * subsequent cell (still carrying the stale off-page y) re-triggers the
 * same cascade — splitting one row across as many pages as it has columns.
 */
function drawTable<T>(
  doc: PDFKit.PDFDocument,
  columns: TableColumn<T>[],
  rows: T[],
  opts: {
    tableLeft: number;
    bottomLimit: number;
    fontSize?: number;
    onNewPage?: () => void;
    totals?: Partial<Record<number, string>>;
  }
) {
  const fontSize = opts.fontSize ?? 8;
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);

  function drawHeaderRow() {
    doc.font("Helvetica-Bold").fontSize(fontSize);
    const y = doc.y;
    let x = opts.tableLeft;
    for (const col of columns) {
      doc.text(col.header, x, y, { width: col.width, align: col.align, height: ROW_HEIGHT, lineBreak: false });
      x += col.width;
    }
    doc.y = y + ROW_HEIGHT;
    doc
      .moveTo(opts.tableLeft, doc.y)
      .lineTo(opts.tableLeft + tableWidth, doc.y)
      .strokeColor("#999999")
      .stroke();
    doc.moveDown(0.2);
  }

  function ensureSpace() {
    if (doc.y + ROW_HEIGHT > opts.bottomLimit) {
      doc.addPage({ margin: PAGE_MARGIN, size: PAGE_SIZE, layout: "landscape" });
      opts.onNewPage?.();
      drawHeaderRow();
    }
  }

  drawHeaderRow();

  doc.font("Helvetica").fontSize(fontSize);
  for (const row of rows) {
    ensureSpace();
    const y = doc.y;
    let x = opts.tableLeft;
    for (const col of columns) {
      doc.font(col.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(col.value(row), x, y, {
        width: col.width,
        align: col.align,
        height: ROW_HEIGHT,
        ellipsis: true,
        lineBreak: false,
      });
      x += col.width;
    }
    doc.font("Helvetica").fontSize(fontSize);
    doc.y = y + ROW_HEIGHT;
  }

  if (opts.totals) {
    ensureSpace();
    doc.moveDown(0.15);
    doc
      .moveTo(opts.tableLeft, doc.y)
      .lineTo(opts.tableLeft + tableWidth, doc.y)
      .strokeColor("#999999")
      .stroke();
    doc.moveDown(0.15);

    doc.font("Helvetica-Bold").fontSize(fontSize);
    const y = doc.y;
    let x = opts.tableLeft;
    columns.forEach((col, i) => {
      const text = opts.totals![i];
      if (text !== undefined) {
        doc.text(text, x, y, { width: col.width, align: col.align, height: ROW_HEIGHT, lineBreak: false });
      }
      x += col.width;
    });
    doc.y = y + ROW_HEIGHT;
  }

  return { tableWidth };
}

type TradeRow = ClaimContextDTO["trades"][number];

function drawSummaryTable(doc: PDFKit.PDFDocument, ctx: ClaimContextDTO) {
  const columns: TableColumn<TradeRow>[] = [
    { header: "ITEM", width: 30, align: "left", value: (t) => String(t.itemNo) },
    { header: "TRADE / WORK ELEMENTS", width: 150, align: "left", value: (t) => t.name },
    { header: "CONTRACT SUM", width: 65, align: "right", value: (t) => formatCents(t.rollup.contractSumCents) },
    {
      header: "% COMPLETE",
      width: 50,
      align: "right",
      value: (t) => `${bpsToPercentNumber(t.rollup.percentCompleteBps).toFixed(1)}%`,
    },
    { header: "CLAIMED TO DATE", width: 65, align: "right", value: (t) => formatCents(t.rollup.claimToDateCents) },
    {
      header: "PREVIOUSLY CLAIMED",
      width: 65,
      align: "right",
      value: (t) => formatCents(t.rollup.previousClaimCents),
    },
    {
      header: "THIS CLAIM",
      width: 65,
      align: "right",
      value: (t) => formatCents(t.rollup.thisClaimAmountCents, { signDisplay: "always" }),
    },
    {
      header: "COST TO COMPLETE",
      width: 65,
      align: "right",
      value: (t) => formatCents(t.rollup.costToCompleteCents),
    },
  ];

  const tableLeft = PAGE_MARGIN;

  function drawPageHeading() {
    doc.font("Helvetica-Bold").fontSize(12).text(`${ctx.project.name} - Claim Summary`, tableLeft);
    doc.font("Helvetica").fontSize(9).text(`Progress Claim No.${ctx.claim.claimNumber}`);
    doc.moveDown(0.8);
  }

  // Compute bottomLimit only after switching to the landscape page — doc.page
  // still refers to the (portrait) cover page until addPage() below runs, so
  // capturing it beforehand bakes in the wrong page height and lets rows
  // drift past the real, shorter landscape bottom margin undetected.
  doc.addPage({ margin: PAGE_MARGIN, size: PAGE_SIZE, layout: "landscape" });
  const bottomLimit = doc.page.height - PAGE_MARGIN;
  drawPageHeading();

  drawTable(doc, columns, ctx.trades, {
    tableLeft,
    bottomLimit,
    onNewPage: drawPageHeading,
    totals: {
      1: "CONSTRUCTION TOTAL",
      2: formatCents(ctx.cover.totalContractValueCents),
      4: formatCents(ctx.cover.claimToDateCents),
      5: formatCents(ctx.cover.previousClaimCents),
      6: formatCents(ctx.cover.grossValueThisClaimCents, { signDisplay: "always" }),
      7: formatCents(ctx.cover.costToCompleteCents),
    },
  });

  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9);
  const summaryLine = (label: string, value: string, bold?: boolean) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica");
    doc.text(label, tableLeft, y, { width: 300, height: 16 });
    doc.text(value, tableLeft + 300, y, { width: 130, align: "right", height: 16 });
    doc.y = y;
    doc.moveDown(0.7);
  };
  summaryLine("CLAIM AMOUNT (EXCL. GST) :", formatCents(ctx.cover.grossValueThisClaimCents, { signDisplay: "always" }), true);
  summaryLine(
    `GST (${(ctx.project.gstRateBps / 10000).toFixed(0)}%) :`,
    formatCents(ctx.cover.gstCents, { signDisplay: "always" })
  );
  summaryLine("CLAIM AMOUNT :", formatCents(ctx.cover.amountDueCents, { signDisplay: "always" }), true);
}

function drawTradeDetail(doc: PDFKit.PDFDocument, ctx: ClaimContextDTO, trade: TradeRow) {
  type LineRow = TradeRow["lineItems"][number];
  const columns: TableColumn<LineRow>[] = [
    { header: "#", width: 30, align: "left", value: (l) => l.itemNo },
    {
      header: "DESCRIPTION OF WORKS",
      width: 175,
      align: "left",
      value: (l) => l.description,
    },
    {
      header: "TOTAL",
      width: 70,
      align: "right",
      value: (l) => (l.isHeader ? "" : formatCents(l.contractSumCents)),
    },
    {
      header: "% COMPLETE",
      width: 55,
      align: "right",
      value: (l) => (l.isHeader ? "" : `${bpsToPercentNumber(l.percentCompleteBps).toFixed(1)}%`),
    },
    {
      header: "CLAIM TO DATE",
      width: 75,
      align: "right",
      value: (l) => (l.isHeader ? "" : formatCents(l.claimToDateCents)),
    },
    {
      header: "PREV % COMPLETE",
      width: 60,
      align: "right",
      value: (l) => (l.isHeader ? "" : `${bpsToPercentNumber(l.previousPercentBps).toFixed(1)}%`),
    },
    {
      header: "PREVIOUS CLAIM",
      width: 75,
      align: "right",
      value: (l) => (l.isHeader ? "" : formatCents(l.previousClaimCents)),
    },
    {
      header: "% COMPLETE",
      width: 55,
      align: "right",
      value: (l) => (l.isHeader ? "" : `${bpsToPercentNumber(l.deltaPercentBps).toFixed(1)}%`),
    },
    {
      header: "CLAIM AMOUNT",
      width: 75,
      align: "right",
      value: (l) => (l.isHeader ? "" : formatCents(l.thisClaimAmountCents, { signDisplay: "always" })),
    },
    {
      header: "COST TO COMPLETE",
      width: 75,
      align: "right",
      value: (l) => (l.isHeader ? "" : formatCents(l.costToCompleteCents)),
    },
  ];

  const tableLeft = PAGE_MARGIN;
  const bottomLimit = doc.page.height - PAGE_MARGIN;

  function drawPageHeading() {
    doc.font("Helvetica-Bold").fontSize(12).text(`${trade.itemNo}. ${trade.name}`, tableLeft);
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(`${ctx.project.name} - Progress Claim No.${ctx.claim.claimNumber}`);
    doc.moveDown(0.8);
  }

  drawPageHeading();

  drawTable(doc, columns, trade.lineItems, {
    tableLeft,
    bottomLimit,
    onNewPage: drawPageHeading,
    totals: {
      1: "TOTAL :",
      2: formatCents(trade.rollup.contractSumCents),
      4: formatCents(trade.rollup.claimToDateCents),
      6: formatCents(trade.rollup.previousClaimCents),
      8: formatCents(trade.rollup.thisClaimAmountCents, { signDisplay: "always" }),
      9: formatCents(trade.rollup.costToCompleteCents),
    },
  });

  doc.moveDown(1.2);
}

export async function buildClaimPdf(ctx: ClaimContextDTO): Promise<Buffer> {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: PAGE_SIZE, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawCoverPage(doc, ctx);
  drawSummaryTable(doc, ctx);

  for (const trade of ctx.trades) {
    doc.addPage({ margin: PAGE_MARGIN, size: PAGE_SIZE, layout: "landscape" });
    drawTradeDetail(doc, ctx, trade);
  }

  doc.end();
  return done;
}
