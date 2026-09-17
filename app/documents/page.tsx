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

// ─── Style Constants ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '14px',
  fontFamily: 'inherit',
  outline: 'none',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--primary)',
  background: 'var(--primary)',
  color: 'var(--surface)',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: '12px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tdBase: React.CSSProperties = { padding: '12px 16px' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: '500',
};

function statusBadge(status: string) {
  switch (status?.toUpperCase()) {
    case 'UPLOADED':
      return (
        <span style={{ ...badgeBase, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>
          Uploaded
        </span>
      );
    case 'PROCESSING':
      return (
        <span style={{ ...badgeBase, background: 'var(--info-soft)', color: 'var(--info)' }}>
          Processing
        </span>
      );
    case 'DONE':
      return (
        <span style={{ ...badgeBase, background: 'var(--success-soft)', color: 'var(--success)' }}>
          Done
        </span>
      );
    default:
      return (
        <span style={{ ...badgeBase, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>
          {status ?? '—'}
        </span>
      );
  }
}

function Spinner() {
  return (
    <svg style={{ width: 20, height: 20, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: '0 0 8px' }}>Documents</h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
          Upload P&amp;ID documents and run asset detection.
        </p>
      </div>

      {/* Upload card */}
      <div style={{ ...cardStyle, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>Upload Document</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {/* Project dropdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>
              Project <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              disabled={uploading}
              style={{ ...selectStyle, opacity: uploading ? 0.5 : 1 }}
            >
              <option value="">Select a project…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* File input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>
              PDF File <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              disabled={uploading}
              style={{ width: '100%', fontSize: '14px', color: 'var(--foreground)', opacity: uploading ? 0.5 : 1 }}
            />
            {selectedFile && (
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {uploading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'var(--border)', overflow: 'hidden' }}>
              <div
                style={{ height: '6px', borderRadius: '3px', background: 'var(--info)', width: `${uploadProgress}%`, transition: 'width 300ms ease-out' }}
              />
            </div>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0 }}>Uploading… {uploadProgress}%</p>
          </div>
        )}

        {/* Error */}
        {uploadError && (
          <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>
            {uploadError}
          </p>
        )}

        {/* Upload button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleUpload}
            disabled={!canUpload}
            style={{ ...primaryButtonStyle, opacity: !canUpload ? 0.4 : 1, cursor: !canUpload ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            {uploading && <Spinner />}
            {uploading ? 'Uploading…' : 'Upload PDF'}
          </button>
          {uploadProgress === 100 && !uploading && (
            <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: '500' }}>✓ Upload successful</span>
          )}
        </div>
      </div>

      {/* Document table */}
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>All Documents</h2>
          <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--foreground-muted)' }}>
            <Spinner />
            <span style={{ marginLeft: '8px', fontSize: '14px' }}>Loading…</span>
          </div>
        ) : documents.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', textAlign: 'center' }}>
            <svg style={{ width: 40, height: 40, color: 'var(--border-strong)', marginBottom: '12px' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>No documents yet. Upload a PDF above.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th style={thStyle}>Filename</th>
                  <th style={thStyle}>Pages</th>
                  <th style={thStyle}>Project</th>
                  <th style={thStyle}>Upload Date</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id} style={{ borderTop: '1px solid var(--border)', transition: 'background 150ms ease-out' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 43, 78, 0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={tdBase}>
                      <span style={{ fontWeight: '500', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 320 }} title={doc.filename}>
                        {doc.filename}
                      </span>
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>
                      {doc.page_count ?? '—'}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>
                      {projectName(doc.project_id)}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>
                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={tdBase}>
                      {statusBadge(doc.status ?? 'UPLOADED')}
                    </td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        <Link
                          href={`/detection?project_id=${doc.project_id}`}
                          style={{ fontSize: '12px', fontWeight: '500', color: 'var(--info)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--info-soft)', background: 'var(--info-soft)', textDecoration: 'none', whiteSpace: 'nowrap', transition: 'all 150ms ease-out' }}
                        >
                          Run Detection
                        </Link>
                        <button
                          onClick={() => handleDelete(doc)}
                          disabled={deletingId === doc.id}
                          style={{ fontSize: '12px', fontWeight: '500', color: 'var(--danger)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--danger-soft)', background: 'var(--danger-soft)', cursor: 'pointer', opacity: deletingId === doc.id ? 0.4 : 1, transition: 'all 150ms ease-out' }}
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
