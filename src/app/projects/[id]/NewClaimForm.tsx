"use client";

import { useState } from "react";

function nextMonthEnd(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 2, 0));
  return d.toISOString().slice(0, 10);
}

export default function NewClaimForm({
  projectId,
  latestPeriodEndDate,
  disabled,
  disabledReason,
}: {
  projectId: string;
  latestPeriodEndDate: string;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [periodEndDate, setPeriodEndDate] = useState(nextMonthEnd(new Date(latestPeriodEndDate)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, periodEndDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create claim");
      window.location.href = `/claims/${data.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create claim");
    } finally {
      setLoading(false);
    }
  }

  if (disabled) {
    return <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{disabledReason}</p>;
  }

  return (
    <div className="flex items-end gap-3">
      <label className="text-sm">
        <span className="block text-slate-600 mb-1">Period end date</span>
        <input
          type="date"
          value={periodEndDate}
          onChange={(e) => setPeriodEndDate(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        onClick={handleCreate}
        disabled={loading}
        className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Creating…" : "New claim"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
