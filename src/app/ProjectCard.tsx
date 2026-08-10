"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCents } from "@/lib/money";

export default function ProjectCard({
  project,
}: {
  project: {
    id: string;
    name: string;
    totalContractValueCents: number;
    latestClaim: { claimNumber: number; status: string } | null;
  };
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${project.name}"? This removes every claim and line item for this project and can't be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete project");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete project");
      setDeleting(false);
    }
  }

  return (
    <Link
      href={`/projects/${project.id}`}
      className="relative bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-400 transition-colors group"
    >
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete project"
        className="absolute top-3 right-3 text-slate-300 hover:text-red-600 disabled:opacity-50 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        ✕
      </button>
      <h2 className="font-semibold text-slate-900 pr-4">{project.name}</h2>
      <p className="text-sm text-slate-600 mt-1">{formatCents(project.totalContractValueCents)}</p>
      <div className="mt-3 text-sm text-slate-500">
        {project.latestClaim ? (
          <span>
            Claim No.{project.latestClaim.claimNumber} — <StatusBadge status={project.latestClaim.status} />
          </span>
        ) : (
          <span>No claims yet</span>
        )}
      </div>
    </Link>
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
