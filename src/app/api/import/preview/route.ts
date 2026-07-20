import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseHeadContractWorkbook } from "@/lib/import-xlsx";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const lineItemCount = parsed.trades.reduce((n, t) => n + t.lineItems.length, 0);

  return NextResponse.json({
    projectName: parsed.projectName,
    claimNumber: parsed.claimNumber,
    periodEndDate: parsed.periodEndDate.toISOString(),
    tradeCount: parsed.trades.length,
    lineItemCount,
    suggestedOriginalContractValueCents: parsed.suggestedOriginalContractValueCents.toString(),
    warnings: parsed.warnings,
  });
}
