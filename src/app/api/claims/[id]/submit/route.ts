import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const claim = await prisma.claim.findUnique({ where: { id } });
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (claim.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft claims can be submitted" }, { status: 409 });
  }

  await prisma.claim.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
