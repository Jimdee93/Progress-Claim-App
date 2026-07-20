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
  const [parsing, setParsing] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{ matchedCount: number; warnings: string[] } | null>(null);
  const [approved, setApproved] = useState(false);

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
    setApproved(false);
  }

  function updateCertifiedLine(lineItemId: string, value: string) {
    setCertified((prev) => ({ ...prev, [lineItemId]: value }));
    setApproved(false);
  }

  async function handleUploadCertified(file: File) {
    setParsing(true);
    setError(null);
    setUploadSummary(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/claims/${initial.claim.id}/certify/parse`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse certified workbook");

      setCertified((prev) => {
        const next = { ...prev };
        for (const m of data.matches as { lineItemId: string; certifiedThisClaimCents: number }[]) {
          next[m.lineItemId] = (m.certifiedThisClaimCents / 100).toFixed(2);
        }
        return next;
      });
      setUploadSummary({ matchedCount: data.matchedCount, warnings: data.warnings });
      setApproved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse certified workbook");
    } finally {
      setParsing(false);
    }
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
      window.location.href = `/projects/${initial.project.id}`;
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
        Upload the certified workbook the superintendent returned (same file, their % complete per
        line) to fill in the certified figures automatically — check them below, then tick the
        approval box to confirm. Certifying locks this claim and becomes next claim&apos;s starting
        baseline.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 text-sm">
        <label className="block font-medium text-slate-700 mb-2">Upload certified workbook</label>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx"
            disabled={parsing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadCertified(file);
              e.target.value = "";
            }}
            className="block text-sm border border-slate-300 rounded p-2 flex-1"
          />
          {parsing && <span className="text-slate-500">Parsing…</span>}
        </div>
        {uploadSummary && (
          <div className="mt-3 text-sm">
            <p className="text-green-700">
              Matched {uploadSummary.matchedCount} line item{uploadSummary.matchedCount === 1 ? "" : "s"} —
              certified figures below have been filled in. Review before approving.
            </p>
            {uploadSummary.warnings.length > 0 && (
              <ul className="list-disc list-inside text-amber-700 mt-1">
                {uploadSummary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

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
                          onChange={(e) => updateCertifiedLine(li.id, e.target.value)}
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
              onChange={(e) => {
                setRetentionHeld(e.target.value);
                setApproved(false);
              }}
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

      <div className="flex items-center gap-2 mb-4 text-sm">
        <input
          id="finalApproval"
          type="checkbox"
          checked={approved}
          onChange={(e) => setApproved(e.target.checked)}
        />
        <label htmlFor="finalApproval">
          I&apos;ve reviewed the certified figures and retention above and approve them.
        </label>
      </div>

      <button
        onClick={handleCertify}
        disabled={saving || !approved}
        className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Certifying…" : "Certify & approve claim"}
      </button>
    </div>
  );
}
