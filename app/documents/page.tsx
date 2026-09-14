'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
}

interface Document {
  id: string;
  filename: string;
  page_count: number;
  project_id: string;
  created_at: string;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status?.toUpperCase()) {
    case 'UPLOADED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
          Uploaded
        </span>
      );
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
          Processing
        </span>
      );
    case 'DONE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
          Done
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
          {status ?? '—'}
        </span>
      );
  }
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    const res = await fetch('/api/documents');
    if (res.ok) {
      const data = await res.json();
      setDocuments(data);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/documents').then(r => r.json()),
    ]).then(([projs, docs]) => {
      setProjects(projs);
      setDocuments(docs);
      setLoading(false);
    });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadError('');
    setUploadProgress(0);
  };

  const handleUpload = async () => {
    if (!selectedProjectId || !selectedFile) return;
    setUploading(true);
    setUploadError('');
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('project_id', selectedProjectId);

    try {
      // Fake progress while uploading (XHR would give real progress; fetch doesn't)
      const progressTimer = setInterval(() => {
        setUploadProgress(p => Math.min(p + 10, 90));
      }, 200);

      const res = await fetch('/api/documents', { method: 'POST', body: formData });
      clearInterval(progressTimer);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      setUploadProgress(100);
      // Reset form
      setSelectedFile(null);
      setSelectedProjectId('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchDocuments();
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.filename}"? This will also remove all associated detections.`)) return;
    setDeletingId(doc.id);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? 'Delete failed');
      } else {
        await fetchDocuments();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id;

  const canUpload = !!selectedProjectId && !!selectedFile && !uploading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Documents</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Upload P&amp;ID documents and run asset detection.
        </p>
      </div>

      {/* Upload card */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Upload Document</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Project dropdown */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Project <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              disabled={uploading}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50"
            >
              <option value="">Select a project…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
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
              onChange={handleFileChange}
              disabled={uploading}
              className="w-full text-sm text-zinc-700 dark:text-zinc-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-zinc-200 dark:file:border-zinc-600 file:text-xs file:font-medium file:bg-zinc-50 dark:file:bg-zinc-800 file:text-zinc-700 dark:file:text-zinc-300 hover:file:bg-zinc-100 disabled:opacity-50"
            />
            {selectedFile && (
              <p className="text-xs text-zinc-400 truncate">{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {uploading && (
          <div className="space-y-1">
            <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-zinc-400">Uploading… {uploadProgress}%</p>
          </div>
        )}

        {/* Error */}
        {uploadError && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
            {uploadError}
          </p>
        )}

        {/* Upload button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!canUpload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {uploading && <Spinner />}
            {uploading ? 'Uploading…' : 'Upload PDF'}
          </button>
          {uploadProgress === 100 && !uploading && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Upload successful</span>
          )}
        </div>
      </div>

      {/* Document table */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">All Documents</h2>
          <span className="text-xs text-zinc-400">{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Spinner />
            <span className="ml-2 text-sm">Loading…</span>
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents yet. Upload a PDF above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Filename</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Pages</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Upload Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {documents.map(doc => (
                  <tr key={doc.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-xs block" title={doc.filename}>
                        {doc.filename}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {doc.page_count ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {projectName(doc.project_id)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {statusBadge(doc.status ?? 'UPLOADED')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/detection?project_id=${doc.project_id}`}
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors whitespace-nowrap"
                        >
                          Run Detection
                        </Link>
                        <button
                          onClick={() => handleDelete(doc)}
                          disabled={deletingId === doc.id}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 px-2.5 py-1 rounded-md border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {deletingId === doc.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
