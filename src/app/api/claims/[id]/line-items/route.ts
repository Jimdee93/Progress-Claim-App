import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Adds a brand-new line item: a LineItem "template" row plus a single
// ClaimLine snapshot on the claim being edited. Only ever attaches to the
// current DRAFT claim — it doesn't exist as far as any earlier claim is
// concerned, so nothing to backfill there.
//
// With `insertAfterLineItemId`, the new line is spliced in right after that
// item (instead of appended at the end): every later item in the trade gets
// its sortOrder bumped to make room, and if the item that gets pushed down
// carries a plain integer item number (e.g. "42"), that whole contiguous
// numeric run is renumbered up by one and the new line takes over its old
// number — the "insert between 41 and 42, everything from 42 on shifts
// down" behaviour. Item numbers that aren't a clean integer run (decimals
// like "1.01", codes like "HCV040") are left alone; the new item just gets
// the usual auto-generated number and the CA can retype it if needed.
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
  const insertAfterLineItemId =
    typeof body.insertAfterLineItemId === "string" ? body.insertAfterLineItemId : null;

  if (!tradeId) return NextResponse.json({ error: "tradeId is required" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });

  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.projectId !== claim.projectId) {
    return NextResponse.json({ error: "Trade not found on this project" }, { status: 404 });
  }

  const siblings = await prisma.lineItem.findMany({
    where: { tradeId },
    orderBy: { sortOrder: "asc" },
  });

  let sortOrder: number;
  let itemNo = typeof body.itemNo === "string" && body.itemNo.trim() ? body.itemNo.trim() : null;
  const renumbered: { lineItemId: string; itemNo: string }[] = [];

  const anchorIndex = insertAfterLineItemId ? siblings.findIndex((s) => s.id === insertAfterLineItemId) : -1;
  if (insertAfterLineItemId && anchorIndex === -1) {
    return NextResponse.json({ error: "insertAfterLineItemId not found on this trade" }, { status: 404 });
  }

  if (anchorIndex !== -1) {
    const anchor = siblings[anchorIndex];
    sortOrder = anchor.sortOrder + 1;

    // Make room: every item at or after the insertion point shifts down one.
    await prisma.lineItem.updateMany({
      where: { tradeId, sortOrder: { gte: sortOrder } },
      data: { sortOrder: { increment: 1 } },
    });

    if (!itemNo) {
      const pushedDown = siblings[anchorIndex + 1];
      if (pushedDown && /^\d+$/.test(pushedDown.itemNo)) {
        itemNo = pushedDown.itemNo;
        let expected = Number(pushedDown.itemNo);
        for (let i = anchorIndex + 1; i < siblings.length; i++) {
          const s = siblings[i];
          if (!/^\d+$/.test(s.itemNo) || Number(s.itemNo) !== expected) break;
          renumbered.push({ lineItemId: s.id, itemNo: String(expected + 1) });
          expected++;
        }
      } else {
        itemNo = `${trade.itemNo}.${String(siblings.length + 1).padStart(2, "0")}`;
      }
    }
  } else {
    sortOrder = (siblings.at(-1)?.sortOrder ?? -1) + 1;
    if (!itemNo) itemNo = `${trade.itemNo}.${String(siblings.length + 1).padStart(2, "0")}`;
  }

  const lineItemId = randomUUID();
  await prisma.$transaction([
    ...renumbered.map((r) =>
      prisma.lineItem.update({ where: { id: r.lineItemId }, data: { itemNo: r.itemNo } })
    ),
    prisma.lineItem.create({
      data: {
        id: lineItemId,
        tradeId,
        itemNo,
        description,
        contractSumCents,
        isHeader,
        sortOrder,
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

  return NextResponse.json({ ok: true, lineItemId, renumberedCount: renumbered.length });
}
