import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";
import NewClaimForm from "./NewClaimForm";

// Always reflects live DB state (claims, contract value) — never prerender
// this at build time.
export const dynamic = "force-dynamic";

export default async function ProjectDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      claims: { orderBy: { claimNumber: "desc" } },
    },
  });

  if (!project) notFound();

  const latestClaim = project.claims[0] ?? null;
  const approvedVariations = await prisma.trade.findMany({
    where: { projectId: project.id, isVariations: true },
    include: { lineItems: true },
  });
  const variationsTotalCents = approvedVariations
    .flatMap((t) => t.lineItems)
    .reduce((sum, li) => sum + li.contractSumCents, 0n);
  const totalContractValueCents = project.originalContractValueCents + variationsTotalCents;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-start justify-between mb-8">
        <div>
          <Link href="/" className="text-sm text-slate-500 underline">
            &larr; Projects
          </Link>
          <h1 className="text-2xl font-semibold mt-1">{project.name}</h1>
          <p className="text-slate-600 mt-1">
            Total contract value: {formatCents(totalContractValueCents)}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-slate-500">{session?.user?.email}</p>
          <div className="flex gap-3 mt-1 justify-end">
            <Link href={`/projects/${project.id}/settings`} className="underline text-slate-500">
              Settings
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="underline text-slate-500" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 mb-8">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Start next claim</h2>
        {latestClaim ? (
          <NewClaimForm
            projectId={project.id}
            latestPeriodEndDate={latestClaim.periodEndDate.toISOString()}
            disabled={latestClaim.status !== "APPROVED"}
            disabledReason={
              latestClaim.status !== "APPROVED"
                ? `Claim No.${latestClaim.claimNumber} must be certified before starting the next claim.`
                : undefined
            }
          />
        ) : (
          <p className="text-sm text-slate-500">No claims yet.</p>
        )}
      </div>

      <h2 className="text-sm font-medium text-slate-700 mb-3">Claims</h2>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {project.claims.map((claim) => (
          <Link
            key={claim.id}
            href={claim.status === "SUBMITTED" ? `/claims/${claim.id}/certify` : `/claims/${claim.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
          >
            <div>
              <span className="font-medium">Claim No.{claim.claimNumber}</span>
              <span className="text-slate-500 ml-2 text-sm">
                {new Date(claim.periodEndDate).toLocaleDateString("en-AU", { year: "numeric", month: "long" })}
              </span>
            </div>
            <StatusBadge status={claim.status} />
          </Link>
        ))}
        {project.claims.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">No claims yet.</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    SUBMITTED: "bg-amber-100 text-amber-700",
    APPROVED: "bg-green-100 text-green-700",
  };
  return (
    <span className={`text-xs font-medium px-2 py-1 rounded ${styles[status] ?? ""}`}>{status}</span>
  );
}
