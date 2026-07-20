"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ClaimContextDTO } from "@/lib/claim-context";
import { formatCents } from "@/lib/money";

export default function CertifyEditor({ initial }: { initial: ClaimContextDTO }) {
  const [certified, setCertified] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const trade of initial.trades) {
      for (const li of trade.lineItems) {
        if (li.isHeader) continue;
        const cents = li.certifiedThisClaimCents ?? li.thisClaimAmountCents;
        map[li.id] = (cents / 100).toFixed(2);
      }
    }
    return map;
  });
  const [retentionHeld, setRetentionHeld] = useState((initial.cover.retentionHeldCents / 100).toFixed(2));
  const [retentionOverride, setRetentionOverride] = useState(initial.claim.retentionManualOverride);
  const [retentionNote, setRetentionNote] = useState(initial.claim.retentionNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    let claimedCents = 0;
    let certifiedCents = 0;
    for (const trade of initial.trades) {
      for (const li of trade.lineItems) {
        if (li.isHeader) continue;
        claimedCents += li.thisClaimAmountCents;
        certifiedCents += Math.round(Number(certified[li.id] ?? "0") * 100);
      }
    }
    return { claimedCents, certifiedCents };
  }, [initial, certified]);

  function resetToClaimed() {
    const map: Record<string, string> = {};
    for (const trade of initial.trades) {
      for (const li of trade.lineItems) {
        if (li.isHeader) continue;
        map[li.id] = (li.thisClaimAmountCents / 100).toFixed(2);
      }
    }
    setCertified(map);
  }

  async function handleCertify() {
    setSaving(true);
    setError(null);
    try {
      const lines = Object.entries(certified).map(([lineItemId, value]) => ({
        lineItemId,
        certifiedThisClaimCents: Math.round(Number(value || "0") * 100),
      }));
      const res = await fetch(`/api/claims/${initial.claim.id}/certify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          retentionHeldCents: Math.round(Number(retentionHeld || "0") * 100),
          retentionManualOverride: retentionOverride,
          retentionNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to certify");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to certify");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <Link href={`/claims/${initial.claim.id}`} className="text-sm text-slate-500 underline">
        &larr; Claim No.{initial.claim.claimNumber}
      </Link>
      <h1 className="text-2xl font-semibold mt-1 mb-1">Certify Claim No.{initial.claim.claimNumber}</h1>
      <p className="text-slate-600 text-sm mb-6">
        Re-key the superintendent&apos;s certified figures against each line. Defaults to what was
        claimed — adjust anywhere the certificate differs. Certifying locks this claim and becomes
        next claim&apos;s starting baseline.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex items-center justify-between text-sm">
        <div className="flex gap-8">
          <div>
            <p className="text-slate-500">Claimed this period</p>
            <p className="font-medium">{formatCents(totals.claimedCents, { signDisplay: "always" })}</p>
          </div>
          <div>
            <p className="text-slate-500">Certified this period</p>
            <p className="font-medium">{formatCents(totals.certifiedCents, { signDisplay: "always" })}</p>
          </div>
          <div>
            <p className="text-slate-500">Variance</p>
            <p className="font-medium">
              {formatCents(totals.certifiedCents - totals.claimedCents, { signDisplay: "always" })}
            </p>
          </div>
        </div>
        <button onClick={resetToClaimed} className="text-sm underline text-slate-500">
          Reset all to claimed
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-6">
        {initial.trades.map((trade) => (
          <details key={trade.id}>
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between hover:bg-slate-50">
              <span className="font-medium">
                {trade.itemNo}. {trade.name}
              </span>
              <span className="text-sm text-slate-600">{formatCents(trade.rollup.thisClaimAmountCents, { signDisplay: "always" })} claimed</span>
            </summary>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-t border-slate-100">
                  <th className="px-4 py-2 font-normal">#</th>
                  <th className="px-4 py-2 font-normal">Description</th>
                  <th className="px-4 py-2 font-normal text-right">Claimed</th>
                  <th className="px-4 py-2 font-normal text-right w-32">Certified</th>
                </tr>
              </thead>
              <tbody>
                {trade.lineItems.map((li) => {
                  if (li.isHeader) {
                    return (
                      <tr key={li.id} className="border-t border-slate-100 bg-slate-50/50">
                        <td className="px-4 py-1.5 text-slate-400">{li.itemNo}</td>
                        <td className="px-4 py-1.5 font-medium text-slate-600" colSpan={3}>
                          {li.description}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={li.id} className="border-t border-slate-100">
                      <td className="px-4 py-1.5 text-slate-400">{li.itemNo}</td>
                      <td className="px-4 py-1.5">{li.description}</td>
                      <td className="px-4 py-1.5 text-right">
                        {formatCents(li.thisClaimAmountCents, { signDisplay: "always" })}
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={certified[li.id] ?? "0"}
                          onChange={(e) => setCertified((prev) => ({ ...prev, [li.id]: e.target.value }))}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 text-sm">
        <div className="flex items-end gap-4">
          <label>
            <span className="block text-slate-600 mb-1">Retention held to date</span>
            <input
              type="number"
              step="0.01"
              value={retentionHeld}
              onChange={(e) => setRetentionHeld(e.target.value)}
              className="w-40 rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <p className="text-xs text-slate-400 pb-2">
            Suggested: {formatCents(initial.cover.suggestedRetentionHeldCents)}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input
            id="retentionOverride"
            type="checkbox"
            checked={retentionOverride}
            onChange={(e) => setRetentionOverride(e.target.checked)}
          />
          <label htmlFor="retentionOverride">Manual retention override</label>
          <input
            type="text"
            placeholder="Note (e.g. reached retention cap)"
            value={retentionNote}
            onChange={(e) => setRetentionNote(e.target.value)}
            className="flex-1 rounded border border-slate-300 px-2 py-1"
          />
        </div>
      </div>

      <button
        onClick={handleCertify}
        disabled={saving}
        className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Certifying…" : "Certify & approve claim"}
      </button>
    </div>
  );
}
