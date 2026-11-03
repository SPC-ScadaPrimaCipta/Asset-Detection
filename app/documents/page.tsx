'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { UploadSimple, Lightning, Trash, CaretLeft, CaretRight, CheckCircle, FileText, FileCode } from '@phosphor-icons/react';
import { Card, CardHeader, Button, Badge } from '@/components/ui';
import { LoadingOverlay } from '@/components/LoadingOverlay';

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
  file_type?: string;
}

function StatusIndicator({ status }: { status: string }) {
  const s = status?.toUpperCase() || 'UPLOADED';
  if (s === 'DONE' || s === 'READY') {
    return <Badge tone="success">Ready</Badge>;
  }
  if (s === 'PROCESSING') {
    return <Badge tone="info">Processing</Badge>;
  }
  if (s === 'FAILED') {
    return <Badge tone="danger">Failed</Badge>;
  }
  return <Badge tone="neutral">{s}</Badge>;
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

  // Pagination
  const [docPage, setDocPage] = useState(1);
  const [docPageSize, setDocPageSize] = useState(10);

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
    <>
      <LoadingOverlay
        isVisible={uploading}
        message="Uploading document..."
        subMessage="Processing file. This may take a moment."
      />
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: '0 0 8px' }}>Documents</h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
          Upload PDF drawings and DXF vector sheets to run multimodal asset detection.
        </p>
      </div>

      {/* Upload card */}
      <Card>
        <CardHeader title="Upload P&ID Document" subtitle="Supported formats: Vector / Scanned PDF (multi-page) or AutoCAD DXF (up to 50MB)" />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: 12 }}>
          {/* Project dropdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Target Project <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              disabled={uploading}
              style={{
                height: 44,
                padding: '0 14px',
                borderRadius: 'var(--radius-input, 10px)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--foreground)',
                fontSize: '14px',
                outline: 'none',
                cursor: 'pointer',
                opacity: uploading ? 0.5 : 1,
              }}
            >
              <option value="">Select a project…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* File input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select File <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <div
              style={{
                height: 44,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                borderRadius: 'var(--radius-input, 10px)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf,.dxf"
                onChange={handleFileChange}
                disabled={uploading}
                style={{ width: '100%', fontSize: '13px', color: 'var(--foreground)', cursor: 'pointer' }}
              />
            </div>
            {selectedFile && (
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                {selectedFile.name.toLowerCase().endsWith('.dxf') && (
                  <Badge tone="info">DXF</Badge>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {uploading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 16 }}>
            <div style={{ width: '100%', height: '6px', borderRadius: '999px', background: 'var(--border)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '6px',
                  borderRadius: '999px',
                  background: 'var(--primary)',
                  width: `${uploadProgress}%`,
                  transition: 'width 300ms ease-out',
                }}
              />
            </div>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0 }}>Processing upload… {uploadProgress}%</p>
          </div>
        )}

        {/* Error message */}
        {uploadError && (
          <p style={{ fontSize: '13px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: '8px', padding: '10px 14px', margin: '14px 0 0' }}>
            {uploadError}
          </p>
        )}

        {/* Upload button action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: 18 }}>
          <Button
            onClick={handleUpload}
            disabled={!canUpload}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', opacity: !canUpload ? 0.5 : 1 }}
          >
            {uploading ? (
              <>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <UploadSimple size={16} weight="bold" />
                <span>Upload Document</span>
              </>
            )}
          </Button>
          {uploadProgress === 100 && !uploading && (
            <span style={{ fontSize: '13px', color: 'var(--success)', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle size={16} weight="fill" /> Upload successful
            </span>
          )}
        </div>
      </Card>

      {/* Document table card */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardHeader title="All Uploaded Documents" subtitle={`${documents.length} document${documents.length !== 1 ? 's' : ''} in repository`} />
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--foreground-muted)', gap: 8 }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--primary)', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: '14px' }}>Loading documents…</span>
          </div>
        ) : documents.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', textAlign: 'center', color: 'var(--foreground-muted)' }}>
            <FileText size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No documents uploaded yet. Choose a project and upload a file above.</p>
          </div>
        ) : (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Filename</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pages</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Project</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Upload Date</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.slice((docPage - 1) * docPageSize, docPage * docPageSize).map(doc => {
                  const isDxf = doc.filename.toLowerCase().endsWith('.dxf');
                  return (
                    <tr
                      key={doc.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background-color 150ms ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <td style={{ padding: '14px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ color: 'var(--primary)', flexShrink: 0 }}>
                            {isDxf ? <FileCode size={18} /> : <FileText size={18} />}
                          </span>
                          <div>
                            <span style={{ fontWeight: '600', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 320 }} title={doc.filename}>
                              {doc.filename}
                            </span>
                            {isDxf && (
                              <Badge tone="info" style={{ marginTop: 2 }}>DXF Vector</Badge>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 24px', color: 'var(--foreground-muted)' }}>
                        {isDxf ? 'Drawing' : `${doc.page_count ?? '—'} page(s)`}
                      </td>
                      <td style={{ padding: '14px 24px', color: 'var(--foreground-muted)' }}>
                        {projectName(doc.project_id)}
                      </td>
                      <td style={{ padding: '14px 24px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '14px 24px' }}>
                        <StatusIndicator status={doc.status} />
                      </td>
                      <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <Link href={`/detection?project_id=${doc.project_id}`} style={{ textDecoration: 'none' }}>
                            <Button style={{ height: 34, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Lightning size={14} weight="fill" /> Run Detection
                            </Button>
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(doc)}
                            disabled={deletingId === doc.id}
                            style={{
                              height: 34,
                              padding: '0 12px',
                              borderRadius: 'var(--radius-button, 10px)',
                              border: '1px solid var(--danger-soft, #FFE4E4)',
                              background: 'var(--danger-soft, #FFE4E4)',
                              color: 'var(--danger, #D13451)',
                              cursor: deletingId === doc.id ? 'not-allowed' : 'pointer',
                              opacity: deletingId === doc.id ? 0.5 : 1,
                              fontWeight: 600,
                              fontSize: '12px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              transition: 'all 150ms ease-out',
                            }}
                          >
                            <Trash size={14} weight="bold" /> {deletingId === doc.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <Button
            variant="secondary"
            onClick={() => setDocPage(p => Math.max(1, p - 1))}
            disabled={docPage === 1}
            style={{ height: 32, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <CaretLeft size={12} weight="bold" /> Prev
          </Button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Show</span>
            <select
              value={docPageSize}
              onChange={e => { setDocPageSize(Number(e.target.value)); setDocPage(1); }}
              style={{
                height: 28,
                padding: '2px 8px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--foreground)',
                cursor: 'pointer',
              }}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
              Page <strong>{docPage}</strong> of <strong>{Math.max(1, Math.ceil(documents.length / docPageSize))}</strong> · {documents.length} total
            </span>
          </div>

          <Button
            variant="secondary"
            onClick={() => setDocPage(p => Math.min(Math.ceil(documents.length / docPageSize), p + 1))}
            disabled={docPage >= Math.ceil(documents.length / docPageSize)}
            style={{ height: 32, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            Next <CaretRight size={12} weight="bold" />
          </Button>
        </div>
      </Card>
      </div>
    </>
  );
}
