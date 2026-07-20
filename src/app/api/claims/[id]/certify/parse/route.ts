import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseHeadContractWorkbook } from "@/lib/import-xlsx";
import { matchCertifiedFigures } from "@/lib/certify-import";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({
    where: { id },
    include: { claimLines: { include: { lineItem: { include: { trade: true } } } } },
  });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "SUBMITTED") {
    return NextResponse.json({ error: "Only submitted claims can be certified" }, { status: 409 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseHeadContractWorkbook(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse workbook";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const claimLines = claim.claimLines.map((cl) => ({
    lineItemId: cl.lineItemId,
    tradeItemNo: cl.lineItem.trade.itemNo,
    lineItemNo: cl.lineItem.itemNo,
    isHeader: cl.lineItem.isHeader,
    contractSumCents: cl.lineItem.contractSumCents,
    previousClaimCents: cl.previousClaimCents,
  }));

  const result = matchCertifiedFigures(parsed, claimLines);

  if (result.parsedClaimNumber !== claim.claimNumber) {
    result.warnings.unshift(
      `Uploaded file is labelled "Claim No.${result.parsedClaimNumber}" — you're certifying Claim No.${claim.claimNumber}. Figures were matched by line item anyway; double-check before approving.`
    );
  }

  return NextResponse.json(result);
}
