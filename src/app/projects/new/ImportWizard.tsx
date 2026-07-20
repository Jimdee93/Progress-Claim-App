"use client";

import { useState } from "react";
import Link from "next/link";

interface Preview {
  projectName: string;
  claimNumber: number;
  periodEndDate: string;
  tradeCount: number;
  lineItemCount: number;
  suggestedOriginalContractValueCents: string;
  warnings: string[];
}

export default function ImportWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [originalContractValue, setOriginalContractValue] = useState("");
  const [retentionRatePercent, setRetentionRatePercent] = useState("5");
  const [retentionCap, setRetentionCap] = useState("");
  const [gstRatePercent, setGstRatePercent] = useState("10");

  async function handlePreview() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import/preview", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse workbook");
      setPreview(data);
      const suggested = Number(data.suggestedOriginalContractValueCents) / 100;
      setOriginalContractValue(suggested.toFixed(2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse workbook");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("originalContractValue", originalContractValue);
      formData.append("retentionRatePercent", retentionRatePercent);
      formData.append("retentionCap", retentionCap);
      formData.append("gstRatePercent", gstRatePercent);
      const res = await fetch("/api/import/confirm", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      window.location.href = `/projects/${data.projectId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <Link href="/" className="text-sm text-slate-500 underline">
        &larr; Projects
      </Link>
      <h1 className="text-2xl font-semibold mt-1 mb-1">New project — import head contract workbook</h1>
      <p className="text-slate-600 mb-6">
        Upload the progress claim workbook to set up the project — trades, line items, contract
        sums, and this claim&apos;s certified figures as the starting baseline.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {!preview && (
        <div className="space-y-4">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm border border-slate-300 rounded p-2"
          />
          <button
            onClick={handlePreview}
            disabled={!file || loading}
            className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Parsing…" : "Preview"}
          </button>
        </div>
      )}

      {preview && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm space-y-1">
            <p>
              <span className="text-slate-500">Project:</span> {preview.projectName}
            </p>
            <p>
              <span className="text-slate-500">Claim number in file:</span> {preview.claimNumber}
            </p>
            <p>
              <span className="text-slate-500">Period end:</span>{" "}
              {new Date(preview.periodEndDate).toLocaleDateString("en-AU")}
            </p>
            <p>
              <span className="text-slate-500">Trades:</span> {preview.tradeCount} (
              {preview.lineItemCount} line items)
            </p>
          </div>

          {preview.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-amber-800 mb-1">Notes</p>
              <ul className="list-disc list-inside text-amber-700 space-y-0.5">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">Original contract value ($)</span>
              <input
                type="number"
                step="0.01"
                value={originalContractValue}
                onChange={(e) => setOriginalContractValue(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">GST rate (%)</span>
              <input
                type="number"
                step="0.01"
                value={gstRatePercent}
                onChange={(e) => setGstRatePercent(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">Retention rate (%)</span>
              <input
                type="number"
                step="0.01"
                value={retentionRatePercent}
                onChange={(e) => setRetentionRatePercent(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
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
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Importing…" : "Confirm import"}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={loading}
              className="text-sm text-slate-500 underline"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
