import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const project = await prisma.project.findFirst();
  if (!project) redirect("/import");

  return (
    <SettingsForm
      name={project.name}
      originalContractValueCents={Number(project.originalContractValueCents)}
      retentionRateBps={project.retentionRateBps}
      retentionCapCents={project.retentionCapCents !== null ? Number(project.retentionCapCents) : null}
      gstRateBps={project.gstRateBps}
    />
  );
}
