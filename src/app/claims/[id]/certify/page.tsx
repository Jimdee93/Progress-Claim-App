import { notFound, redirect } from "next/navigation";
import { getClaimContext } from "@/lib/claim-context";
import CertifyEditor from "./CertifyEditor";

export default async function CertifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getClaimContext(id);
  if (!context) notFound();
  if (context.claim.status !== "SUBMITTED") redirect(`/claims/${id}`);

  return <CertifyEditor initial={context} />;
}
