import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseHeadContractWorkbook } from "@/lib/import-xlsx";
import { importParsedWorkbook } from "@/lib/import-db";
import { centsFromDollarInput, percentNumberToBps } from "@/lib/money";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const originalContractValue = Number(formData.get("originalContractValue") ?? 0);
  const retentionRatePercent = Number(formData.get("retentionRatePercent") ?? 5);
  const retentionCapRaw = formData.get("retentionCap");
  const retentionCap = retentionCapRaw && retentionCapRaw !== "" ? Number(retentionCapRaw) : null;
  const gstRatePercent = Number(formData.get("gstRatePercent") ?? 10);

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseHeadContractWorkbook(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse workbook";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const result = await importParsedWorkbook(parsed, {
    originalContractValueCents: centsFromDollarInput(originalContractValue),
    retentionRateBps: percentNumberToBps(retentionRatePercent),
    retentionCapCents: retentionCap !== null ? centsFromDollarInput(retentionCap) : null,
    gstRateBps: percentNumberToBps(gstRatePercent),
  });

  return NextResponse.json(result);
}
