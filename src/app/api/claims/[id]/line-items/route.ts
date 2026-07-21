import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Adds a brand-new line item: a LineItem "template" row plus a single
// ClaimLine snapshot on the claim being edited. Only ever attaches to the
// current DRAFT claim — it doesn't exist as far as any earlier claim is
// concerned, so nothing to backfill there.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft claims can be edited" }, { status: 409 });
  }

  const body = await req.json();
  const tradeId = typeof body.tradeId === "string" ? body.tradeId : null;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const isHeader = body.isHeader === true;
  const contractSumCents = isHeader
    ? 0n
    : BigInt(Math.round(typeof body.contractSumCents === "number" ? body.contractSumCents : 0));

  if (!tradeId) return NextResponse.json({ error: "tradeId is required" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });

  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.projectId !== claim.projectId) {
    return NextResponse.json({ error: "Trade not found on this project" }, { status: 404 });
  }

  const siblingCount = await prisma.lineItem.count({ where: { tradeId } });
  const maxSortOrder = await prisma.lineItem.aggregate({
    where: { tradeId },
    _max: { sortOrder: true },
  });
  const itemNo =
    typeof body.itemNo === "string" && body.itemNo.trim()
      ? body.itemNo.trim()
      : `${trade.itemNo}.${String(siblingCount + 1).padStart(2, "0")}`;

  const lineItemId = randomUUID();
  await prisma.$transaction([
    prisma.lineItem.create({
      data: {
        id: lineItemId,
        tradeId,
        itemNo,
        description,
        contractSumCents,
        isHeader,
        sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
      },
    }),
    prisma.claimLine.create({
      data: {
        id: randomUUID(),
        claimId: id,
        lineItemId,
        description,
        contractSumCents,
        isHeader,
        percentCompleteBps: 0,
        previousPercentBps: 0,
        previousClaimCents: 0n,
        certifiedThisClaimCents: null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, lineItemId });
}
