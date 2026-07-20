import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getClaimContext } from "@/lib/claim-context";
import { buildClaimWorkbook } from "@/lib/export-xlsx";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ctx = await getClaimContext(id);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wb = buildClaimWorkbook(ctx);
  const buffer = await wb.xlsx.writeBuffer();

  const filename = `${ctx.project.name.replace(/[^a-z0-9]+/gi, "_")}_Progress_Claim_No.${ctx.claim.claimNumber}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
