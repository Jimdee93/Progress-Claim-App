import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNextClaim, RolloverError } from "@/lib/claim-rollover";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const periodEndDate = body.periodEndDate ? new Date(body.periodEndDate) : null;
  if (!periodEndDate || Number.isNaN(periodEndDate.getTime())) {
    return NextResponse.json({ error: "Invalid periodEndDate" }, { status: 400 });
  }

  const project = await prisma.project.findFirst();
  if (!project) return NextResponse.json({ error: "No project found" }, { status: 404 });

  try {
    const claim = await createNextClaim(project.id, periodEndDate);
    return NextResponse.json({ id: claim.id, claimNumber: claim.claimNumber });
  } catch (err) {
    if (err instanceof RolloverError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
