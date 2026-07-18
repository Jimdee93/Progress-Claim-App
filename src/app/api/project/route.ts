import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { centsFromDollarInput, percentNumberToBps } from "@/lib/money";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findFirst();
  if (!project) return NextResponse.json({ error: "No project found" }, { status: 404 });

  const body = await req.json();
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const originalContractValue = typeof body.originalContractValue === "number" ? body.originalContractValue : undefined;
  const retentionRatePercent = typeof body.retentionRatePercent === "number" ? body.retentionRatePercent : undefined;
  const retentionCap = body.retentionCap === null ? null : typeof body.retentionCap === "number" ? body.retentionCap : undefined;
  const gstRatePercent = typeof body.gstRatePercent === "number" ? body.gstRatePercent : undefined;

  await prisma.project.update({
    where: { id: project.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(originalContractValue !== undefined
        ? { originalContractValueCents: centsFromDollarInput(originalContractValue) }
        : {}),
      ...(retentionRatePercent !== undefined ? { retentionRateBps: percentNumberToBps(retentionRatePercent) } : {}),
      ...(retentionCap !== undefined
        ? { retentionCapCents: retentionCap === null ? null : centsFromDollarInput(retentionCap) }
        : {}),
      ...(gstRatePercent !== undefined ? { gstRateBps: percentNumberToBps(gstRatePercent) } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
