'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

type Tab = 'manual' | 'upload';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewLegendPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('manual');

  // Manual form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [manualError, setManualError] = useState('');

  // Upload form state
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Manual submit ────────────────────────────────────────────────────────────
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setManualError('');
    try {
      const res = await fetch('/api/legends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      router.push(`/legends/${data.id}`);
    } catch (err: any) {
      setManualError(err.message ?? 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  // ── PDF upload submit ────────────────────────────────────────────────────────
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('name', uploadName.trim());

      const res = await fetch('/api/legends/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      const data = await res.json();
      router.push(`/legends/${data.id}`);
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/legends"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </Link>
        <span className="text-zinc-300 dark:text-zinc-600">/</span>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">New Legend</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 w-fit">
        {(['manual', 'upload'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {t === 'manual' ? 'Create Manually' : 'Upload PDF'}
          </button>
        ))}
      </div>

      {/* ── Manual tab ─────────────────────────────────────────────────────────── */}
      {tab === 'manual' && (
        <form
          onSubmit={handleManualSubmit}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4"
        >
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Create a legend and add symbols manually on the next screen.
          </p>

          {/* Name */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Instrument Legend Sheet 1"
              required
              disabled={saving}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              disabled={saving}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50 resize-none"
            />
          </div>

          {/* Error */}
          {manualError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
              {manualError}
            </p>
          )}

          {/* Submit */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving && <Spinner />}
              {saving ? 'Saving…' : 'Create Legend'}
            </button>
            <Link
              href="/legends"
              className="px-4 py-2 rounded-lg text-sm font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}

      {/* ── Upload PDF tab ──────────────────────────────────────────────────────── */}
      {tab === 'upload' && (
        <form
          onSubmit={handleUploadSubmit}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4"
        >
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a PDF legend sheet. The AI will extract symbols automatically.
          </p>

          {/* Legend name */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Legend Name <span className="text-red-500">*</span>
            </label>
            <input
              value={uploadName}
              onChange={e => setUploadName(e.target.value)}
              placeholder="e.g. Valve Legend Sheet"
              required
              disabled={uploading}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50"
            />
          </div>

          {/* File input */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              PDF File <span className="text-red-500">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              disabled={uploading}
              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-zinc-700 dark:text-zinc-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-zinc-200 dark:file:border-zinc-600 file:text-xs file:font-medium file:bg-zinc-50 dark:file:bg-zinc-800 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-100 disabled:opacity-50"
            />
            {uploadFile && (
              <p className="text-xs text-zinc-400">{uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)</p>
            )}
          </div>

          {/* Error */}
          {uploadError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
              {uploadError}
            </p>
          )}

          {/* Submit */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={uploading || !uploadFile || !uploadName.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {uploading && <Spinner />}
              {uploading ? 'Analyzing…' : 'Analyze PDF'}
            </button>
            <Link
              href="/legends"
              className="px-4 py-2 rounded-lg text-sm font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
