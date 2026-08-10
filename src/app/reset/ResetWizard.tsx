"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/money";

interface ResetLineResult {
  tradeItemNo: number;
  tradeName: string;
  lineItemNo: string;
  description: string;
  matched: boolean;
  oldPreviousClaimCents: number;
  newPreviousClaimCents: number;
  newPreviousPercentBps: number;
}

interface ResetPreview {
  currentProjectName: string;
  currentClaimNumber: number;
  certifiedClaimNumberInFile: number;
  results: ResetLineResult[];
  matchedCount: number;
  unmatchedCount: number;
  warnings: string[];
}

export default function ResetWizard() {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [certifiedFile, setCertifiedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newClaimNumber, setNewClaimNumber] = useState("");
  const [newPeriodEndLabel, setNewPeriodEndLabel] = useState("");
  const [downloaded, setDownloaded] = useState(false);

  async function handlePreview() {
    if (!currentFile || !certifiedFile) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("currentFile", currentFile);
      formData.append("certifiedFile", certifiedFile);
      const res = await fetch("/api/reset/preview", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to read the workbooks");
      setPreview(data);
      setNewClaimNumber(String(data.currentClaimNumber + 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the workbooks");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!currentFile || !certifiedFile) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("currentFile", currentFile);
      formData.append("certifiedFile", certifiedFile);
      if (newClaimNumber.trim()) formData.append("newClaimNumber", newClaimNumber.trim());
      if (newPeriodEndLabel.trim()) formData.append("newPeriodEndLabel", newPeriodEndLabel.trim());
      const res = await fetch("/api/reset/apply", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to build the reset file");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : "reset.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build the reset file");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setCurrentFile(null);
    setCertifiedFile(null);
    setPreview(null);
    setDownloaded(false);
    setError(null);
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <Link href="/" className="text-sm text-slate-500 underline">
        &larr; Projects
      </Link>
      <h1 className="text-2xl font-semibold mt-1 mb-1">Claim Reset Module</h1>
      <p className="text-slate-600 mb-6">
        Upload the claim workbook exactly as submitted, plus the same template re-keyed with the
        certified figures. This only updates the previous-claim baseline (and resets this claim&apos;s
        % to match) directly inside a copy of your file — every formula, formatting, and sheet stays
        untouched. Nothing is saved to a project; you get a file back.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {!preview && !downloaded && (
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="block text-slate-700 mb-1 font-medium">Current claim workbook (as submitted)</span>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setCurrentFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border border-slate-300 rounded p-2"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-slate-700 mb-1 font-medium">Certified workbook (re-keyed with certified figures)</span>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setCertifiedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border border-slate-300 rounded p-2"
            />
          </label>
          <button
            onClick={handlePreview}
            disabled={!currentFile || !certifiedFile || loading}
            className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Reading…" : "Preview"}
          </button>
        </div>
      )}

      {preview && !downloaded && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm space-y-1">
            <p>
              <span className="text-slate-500">Project:</span> {preview.currentProjectName}
            </p>
            <p>
              <span className="text-slate-500">Current claim number in file:</span> {preview.currentClaimNumber}
            </p>
            <p>
              <span className="text-slate-500">Matched:</span> {preview.matchedCount} line item
              {preview.matchedCount === 1 ? "" : "s"}
              {preview.unmatchedCount > 0 && (
                <span className="text-amber-700"> — {preview.unmatchedCount} unmatched, left unchanged</span>
              )}
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
              <span className="block text-slate-700 mb-1">New claim number (optional)</span>
              <input
                type="number"
                value={newClaimNumber}
                onChange={(e) => setNewClaimNumber(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">New period end date label (optional)</span>
              <input
                type="text"
                placeholder="e.g. 31 August 2026"
                value={newPeriodEndLabel}
                onChange={(e) => setNewPeriodEndLabel(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2 font-normal">#</th>
                  <th className="px-4 py-2 font-normal">Trade / Description</th>
                  <th className="px-4 py-2 font-normal text-right">Old previous claim</th>
                  <th className="px-4 py-2 font-normal text-right">New previous claim</th>
                </tr>
              </thead>
              <tbody>
                {preview.results.map((r, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${r.matched ? "" : "text-slate-300"}`}>
                    <td className="px-4 py-1.5 text-slate-400">{r.lineItemNo}</td>
                    <td className="px-4 py-1.5">
                      {r.tradeName} — {r.description}
                    </td>
                    <td className="px-4 py-1.5 text-right">{formatCents(r.oldPreviousClaimCents)}</td>
                    <td className="px-4 py-1.5 text-right font-medium">
                      {r.matched ? formatCents(r.newPreviousClaimCents) : "unchanged"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              disabled={loading}
              className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Building…" : "Download reset file"}
            </button>
            <button onClick={() => setPreview(null)} disabled={loading} className="text-sm text-slate-500 underline">
              Back
            </button>
          </div>
        </div>
      )}

      {downloaded && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm">
          <p className="text-green-700 font-medium mb-3">Reset file downloaded.</p>
          <button onClick={reset} className="text-sm text-slate-600 underline">
            Reset another claim
          </button>
        </div>
      )}
    </div>
  );
}
