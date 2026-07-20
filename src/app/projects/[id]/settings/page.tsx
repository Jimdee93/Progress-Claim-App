import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  return (
    <SettingsForm
      projectId={project.id}
      name={project.name}
      originalContractValueCents={Number(project.originalContractValueCents)}
      retentionRateBps={project.retentionRateBps}
      retentionCapCents={project.retentionCapCents !== null ? Number(project.retentionCapCents) : null}
      gstRateBps={project.gstRateBps}
    />
  );
}
