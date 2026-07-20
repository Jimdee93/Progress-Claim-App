import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/money";

// Always reflects live DB state — never prerender this at build time.
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      claims: { orderBy: { claimNumber: "desc" }, take: 1 },
      trades: { where: { isVariations: true }, include: { lineItems: true } },
    },
  });

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-start justify-between mb-8">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="text-right text-sm">
          <p className="text-slate-500">{session?.user?.email}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="underline text-slate-500 mt-1" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map((project) => {
          const variationsTotalCents = project.trades
            .flatMap((t) => t.lineItems)
            .reduce((sum, li) => sum + li.contractSumCents, 0n);
          const totalContractValueCents = project.originalContractValueCents + variationsTotalCents;
          const latestClaim = project.claims[0] ?? null;

          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-400 transition-colors"
            >
              <h2 className="font-semibold text-slate-900">{project.name}</h2>
              <p className="text-sm text-slate-600 mt-1">{formatCents(totalContractValueCents)}</p>
              <div className="mt-3 text-sm text-slate-500">
                {latestClaim ? (
                  <span>
                    Claim No.{latestClaim.claimNumber} —{" "}
                    <StatusBadge status={latestClaim.status} />
                  </span>
                ) : (
                  <span>No claims yet</span>
                )}
              </div>
            </Link>
          );
        })}

        <Link
          href="/projects/new"
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg p-5 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors min-h-[120px]"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="text-sm font-medium">New project</span>
        </Link>
      </div>

      {projects.length === 0 && (
        <p className="text-sm text-slate-500 mt-4">
          No projects yet — click &quot;New project&quot; to import a progress claim workbook and
          get started.
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "text-slate-600",
    SUBMITTED: "text-amber-700",
    APPROVED: "text-green-700",
  };
  return <span className={`font-medium ${styles[status] ?? ""}`}>{status}</span>;
}
