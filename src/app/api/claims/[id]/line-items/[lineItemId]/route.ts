import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Edits a line item. Writes to two places: this claim's own ClaimLine
// snapshot (so the change shows up here immediately) and the LineItem
// template (so claims created *after* this edit start from the corrected
// figures) — but never touches any other claim's already-frozen snapshot.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, lineItemId } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft claims can be edited" }, { status: 409 });
  }

  const claimLine = await prisma.claimLine.findUnique({
    where: { claimId_lineItemId: { claimId: id, lineItemId } },
  });
  if (!claimLine) return NextResponse.json({ error: "Line item not found on this claim" }, { status: 404 });

  const body = await req.json();
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  const itemNo = typeof body.itemNo === "string" ? body.itemNo.trim() : undefined;
  const isHeader = typeof body.isHeader === "boolean" ? body.isHeader : undefined;
  const contractSumCentsInput =
    typeof body.contractSumCents === "number" ? BigInt(Math.round(body.contractSumCents)) : undefined;

  if (description !== undefined && !description) {
    return NextResponse.json({ error: "description cannot be empty" }, { status: 400 });
  }

  const nextIsHeader = isHeader ?? claimLine.isHeader;
  const contractSumCents = nextIsHeader ? 0n : contractSumCentsInput ?? claimLine.contractSumCents;

  // Re-derive previous % from previous $ / the (possibly just-changed)
  // contract sum rather than leaving it stale — same convention used at
  // rollover, so a corrected contract sum never drifts the carried-forward
  // percentage out of sync with its own $ baseline.
  const previousPercentBps =
    contractSumCents !== 0n ? Number((claimLine.previousClaimCents * 1_000_000n) / contractSumCents) : 0;

  await prisma.$transaction([
    prisma.claimLine.update({
      where: { claimId_lineItemId: { claimId: id, lineItemId } },
      data: {
        ...(description !== undefined ? { description } : {}),
        contractSumCents,
        isHeader: nextIsHeader,
        previousPercentBps,
      },
    }),
    prisma.lineItem.update({
      where: { id: lineItemId },
      data: {
        ...(description !== undefined ? { description } : {}),
        ...(itemNo !== undefined && itemNo ? { itemNo } : {}),
        contractSumCents,
        isHeader: nextIsHeader,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

// Only allowed while this line item has never appeared on any other
// (necessarily past, SUBMITTED/APPROVED) claim — protects certified
// payment-claim history from being silently erased.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineItemId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, lineItemId } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft claims can be edited" }, { status: 409 });
  }

  const claimLine = await prisma.claimLine.findUnique({
    where: { claimId_lineItemId: { claimId: id, lineItemId } },
  });
  if (!claimLine) return NextResponse.json({ error: "Line item not found on this claim" }, { status: 404 });

  const otherReferenceCount = await prisma.claimLine.count({
    where: { lineItemId, claimId: { not: id } },
  });
  if (otherReferenceCount > 0) {
    return NextResponse.json(
      { error: "This line item has already been claimed on a past claim and can't be deleted." },
      { status: 409 }
    );
  }

  // Deleting the LineItem cascades to this claim's ClaimLine (the only one).
  await prisma.lineItem.delete({ where: { id: lineItemId } });

  return NextResponse.json({ ok: true });
}
