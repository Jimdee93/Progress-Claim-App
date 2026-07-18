import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface LineUpdate {
  lineItemId: string;
  percentCompleteBps: number;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft claims can be edited" }, { status: 409 });
  }

  const body = await req.json();
  const lines: LineUpdate[] = Array.isArray(body.lines) ? body.lines : [];
  // retentionHeldCents arrives already in cents (matches the ClaimContextDTO convention).
  const retentionHeldCents = typeof body.retentionHeldCents === "number" ? body.retentionHeldCents : null;
  const retentionManualOverride = typeof body.retentionManualOverride === "boolean" ? body.retentionManualOverride : undefined;
  const retentionNote = typeof body.retentionNote === "string" ? body.retentionNote : undefined;

  // Array-style $transaction batches these as one prepared set instead of
  // awaiting each update in a JS loop (which, with 1000+ line items, was
  // slow enough to blow past the interactive-transaction timeout).
  type Query = ReturnType<typeof prisma.claimLine.updateMany> | ReturnType<typeof prisma.claim.update>;
  const updates: Query[] = lines
    .filter((l) => typeof l.lineItemId === "string" && typeof l.percentCompleteBps === "number")
    .map((line) => {
      const bps = Math.max(0, Math.min(1_000_000, Math.round(line.percentCompleteBps)));
      return prisma.claimLine.updateMany({
        where: { claimId: id, lineItemId: line.lineItemId },
        data: { percentCompleteBps: bps },
      });
    });

  if (retentionHeldCents !== null || retentionManualOverride !== undefined || retentionNote !== undefined) {
    updates.push(
      prisma.claim.update({
        where: { id },
        data: {
          ...(retentionHeldCents !== null ? { retentionHeldCents: BigInt(Math.round(retentionHeldCents)) } : {}),
          ...(retentionManualOverride !== undefined ? { retentionManualOverride } : {}),
          ...(retentionNote !== undefined ? { retentionNote } : {}),
        },
      })
    );
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return NextResponse.json({ ok: true });
}
