"use client";

import { useState } from "react";
import Link from "next/link";

interface Props {
  name: string;
  originalContractValueCents: number;
  retentionRateBps: number;
  retentionCapCents: number | null;
  gstRateBps: number;
}

export default function SettingsForm(props: Props) {
  const [name, setName] = useState(props.name);
  const [originalContractValue, setOriginalContractValue] = useState((props.originalContractValueCents / 100).toFixed(2));
  const [retentionRatePercent, setRetentionRatePercent] = useState((props.retentionRateBps / 10000).toFixed(2));
  const [retentionCap, setRetentionCap] = useState(props.retentionCapCents !== null ? (props.retentionCapCents / 100).toFixed(2) : "");
  const [gstRatePercent, setGstRatePercent] = useState((props.gstRateBps / 10000).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/project", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          originalContractValue: Number(originalContractValue),
          retentionRatePercent: Number(retentionRatePercent),
          retentionCap: retentionCap === "" ? null : Number(retentionCap),
          gstRatePercent: Number(gstRatePercent),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-8">
      <Link href="/" className="text-sm text-slate-500 underline">
        &larr; Dashboard
      </Link>
      <h1 className="text-2xl font-semibold mt-1 mb-6">Project settings</h1>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}
      {saved && (
        <p className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Saved.
        </p>
      )}

      <div className="space-y-4 bg-white border border-slate-200 rounded-lg p-6">
        <label className="block text-sm">
          <span className="block text-slate-700 mb-1">Project name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-slate-700 mb-1">Original contract value ($)</span>
          <input
            type="number"
            step="0.01"
            value={originalContractValue}
            onChange={(e) => setOriginalContractValue(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-slate-700 mb-1">GST rate (%)</span>
          <input
            type="number"
            step="0.01"
            value={gstRatePercent}
            onChange={(e) => setGstRatePercent(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-slate-700 mb-1">Retention rate (%)</span>
          <input
            type="number"
            step="0.01"
            value={retentionRatePercent}
            onChange={(e) => setRetentionRatePercent(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-slate-700 mb-1">Retention cap ($, optional)</span>
          <input
            type="number"
            step="0.01"
            value={retentionCap}
            onChange={(e) => setRetentionCap(e.target.value)}
            placeholder="No cap"
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
