import PDFDocument from "pdfkit";
import type { ClaimContextDTO } from "./claim-context";
import { formatCents, bpsToPercentNumber } from "./money";

const PAGE_MARGIN = 50;
const PAGE_SIZE = "A4";

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
  doc.font("Helvetica").fontSize(10).text(`Works completed up to ${periodLabel}`);
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

  coverLine(doc, "Total Value — Works Complete", formatCents(ctx.cover.claimToDateCents));
  coverLine(doc, "Less Works Completed Last Claim", formatCents(ctx.cover.previousClaimCents));
  coverLine(doc, "Gross Value — This Claim", formatCents(ctx.cover.grossValueThisClaimCents), {
    bold: true,
    gap: 1,
  });

  coverLine(doc, "Total Retention To Date", formatCents(ctx.cover.retentionHeldCents));
  coverLine(doc, "Less Previous Retention Held", formatCents(ctx.cover.previousRetentionHeldCents));
  coverLine(doc, "Cash Retention — This Claim", formatCents(ctx.cover.retentionThisClaimCents), {
    bold: true,
    gap: 1,
  });

  coverLine(doc, "Sub Total — Amount Due after retention", formatCents(ctx.cover.subTotalAfterRetentionCents));
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

interface SummaryColumn {
  header: string;
  width: number;
  align: "left" | "right";
  value: (row: ClaimContextDTO["trades"][number]) => string;
}

function drawSummaryTable(doc: PDFKit.PDFDocument, ctx: ClaimContextDTO) {
  const columns: SummaryColumn[] = [
    { header: "#", width: 25, align: "left", value: (t) => String(t.itemNo) },
    { header: "Trade / Work Element", width: 155, align: "left", value: (t) => t.name },
    { header: "Contract Sum", width: 65, align: "right", value: (t) => formatCents(t.rollup.contractSumCents) },
    {
      header: "% Complete",
      width: 50,
      align: "right",
      value: (t) => `${bpsToPercentNumber(t.rollup.percentCompleteBps).toFixed(1)}%`,
    },
    { header: "Claimed to Date", width: 65, align: "right", value: (t) => formatCents(t.rollup.claimToDateCents) },
    {
      header: "Previously Claimed",
      width: 65,
      align: "right",
      value: (t) => formatCents(t.rollup.previousClaimCents),
    },
    {
      header: "This Claim",
      width: 65,
      align: "right",
      value: (t) => formatCents(t.rollup.thisClaimAmountCents, { signDisplay: "always" }),
    },
    {
      header: "Cost to Complete",
      width: 65,
      align: "right",
      value: (t) => formatCents(t.rollup.costToCompleteCents),
    },
  ];

  const tableLeft = PAGE_MARGIN;
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  const rowHeight = 16;
  const bottomLimit = doc.page.height - PAGE_MARGIN;

  function drawHeaderRow() {
    doc.font("Helvetica-Bold").fontSize(8);
    let x = tableLeft;
    const y = doc.y;
    for (const col of columns) {
      doc.text(col.header, x, y, { width: col.width, align: col.align });
      x += col.width;
    }
    doc.moveDown(0.9);
    doc
      .moveTo(tableLeft, doc.y)
      .lineTo(tableLeft + tableWidth, doc.y)
      .strokeColor("#999999")
      .stroke();
    doc.moveDown(0.2);
  }

  function ensureSpace() {
    if (doc.y + rowHeight > bottomLimit) {
      doc.addPage({ margin: PAGE_MARGIN, size: PAGE_SIZE, layout: "landscape" });
      drawHeaderRow();
    }
  }

  doc.addPage({ margin: PAGE_MARGIN, size: PAGE_SIZE, layout: "landscape" });
  doc.font("Helvetica-Bold").fontSize(12).text(`${ctx.project.name} — Claim Summary`, tableLeft);
  doc.font("Helvetica").fontSize(9).text(`Progress Claim No.${ctx.claim.claimNumber}`);
  doc.moveDown(0.8);
  drawHeaderRow();

  doc.font("Helvetica").fontSize(8);
  for (const trade of ctx.trades) {
    ensureSpace();
    let x = tableLeft;
    const y = doc.y;
    for (const col of columns) {
      doc.text(col.value(trade), x, y, { width: col.width, align: col.align });
      x += col.width;
    }
    doc.moveDown(0.65);
  }

  doc.moveDown(0.2);
  doc
    .moveTo(tableLeft, doc.y)
    .lineTo(tableLeft + tableWidth, doc.y)
    .strokeColor("#999999")
    .stroke();
  doc.moveDown(0.3);

  doc.font("Helvetica-Bold").fontSize(8.5);
  const totalCols: Partial<Record<number, string>> = {
    1: "TOTAL",
    2: formatCents(ctx.cover.totalContractValueCents),
    4: formatCents(ctx.cover.claimToDateCents),
    5: formatCents(ctx.cover.previousClaimCents),
    6: formatCents(ctx.cover.grossValueThisClaimCents, { signDisplay: "always" }),
    7: formatCents(ctx.cover.costToCompleteCents),
  };
  {
    let x = tableLeft;
    const y = doc.y;
    columns.forEach((col, i) => {
      const text = totalCols[i];
      if (text !== undefined) doc.text(text, x, y, { width: col.width, align: col.align });
      x += col.width;
    });
  }
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

  doc.end();
  return done;
}
