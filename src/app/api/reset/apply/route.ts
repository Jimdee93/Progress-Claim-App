import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applyReset } from "@/lib/reset-xlsx";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const currentFile = formData.get("currentFile");
  const certifiedFile = formData.get("certifiedFile");
  if (!(currentFile instanceof File) || !(certifiedFile instanceof File)) {
    return NextResponse.json({ error: "Both files are required" }, { status: 400 });
  }
  const newClaimNumberRaw = formData.get("newClaimNumber");
  const newClaimNumber =
    typeof newClaimNumberRaw === "string" && newClaimNumberRaw.trim() ? Number(newClaimNumberRaw) : undefined;
  const newPeriodEndLabelRaw = formData.get("newPeriodEndLabel");
  const newPeriodEndLabel =
    typeof newPeriodEndLabelRaw === "string" && newPeriodEndLabelRaw.trim() ? newPeriodEndLabelRaw.trim() : undefined;

  try {
    const [currentBuffer, certifiedBuffer] = await Promise.all([
      currentFile.arrayBuffer(),
      certifiedFile.arrayBuffer(),
    ]);
    const result = await applyReset(currentBuffer, certifiedBuffer, { newClaimNumber, newPeriodEndLabel });

    const filename = currentFile.name.replace(/(\.xlsx)$/i, "_RESET$1");
    return new NextResponse(result.buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Reset-Matched-Count": String(result.matchedCount),
        "X-Reset-Unmatched-Count": String(result.unmatchedCount),
        "X-Reset-Cells-Updated": String(result.cellsUpdated),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not process the reset";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
