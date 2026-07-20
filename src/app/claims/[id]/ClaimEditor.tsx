"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ClaimContextDTO } from "@/lib/claim-context";
import { calcLineItem, rollupTrade, calcClaimCover } from "@/lib/calc";
import { formatCents, bpsToPercentNumber, percentNumberToBps } from "@/lib/money";

function toBigInt(n: number): bigint {
  return BigInt(Math.round(n));
}

export default function ClaimEditor({ initial }: { initial: ClaimContextDTO }) {
  const router = useRouter();
  const readOnly = initial.claim.status !== "DRAFT";

  const [percentInputs, setPercentInputs] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const trade of initial.trades) {
      for (const li of trade.lineItems) {
        if (!li.isHeader) map[li.id] = bpsToPercentNumber(li.percentCompleteBps).toFixed(2);
      }
    }
    return map;
  });
  const [retentionHeld, setRetentionHeld] = useState((initial.cover.retentionHeldCents / 100).toFixed(2));
  const [retentionOverride, setRetentionOverride] = useState(initial.claim.retentionManualOverride);
  const [retentionNote, setRetentionNote] = useState(initial.claim.retentionNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const computed = useMemo(() => {
    const tradeRollups = initial.trades.map((trade) => {
      const lineResults = trade.lineItems
        .filter((li) => !li.isHeader)
        .map((li) =>
          calcLineItem({
            lineItemId: li.id,
            contractSumCents: toBigInt(li.contractSumCents),
            percentCompleteBps: percentNumberToBps(Number(percentInputs[li.id] ?? "0")),
            previousPercentBps: li.previousPercentBps,
            previousClaimCents: toBigInt(li.previousClaimCents),
          })
        );
      const rollup = rollupTrade(
        { id: trade.id, name: trade.name, itemNo: trade.itemNo, isVariations: trade.isVariations },
        lineResults
      );
      return { trade, lineResults, rollup };
    });

    const cover = calcClaimCover({
      originalContractValueCents: toBigInt(initial.project.originalContractValueCents),
      retentionRateBps: initial.project.retentionRateBps,
      retentionCapCents: initial.project.retentionCapCents !== null ? toBigInt(initial.project.retentionCapCents) : null,
      gstRateBps: initial.project.gstRateBps,
      retentionHeldCents: toBigInt(Math.round(Number(retentionHeld || "0") * 100)),
      previousRetentionHeldCents: toBigInt(initial.cover.previousRetentionHeldCents),
      tradeRollups: tradeRollups.map((t) => t.rollup),
    });

    return { tradeRollups, cover };
  }, [initial, percentInputs, retentionHeld]);

  function updatePercent(lineItemId: string, value: string) {
    setPercentInputs((prev) => ({ ...prev, [lineItemId]: value }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const lines = Object.entries(percentInputs).map(([lineItemId, value]) => ({
        lineItemId,
        percentCompleteBps: percentNumberToBps(Number(value || "0")),
      }));
      const res = await fetch(`/api/claims/${initial.claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          retentionHeldCents: Math.round(Number(retentionHeld || "0") * 100),
          retentionManualOverride: retentionOverride,
          retentionNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (dirty) await handleSave();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${initial.claim.id}/submit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      window.location.href = `/claims/${initial.claim.id}/certify`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link href={`/projects/${initial.project.id}`} className="text-sm text-slate-500 underline">
            &larr; {initial.project.name}
          </Link>
          <h1 className="text-2xl font-semibold mt-1">
            {initial.project.name} — Claim No.{initial.claim.claimNumber}
          </h1>
          <p className="text-slate-600 text-sm">
            Works completed up to{" "}
            {new Date(initial.claim.periodEndDate).toLocaleDateString("en-AU", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}{" "}
            · <StatusBadge status={initial.claim.status} />
          </p>
        </div>
        <div className="flex gap-2">
          {(initial.claim.status === "SUBMITTED" || initial.claim.status === "APPROVED") && (
            <>
              <a
                href={`/api/claims/${initial.claim.id}/export`}
                className="bg-white border border-slate-300 text-slate-700 rounded px-4 py-2 text-sm font-medium"
              >
                Export .xlsx
              </a>
              <a
                href={`/api/claims/${initial.claim.id}/export/pdf`}
                className="bg-white border border-slate-300 text-slate-700 rounded px-4 py-2 text-sm font-medium"
              >
                Export .pdf
              </a>
            </>
          )}
          {initial.claim.status === "SUBMITTED" && (
            <Link
              href={`/claims/${initial.claim.id}/certify`}
              className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium"
            >
              Certify claim
            </Link>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <ClaimCoverPanel cover={computed.cover} />

      <div className="bg-white border border-slate-200 rounded-lg mt-6 divide-y divide-slate-100">
        {computed.tradeRollups.map(({ trade, lineResults, rollup }) => (
          <TradeGroup
            key={trade.id}
            trade={trade}
            rollup={rollup}
            lineResults={lineResults}
            percentInputs={percentInputs}
            onPercentChange={updatePercent}
            readOnly={readOnly}
          />
        ))}
      </div>

      {!readOnly && (
        <div className="flex gap-3 mt-6 sticky bottom-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-white border border-slate-300 rounded px-4 py-2 text-sm font-medium shadow disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium shadow disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit claim"}
          </button>
        </div>
      )}
    </div>
  );

  function ClaimCoverPanel({ cover }: { cover: ReturnType<typeof calcClaimCover> }) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Total contract value" value={formatCents(cover.totalContractValueCents)} />
        <Stat label="Claim to date (excl GST)" value={formatCents(cover.claimToDateCents)} />
        <Stat label="Previously claimed" value={formatCents(cover.previousClaimCents)} />
        <Stat label="Gross value this claim" value={formatCents(cover.grossValueThisClaimCents)} />
        <Stat label="Cost to complete" value={formatCents(cover.costToCompleteCents)} />
        <div>
          <p className="text-slate-500 mb-1">Retention held to date</p>
          {readOnly ? (
            <p className="font-medium">{formatCents(cover.retentionHeldCents)}</p>
          ) : (
            <input
              type="number"
              step="0.01"
              value={retentionHeld}
              onChange={(e) => {
                setRetentionHeld(e.target.value);
                setDirty(true);
              }}
              className="w-full rounded border border-slate-300 px-2 py-1"
            />
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            Suggested: {formatCents(cover.suggestedRetentionHeldCents)}
          </p>
        </div>
        <Stat label="Retention this claim" value={formatCents(cover.retentionThisClaimCents)} />
        <Stat label="GST" value={formatCents(cover.gstCents)} />
        <Stat label="Amount due this claim" value={formatCents(cover.amountDueCents, { signDisplay: "always" })} highlight />
        {!readOnly && (
          <div className="col-span-2 md:col-span-4 flex items-center gap-2 pt-2 border-t border-slate-100">
            <input
              id="retentionOverride"
              type="checkbox"
              checked={retentionOverride}
              onChange={(e) => {
                setRetentionOverride(e.target.checked);
                setDirty(true);
              }}
            />
            <label htmlFor="retentionOverride" className="text-slate-600">
              Manual retention override
            </label>
            <input
              type="text"
              placeholder="Note (e.g. reached retention cap)"
              value={retentionNote}
              onChange={(e) => {
                setRetentionNote(e.target.value);
                setDirty(true);
              }}
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        )}
      </div>
    );
  }
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-slate-500 mb-1">{label}</p>
      <p className={highlight ? "font-semibold text-lg" : "font-medium"}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    SUBMITTED: "bg-amber-100 text-amber-700",
    APPROVED: "bg-green-100 text-green-700",
  };
  return <span className={`text-xs font-medium px-2 py-1 rounded ${styles[status] ?? ""}`}>{status}</span>;
}

function TradeGroup({
  trade,
  rollup,
  lineResults,
  percentInputs,
  onPercentChange,
  readOnly,
}: {
  trade: ClaimContextDTO["trades"][number];
  rollup: ReturnType<typeof rollupTrade>;
  lineResults: ReturnType<typeof calcLineItem>[];
  percentInputs: Record<string, string>;
  onPercentChange: (lineItemId: string, value: string) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lineResultById = new Map(lineResults.map((r) => [r.lineItemId, r]));

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between hover:bg-slate-50">
        <span className="font-medium">
          {trade.itemNo}. {trade.name}
          {trade.isVariations && (
            <span className="ml-2 text-xs font-normal text-slate-400">(variations & PS)</span>
          )}
        </span>
        <span className="flex gap-6 text-sm text-slate-600">
          <span>{formatCents(rollup.contractSumCents)}</span>
          <span>{bpsToPercentNumber(rollup.percentCompleteBps).toFixed(1)}%</span>
          <span className="w-28 text-right font-medium">
            {formatCents(rollup.thisClaimAmountCents, { signDisplay: "always" })}
          </span>
        </span>
      </summary>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-t border-slate-100">
            <th className="px-4 py-2 font-normal">#</th>
            <th className="px-4 py-2 font-normal">Description</th>
            <th className="px-4 py-2 font-normal text-right">Contract sum</th>
            <th className="px-4 py-2 font-normal text-right">Previous %</th>
            <th className="px-4 py-2 font-normal text-right w-28">% complete</th>
            <th className="px-4 py-2 font-normal text-right">Claim to date</th>
            <th className="px-4 py-2 font-normal text-right">This claim</th>
          </tr>
        </thead>
        <tbody>
          {trade.lineItems.map((li) => {
            if (li.isHeader) {
              return (
                <tr key={li.id} className="border-t border-slate-100 bg-slate-50/50">
                  <td className="px-4 py-1.5 text-slate-400">{li.itemNo}</td>
                  <td className="px-4 py-1.5 font-medium text-slate-600" colSpan={5}>
                    {li.description}
                  </td>
                </tr>
              );
            }
            const r = lineResultById.get(li.id);
            return (
              <tr key={li.id} className="border-t border-slate-100">
                <td className="px-4 py-1.5 text-slate-400">{li.itemNo}</td>
                <td className="px-4 py-1.5">{li.description}</td>
                <td className="px-4 py-1.5 text-right">{formatCents(li.contractSumCents)}</td>
                <td className="px-4 py-1.5 text-right text-slate-400">
                  {bpsToPercentNumber(li.previousPercentBps).toFixed(2)}%
                </td>
                <td className="px-4 py-1.5 text-right">
                  {readOnly ? (
                    `${bpsToPercentNumber(r?.percentCompleteBps ?? li.percentCompleteBps).toFixed(2)}%`
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={percentInputs[li.id] ?? "0"}
                      onChange={(e) => onPercentChange(li.id, e.target.value)}
                      className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                    />
                  )}
                </td>
                <td className="px-4 py-1.5 text-right">{formatCents(r?.claimToDateCents ?? 0n)}</td>
                <td className="px-4 py-1.5 text-right font-medium">
                  {formatCents(r?.thisClaimAmountCents ?? 0n, { signDisplay: "always" })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
