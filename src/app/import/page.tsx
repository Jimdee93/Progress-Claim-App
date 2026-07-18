import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ImportWizard from "./ImportWizard";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const existing = await prisma.project.count();
  if (existing > 0) redirect("/");

  return <ImportWizard />;
}
