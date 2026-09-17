'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Style constants ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: '500',
  color: 'var(--foreground-muted)',
  margin: '0 0 4px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: '14px',
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontFamily: 'inherit',
  outline: 'none',
};

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--primary)',
  background: 'var(--primary)',
  color: 'var(--surface)',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground-muted)',
  fontSize: '14px',
  fontWeight: '500',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const tabActiveStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  background: 'var(--surface)',
  color: 'var(--foreground)',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
};

const tabInactiveStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  background: 'transparent',
  border: 'none',
  color: 'var(--foreground-muted)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg style={{ width: 16, height: 16, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
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
      router.push(`/legends/${data.id}/review`);
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: 672, display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Link
          href="/legends"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--foreground-muted)', textDecoration: 'none' }}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </Link>
        <span style={{ color: 'var(--foreground-subtle)' }}>/</span>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>New Legend</h1>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)', width: 'fit-content' }}>
        {(['manual', 'upload'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={tab === t ? { ...tabActiveStyle, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', background: 'var(--surface)', color: 'var(--foreground)', border: 'none', padding: '6px 16px', borderRadius: 'var(--radius-sm)', fontWeight: '500', fontSize: '14px', width: 120 } : { ...tabInactiveStyle, padding: '6px 16px', borderRadius: 'var(--radius-sm)', width: 120 }}
          >
            {t === 'manual' ? 'Create Manually' : 'Upload PDF'}
          </button>
        ))}
      </div>

      {/* ── Manual tab ─────────────────────────────────────────────────────────── */}
      {tab === 'manual' && (
        <form
          onSubmit={handleManualSubmit}
          style={{ ...cardStyle, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
            Create a legend and add symbols manually on the next screen.
          </p>

          {/* Name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>
              Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Instrument Legend Sheet 1"
              required
              disabled={saving}
              style={{ ...inputStyle, opacity: saving ? 0.5 : 1 }}
            />
          </div>

          {/* Description */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              disabled={saving}
              style={{ ...inputStyle, resize: 'none', opacity: saving ? 0.5 : 1 }}
            />
          </div>

          {/* Error */}
          {manualError && (
            <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>
              {manualError}
            </p>
          )}

          {/* Submit */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              style={{ ...primaryButtonStyle, opacity: (saving || !name.trim()) ? 0.4 : 1, cursor: (saving || !name.trim()) ? 'not-allowed' : 'pointer' }}
            >
              {saving && <Spinner />}
              {saving ? 'Saving…' : 'Create Legend'}
            </button>
            <Link href="/legends" style={secondaryButtonStyle}>
              Cancel
            </Link>
          </div>
        </form>
      )}

      {/* ── Upload PDF tab ──────────────────────────────────────────────────────── */}
      {tab === 'upload' && (
        <form
          onSubmit={handleUploadSubmit}
          style={{ ...cardStyle, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
            Upload a PDF legend sheet. The AI will extract symbols automatically.
          </p>

          {/* Legend name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>
              Legend Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              value={uploadName}
              onChange={e => setUploadName(e.target.value)}
              placeholder="e.g. Valve Legend Sheet"
              required
              disabled={uploading}
              style={{ ...inputStyle, opacity: uploading ? 0.5 : 1 }}
            />
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
              disabled={uploading}
              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
              style={{ width: '100%', fontSize: '14px', color: 'var(--foreground)', opacity: uploading ? 0.5 : 1 }}
            />
            {uploadFile && (
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0 }}>{uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)</p>
            )}
          </div>

          {/* Error */}
          {uploadError && (
            <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>
              {uploadError}
            </p>
          )}

          {/* Submit */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="submit"
              disabled={uploading || !uploadFile || !uploadName.trim()}
              style={{ ...primaryButtonStyle, opacity: (uploading || !uploadFile || !uploadName.trim()) ? 0.4 : 1, cursor: (uploading || !uploadFile || !uploadName.trim()) ? 'not-allowed' : 'pointer' }}
            >
              {uploading && <Spinner />}
              {uploading ? 'Analyzing…' : 'Analyze PDF'}
            </button>
            <Link href="/legends" style={secondaryButtonStyle}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}