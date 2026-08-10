import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { previewReset } from "@/lib/reset-xlsx";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const currentFile = formData.get("currentFile");
  const certifiedFile = formData.get("certifiedFile");
  if (!(currentFile instanceof File) || !(certifiedFile instanceof File)) {
    return NextResponse.json({ error: "Both files are required" }, { status: 400 });
  }

  try {
    const [currentBuffer, certifiedBuffer] = await Promise.all([
      currentFile.arrayBuffer(),
      certifiedFile.arrayBuffer(),
    ]);
    const preview = previewReset(currentBuffer, certifiedBuffer);
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read one of the workbooks";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
