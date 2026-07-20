import { notFound } from "next/navigation";
import { getClaimContext } from "@/lib/claim-context";
import ClaimEditor from "./ClaimEditor";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getClaimContext(id);
  if (!context) notFound();

  return <ClaimEditor initial={context} />;
}
