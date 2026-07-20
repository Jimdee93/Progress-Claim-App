import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface CertifiedLine {
  lineItemId: string;
  certifiedThisClaimCents: number; // already in cents
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "SUBMITTED") {
    return NextResponse.json({ error: "Only submitted claims can be certified" }, { status: 409 });
  }

  const body = await req.json();
  const lines: CertifiedLine[] = Array.isArray(body.lines) ? body.lines : [];
  const retentionHeldCents = typeof body.retentionHeldCents === "number" ? body.retentionHeldCents : null;
  const retentionManualOverride = typeof body.retentionManualOverride === "boolean" ? body.retentionManualOverride : false;
  const retentionNote = typeof body.retentionNote === "string" ? body.retentionNote : null;

  if (retentionHeldCents === null) {
    return NextResponse.json({ error: "retentionHeldCents is required" }, { status: 400 });
  }

  // Array-style $transaction batches these as one prepared set instead of
  // awaiting each update in a JS loop (which, with 1000+ line items, was
  // slow enough to blow past the interactive-transaction timeout).
  type Query = ReturnType<typeof prisma.claimLine.updateMany> | ReturnType<typeof prisma.claim.update>;
  const updates: Query[] = lines
    .filter((l) => typeof l.lineItemId === "string" && typeof l.certifiedThisClaimCents === "number")
    .map((line) =>
      prisma.claimLine.updateMany({
        where: { claimId: id, lineItemId: line.lineItemId },
        data: { certifiedThisClaimCents: BigInt(Math.round(line.certifiedThisClaimCents)) },
      })
    );

  updates.push(
    prisma.claim.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        retentionHeldCents: BigInt(Math.round(retentionHeldCents)),
        retentionManualOverride,
        retentionNote,
      },
    })
  );

  await prisma.$transaction(updates);

  return NextResponse.json({ ok: true });
}
