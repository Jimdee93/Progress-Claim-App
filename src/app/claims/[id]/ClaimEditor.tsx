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
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);
  const [lineItemBusyId, setLineItemBusyId] = useState<string | null>(null);

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
      setShowSubmittedModal(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  async function updateLineItem(
    lineItemId: string,
    body: { description?: string; contractSumCents?: number; itemNo?: string }
  ) {
    setLineItemBusyId(lineItemId);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${initial.claim.id}/line-items/${lineItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update line item");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update line item");
    } finally {
      setLineItemBusyId(null);
    }
  }

  async function deleteLineItem(lineItemId: string) {
    if (!window.confirm("Delete this line item? This can't be undone.")) return;
    setLineItemBusyId(lineItemId);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${initial.claim.id}/line-items/${lineItemId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete line item");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete line item");
    } finally {
      setLineItemBusyId(null);
    }
  }

  async function addLineItem(
    tradeId: string,
    body: { description: string; contractSumCents: number; isHeader: boolean }
  ) {
    setLineItemBusyId(tradeId);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${initial.claim.id}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add line item");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add line item");
    } finally {
      setLineItemBusyId(null);
    }
  }

  return (
    <>
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
            busyId={lineItemBusyId}
            onLineItemEdit={updateLineItem}
            onLineItemDelete={deleteLineItem}
            onLineItemAdd={addLineItem}
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

    {showSubmittedModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
          <h2 className="text-lg font-semibold mb-1">Claim submitted</h2>
          <p className="text-sm text-slate-600 mb-5">
            Claim No.{initial.claim.claimNumber} has been submitted. Export a copy now, or continue to
            certify.
          </p>
          <div className="flex flex-col gap-2">
            <a
              href={`/api/claims/${initial.claim.id}/export`}
              className="bg-white border border-slate-300 text-slate-700 rounded px-4 py-2 text-sm font-medium text-center"
            >
              Export .xlsx
            </a>
            <a
              href={`/api/claims/${initial.claim.id}/export/pdf`}
              className="bg-white border border-slate-300 text-slate-700 rounded px-4 py-2 text-sm font-medium text-center"
            >
              Export .pdf
            </a>
            <Link
              href={`/claims/${initial.claim.id}/certify`}
              className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium text-center"
            >
              Continue to certify
            </Link>
            <button
              onClick={() => setShowSubmittedModal(false)}
              className="text-sm text-slate-500 mt-1"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
    </>
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
  busyId,
  onLineItemEdit,
  onLineItemDelete,
  onLineItemAdd,
}: {
  trade: ClaimContextDTO["trades"][number];
  rollup: ReturnType<typeof rollupTrade>;
  lineResults: ReturnType<typeof calcLineItem>[];
  percentInputs: Record<string, string>;
  onPercentChange: (lineItemId: string, value: string) => void;
  readOnly: boolean;
  busyId: string | null;
  onLineItemEdit: (lineItemId: string, body: { description?: string; contractSumCents?: number; itemNo?: string }) => void;
  onLineItemDelete: (lineItemId: string) => void;
  onLineItemAdd: (tradeId: string, body: { description: string; contractSumCents: number; isHeader: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addingLine, setAddingLine] = useState(false);
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
          <span className="w-28 text-right text-slate-500">{formatCents(rollup.costToCompleteCents)}</span>
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
            <th className="px-4 py-2 font-normal text-right">Cost to complete</th>
            {!readOnly && <th className="px-4 py-2 font-normal"></th>}
          </tr>
        </thead>
        <tbody>
          {trade.lineItems.map((li) => {
            const busy = busyId === li.id;
            if (li.isHeader) {
              return (
                <tr key={li.id} className="border-t border-slate-100 bg-slate-50/50">
                  <td className="px-4 py-1.5 text-slate-400">{li.itemNo}</td>
                  <td className="px-4 py-1.5 font-medium text-slate-600" colSpan={6}>
                    {readOnly ? (
                      li.description
                    ) : (
                      <EditableText
                        value={li.description}
                        disabled={busy}
                        onCommit={(v) => onLineItemEdit(li.id, { description: v })}
                        className="font-medium text-slate-600"
                      />
                    )}
                  </td>
                  {!readOnly && (
                    <td className="px-4 py-1.5 text-right">
                      {li.canDelete && (
                        <button
                          onClick={() => onLineItemDelete(li.id)}
                          disabled={busy}
                          className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                          title="Delete"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            }
            const r = lineResultById.get(li.id);
            return (
              <tr key={li.id} className="border-t border-slate-100">
                <td className="px-4 py-1.5 text-slate-400">{li.itemNo}</td>
                <td className="px-4 py-1.5">
                  {readOnly ? (
                    li.description
                  ) : (
                    <EditableText
                      value={li.description}
                      disabled={busy}
                      onCommit={(v) => onLineItemEdit(li.id, { description: v })}
                    />
                  )}
                </td>
                <td className="px-4 py-1.5 text-right">
                  {readOnly ? (
                    formatCents(li.contractSumCents)
                  ) : (
                    <EditableAmount
                      valueCents={li.contractSumCents}
                      disabled={busy}
                      onCommit={(cents) => onLineItemEdit(li.id, { contractSumCents: cents })}
                    />
                  )}
                </td>
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
                <td className="px-4 py-1.5 text-right text-slate-500">
                  {formatCents(r?.costToCompleteCents ?? 0n)}
                </td>
                {!readOnly && (
                  <td className="px-4 py-1.5 text-right">
                    {li.canDelete && (
                      <button
                        onClick={() => onLineItemDelete(li.id)}
                        disabled={busy}
                        className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                        title="Delete"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {!readOnly && addingLine && (
            <AddLineRow
              busy={busyId === trade.id}
              onCancel={() => setAddingLine(false)}
              onAdd={(body) => {
                onLineItemAdd(trade.id, body);
                setAddingLine(false);
              }}
            />
          )}
        </tbody>
      </table>
      {!readOnly && !addingLine && (
        <div className="px-4 py-2 border-t border-slate-100">
          <button onClick={() => setAddingLine(true)} className="text-sm text-slate-600 underline">
            + Add line
          </button>
        </div>
      )}
    </details>
  );
}

function EditableText({
  value,
  disabled,
  onCommit,
  className,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft !== value) onCommit(draft.trim());
        else setDraft(value);
      }}
      className={`w-full rounded border border-transparent hover:border-slate-300 focus:border-slate-300 px-1.5 py-0.5 -mx-1.5 disabled:opacity-50 ${className ?? ""}`}
    />
  );
}

function EditableAmount({
  valueCents,
  disabled,
  onCommit,
}: {
  valueCents: number;
  disabled?: boolean;
  onCommit: (cents: number) => void;
}) {
  const [draft, setDraft] = useState((valueCents / 100).toFixed(2));
  return (
    <input
      type="number"
      step="0.01"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const cents = Math.round(Number(draft || "0") * 100);
        if (cents !== valueCents) onCommit(cents);
        else setDraft((valueCents / 100).toFixed(2));
      }}
      className="w-28 rounded border border-transparent hover:border-slate-300 focus:border-slate-300 px-1.5 py-0.5 text-right disabled:opacity-50"
    />
  );
}

function AddLineRow({
  busy,
  onCancel,
  onAdd,
}: {
  busy: boolean;
  onCancel: () => void;
  onAdd: (body: { description: string; contractSumCents: number; isHeader: boolean }) => void;
}) {
  const [description, setDescription] = useState("");
  const [contractSum, setContractSum] = useState("0.00");
  const [isHeader, setIsHeader] = useState(false);

  return (
    <tr className="border-t border-slate-100 bg-slate-50/50">
      <td className="px-4 py-1.5"></td>
      <td className="px-4 py-1.5">
        <input
          type="text"
          autoFocus
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1"
        />
      </td>
      <td className="px-4 py-1.5 text-right" colSpan={isHeader ? 6 : 1}>
        {!isHeader && (
          <input
            type="number"
            step="0.01"
            value={contractSum}
            onChange={(e) => setContractSum(e.target.value)}
            className="w-28 rounded border border-slate-300 px-2 py-1 text-right"
          />
        )}
      </td>
      {!isHeader && <td className="px-4 py-1.5" colSpan={5}></td>}
      <td className="px-4 py-1.5 text-right whitespace-nowrap">
        <label className="text-xs text-slate-500 mr-2">
          <input type="checkbox" checked={isHeader} onChange={(e) => setIsHeader(e.target.checked)} className="mr-1" />
          Header row
        </label>
        <button
          onClick={() => {
            if (!description.trim()) return;
            onAdd({
              description: description.trim(),
              contractSumCents: Math.round(Number(contractSum || "0") * 100),
              isHeader,
            });
          }}
          disabled={busy || !description.trim()}
          className="text-sm bg-slate-900 text-white rounded px-2 py-1 mr-2 disabled:opacity-50"
        >
          Add
        </button>
        <button onClick={onCancel} className="text-sm text-slate-500">
          Cancel
        </button>
      </td>
    </tr>
  );
}
