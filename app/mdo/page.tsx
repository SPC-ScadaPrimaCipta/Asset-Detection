'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkle,
  CheckCircle,
  XCircle,
  PencilSimple,
  FloppyDisk,
  FileXls,
  ArrowLeft,
  ArrowClockwise,
  Check,
  X,
  Funnel,
  MagnifyingGlass,
  Info,
} from '@phosphor-icons/react';
import { assembleMdoDescription } from '@/lib/mdo-description';

interface Document {
  id: string;
  filename: string;
  page_count: number;
  status: string;
  file_type?: string;
}

interface MdoRecord {
  id: string;
  detection_id: string;
  document_id: string;
  location_prefix: string | null;
  tag_no_proposed: string | null;
  equipment_type_short: string | null;
  equipment_name: string | null;
  size: string | null;
  from_value: string | null;
  to_value: string | null;
  of_value: string | null;
  at_value: string | null;
  description: string | null;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  asset_tag: string | null;
  asset_type: string;
  confidence: number | null;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  pid_page: number | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-card, 20px)',
  boxShadow: 'var(--shadow-card)',
};

function StatusBadge({ status }: { status: string }) {
  const isApproved = status === 'APPROVED';
  const isRejected = status === 'REJECTED';
  const bg = isApproved ? 'var(--success-soft)' : isRejected ? 'var(--danger-soft)' : 'var(--warning-soft)';
  const color = isApproved ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--warning)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 'var(--radius-chip, 6px)',
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
        letterSpacing: '0.04em',
      }}
    >
      {status}
    </span>
  );
}

function MdoContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentId, setDocumentId] = useState<string>('');
  const [locationPrefix, setLocationPrefix] = useState<string>('GRS');
  const [records, setRecords] = useState<MdoRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Edit Modal State
  const [editingRecord, setEditingRecord] = useState<MdoRecord | null>(null);
  const [editForm, setEditForm] = useState({
    location_prefix: '',
    tag_no_proposed: '',
    equipment_type_short: '',
    equipment_name: '',
    size: '',
    from_value: '',
    to_value: '',
    of_value: '',
    at_value: '',
    description: '',
    manualDescriptionOverride: false,
  });
  const [editSaving, setEditSaving] = useState(false);

  // 1. Load Documents List
  useEffect(() => {
    fetch('/api/documents')
      .then((r) => r.json())
      .then((data) => {
        const docs = Array.isArray(data) ? data : data.documents || [];
        setDocuments(docs);
        const queryDocId = searchParams.get('document_id');
        if (queryDocId && docs.some((d: Document) => d.id === queryDocId)) {
          setDocumentId(queryDocId);
        } else if (docs.length > 0) {
          setDocumentId(docs[0].id);
        }
      })
      .catch((err) => console.error('[mdo] load docs failed:', err));
  }, [searchParams]);

  // 2. Load MDO Records for active document
  const loadMdoRecords = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/mdo`);
      const body = await res.json();
      const list: MdoRecord[] = Array.isArray(body?.records) ? body.records : [];
      setRecords(list);

      // Extract existing location prefix if present in first record
      const firstWithPrefix = list.find((r) => r.location_prefix);
      if (firstWithPrefix?.location_prefix) {
        setLocationPrefix(firstWithPrefix.location_prefix);
      }
    } catch (err) {
      console.error('[mdo] load records failed:', err);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (documentId) {
      loadMdoRecords();
    }
  }, [documentId, loadMdoRecords]);

  // 3. Trigger Vision AI Process Flow Enrichment & Build MDO
  const handleBuildMdo = async () => {
    if (!documentId) return;
    setEnriching(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/mdo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationPrefix: locationPrefix.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to build MDO');
      await loadMdoRecords();
    } catch (err) {
      console.error('[mdo] build enrichment failed:', err);
      alert('Gagal membuat MDO: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setEnriching(false);
    }
  };

  // 4. Quick Approve / Reject single row
  const handleApprove = async (id: string) => {
    try {
      await fetch(`/api/mdo/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, approval_status: 'APPROVED', rejection_reason: null } : r))
      );
    } catch (err) {
      console.error('[mdo] approve failed:', err);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/mdo/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, approval_status: 'REJECTED' } : r))
      );
    } catch (err) {
      console.error('[mdo] reject failed:', err);
    }
  };

  // 5. Approve All
  const handleApproveAll = async () => {
    if (!documentId) return;
    setApprovingAll(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/mdo/approve-all`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Approve all failed');
      setRecords((prev) => prev.map((r) => ({ ...r, approval_status: 'APPROVED' })));
    } catch (err) {
      console.error('[mdo] approve all failed:', err);
    } finally {
      setApprovingAll(false);
    }
  };

  // 6. Export MDO Excel (9 Columns Accenture Rule)
  const handleExport = () => {
    if (!documentId) return;
    window.location.href = `/api/documents/${documentId}/mdo/export`;
  };

  // 7. Open Edit Modal
  const handleOpenEdit = (rec: MdoRecord) => {
    setEditingRecord(rec);
    setEditForm({
      location_prefix: rec.location_prefix || locationPrefix || '',
      tag_no_proposed: rec.tag_no_proposed || rec.asset_tag || '',
      equipment_type_short: rec.equipment_type_short || '',
      equipment_name: rec.equipment_name || rec.asset_type || '',
      size: rec.size || '',
      from_value: rec.from_value || '',
      to_value: rec.to_value || '',
      of_value: rec.of_value || '',
      at_value: rec.at_value || '',
      description: rec.description || '',
      manualDescriptionOverride: false,
    });
  };

  // Computed description preview in edit modal
  const computedDescriptionPreview = useMemo(() => {
    if (editForm.manualDescriptionOverride) {
      return editForm.description;
    }
    return assembleMdoDescription({
      locationPrefix: editForm.location_prefix,
      equipmentTypeShort: editForm.equipment_type_short || 'EQ',
      size: editForm.size,
      ofValue: editForm.of_value,
      fromValue: editForm.from_value,
      toValue: editForm.to_value,
      atValue: editForm.at_value,
    });
  }, [
    editForm.manualDescriptionOverride,
    editForm.description,
    editForm.location_prefix,
    editForm.equipment_type_short,
    editForm.size,
    editForm.of_value,
    editForm.from_value,
    editForm.to_value,
    editForm.at_value,
  ]);

  // Save Edit
  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    setEditSaving(true);
    try {
      const finalDescription = editForm.manualDescriptionOverride
        ? editForm.description
        : computedDescriptionPreview;

      const payload = {
        location_prefix: editForm.location_prefix.trim() || null,
        tag_no_proposed: editForm.tag_no_proposed.trim() || null,
        equipment_type_short: editForm.equipment_type_short.trim() || null,
        equipment_name: editForm.equipment_name.trim() || null,
        size: editForm.size.trim() || null,
        from_value: editForm.from_value.trim() || null,
        to_value: editForm.to_value.trim() || null,
        of_value: editForm.of_value.trim() || null,
        at_value: editForm.at_value.trim() || null,
        description: finalDescription,
      };

      const res = await fetch(`/api/mdo/${editingRecord.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Save failed');

      setRecords((prev) =>
        prev.map((r) =>
          r.id === editingRecord.id
            ? {
                ...r,
                ...payload,
                description: finalDescription,
              }
            : r
        )
      );

      setEditingRecord(null);
    } catch (err) {
      console.error('[mdo] save edit failed:', err);
      alert('Gagal menyimpan perubahan: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setEditSaving(false);
    }
  };

  // Distinct equipment types for filtering
  const distinctTypes = useMemo(() => {
    const s = new Set<string>();
    records.forEach((r) => {
      if (r.equipment_type_short) s.add(r.equipment_type_short);
      else if (r.asset_type) s.add(r.asset_type);
    });
    return Array.from(s).sort();
  }, [records]);

  // Filter records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (statusFilter !== 'ALL' && r.approval_status !== statusFilter) {
        return false;
      }
      if (typeFilter !== 'ALL') {
        const t = r.equipment_type_short || r.asset_type;
        if (t !== typeFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          (r.tag_no_proposed || '').toLowerCase().includes(q) ||
          (r.asset_tag || '').toLowerCase().includes(q) ||
          (r.equipment_type_short || '').toLowerCase().includes(q) ||
          (r.equipment_name || '').toLowerCase().includes(q) ||
          (r.size || '').toLowerCase().includes(q) ||
          (r.from_value || '').toLowerCase().includes(q) ||
          (r.to_value || '').toLowerCase().includes(q) ||
          (r.of_value || '').toLowerCase().includes(q) ||
          (r.at_value || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [records, statusFilter, typeFilter, searchQuery]);

  const counts = {
    total: records.length,
    approved: records.filter((r) => r.approval_status === 'APPROVED').length,
    pending: records.filter((r) => r.approval_status === 'PENDING').length,
    rejected: records.filter((r) => r.approval_status === 'REJECTED').length,
  };

  const activeDoc = documents.find((d) => d.id === documentId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100vh - var(--topbar-height) - 20px)', overflow: 'hidden' }}>
      {/* ── Top Header Bar ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <Link
            href={`/detection?document_id=${documentId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={13} /> Back to Detection
          </Link>

          {/* Document Selector */}
          <select
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              fontSize: 13,
              fontWeight: 600,
              maxWidth: 240,
            }}
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>

          {/* Location Prefix Input (e.g. GRS, MTR) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}>
            <span style={{ fontSize: 11, color: 'var(--foreground-muted)', fontWeight: 600 }}>Prefix:</span>
            <input
              type="text"
              value={locationPrefix}
              onChange={(e) => setLocationPrefix(e.target.value.toUpperCase())}
              placeholder="e.g. GRS"
              title="Location Prefix for Alternative Description (PT Accenture Rule)"
              style={{
                width: 60,
                border: 'none',
                background: 'transparent',
                color: 'var(--foreground)',
                fontSize: 12,
                fontWeight: 700,
                outline: 'none',
              }}
            />
          </div>

          {/* Build MDO with Vision AI */}
          <button
            onClick={handleBuildMdo}
            disabled={enriching || !documentId}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid #7c3aed',
              background: '#7c3aed',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: enriching ? 'not-allowed' : 'pointer',
              opacity: enriching ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Sparkle size={14} weight="fill" />
            {enriching ? 'Analyzing Flow with AI…' : 'Analyze Process Flow & Build MDO'}
          </button>
        </div>

        {/* Right Header: Stats, Approve All, and Final Export */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={handleApproveAll}
            disabled={approvingAll || counts.pending === 0}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              fontSize: 12,
              fontWeight: 600,
              cursor: approvingAll || counts.pending === 0 ? 'not-allowed' : 'pointer',
              opacity: approvingAll || counts.pending === 0 ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <CheckCircle size={14} />
            {approvingAll ? 'Approving…' : `Approve All (${counts.pending})`}
          </button>

          <button
            onClick={handleExport}
            disabled={records.length === 0}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid #16a34a',
              background: '#16a34a',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: records.length === 0 ? 'not-allowed' : 'pointer',
              opacity: records.length === 0 ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 4px rgba(22,163,74,0.2)',
            }}
          >
            <FileXls size={15} weight="bold" />
            Export Asset Register (Excel)
          </button>
        </div>
      </div>

      {/* ── Subheader / Filter Bar ──────────────────────────────────────── */}
      <div
        style={{
          ...cardStyle,
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ position: 'relative', width: 260 }}>
            <MagnifyingGlass
              size={13}
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-muted)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Tag, Type, From, To, Of…"
              style={{
                width: '100%',
                padding: '4px 8px 4px 26px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Status Tabs */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => {
              const active = statusFilter === s;
              const count = s === 'ALL' ? counts.total : s === 'PENDING' ? counts.pending : s === 'APPROVED' ? counts.approved : counts.rejected;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    background: active ? 'var(--primary)' : 'var(--surface)',
                    color: active ? '#fff' : 'var(--foreground-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {s} ({count})
                </button>
              );
            })}
          </div>

          {/* Equipment Type Filter */}
          {distinctTypes.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Funnel size={12} color="var(--foreground-muted)" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--foreground)',
                  fontSize: 11,
                }}
              >
                <option value="ALL">All Types</option>
                {distinctTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--foreground-muted)' }}>
          <span>Showing <strong>{filteredRecords.length}</strong> of <strong>{records.length}</strong> MDO items</span>
        </div>
      </div>

      {/* ── Main Data Table (8 Columns PT Accenture Rule) ────────────────── */}
      <div
        style={{
          ...cardStyle,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  background: 'var(--surface-muted)',
                  borderBottom: '2px solid var(--border)',
                  color: 'var(--foreground-muted)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                <th style={{ padding: '8px 10px', width: 40, textAlign: 'center' }}>#</th>
                <th style={{ padding: '8px 10px', width: 140 }}>Equipment Tag</th>
                <th style={{ padding: '8px 8px', width: 80 }}>Type Short</th>
                <th style={{ padding: '8px 10px', width: 160 }}>Equipment Name</th>
                <th style={{ padding: '8px 8px', width: 70 }}>Size</th>
                <th style={{ padding: '8px 10px', width: 120 }}>From</th>
                <th style={{ padding: '8px 10px', width: 140 }}>To</th>
                <th style={{ padding: '8px 10px', width: 130 }}>Of</th>
                <th style={{ padding: '8px 10px', width: 110 }}>At</th>
                <th style={{ padding: '8px 10px' }}>Description (Accenture Rule)</th>
                <th style={{ padding: '8px 10px', width: 90, textAlign: 'center' }}>Status</th>
                <th style={{ padding: '8px 10px', width: 100, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} style={{ padding: 40, textAlign: 'center', color: 'var(--foreground-muted)' }}>
                    Loading Master Data Object records…
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
                        Belum ada data MDO untuk dokumen ini.
                      </p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-muted)', maxWidth: 520, lineHeight: 1.5 }}>
                        Hanya aset yang telah <strong>disetujui / di-approve</strong> (atau ditambahkan manual) di halaman Detection yang akan diproses ke MDO. Aset yang di-reject atau berstatus pending tidak dimasukkan. Klik tombol <strong>Analyze Process Flow & Build MDO</strong> di atas untuk merakit deskripsi 9 kolom.
                      </p>
                      <button
                        onClick={handleBuildMdo}
                        disabled={enriching}
                        style={{
                          marginTop: 6,
                          padding: '6px 16px',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          background: '#7c3aed',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <Sparkle size={14} weight="fill" /> Build MDO Now
                      </button>
                    </div>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-muted)' }}>
                    Tidak ada aset yang cocok dengan filter / pencarian.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, idx) => {
                  const isApproved = r.approval_status === 'APPROVED';
                  const isRejected = r.approval_status === 'REJECTED';

                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isApproved
                          ? 'rgba(34,197,94,0.03)'
                          : isRejected
                          ? 'rgba(239,68,68,0.03)'
                          : 'transparent',
                      }}
                    >
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: 11 }}>
                        {idx + 1}
                      </td>

                      {/* 1. Equipment Tag */}
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--foreground)' }}>
                        {r.tag_no_proposed || r.asset_tag || '-'}
                      </td>

                      {/* 2. Short for Equipment Type */}
                      <td style={{ padding: '7px 8px' }}>
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'var(--surface-muted)',
                            fontSize: 11,
                            fontFamily: 'ui-monospace, monospace',
                            fontWeight: 600,
                            color: 'var(--foreground)',
                          }}
                        >
                          {r.equipment_type_short || '-'}
                        </span>
                      </td>

                      {/* 3. Equipment Name */}
                      <td style={{ padding: '7px 10px', color: 'var(--foreground)' }}>
                        {r.equipment_name || r.asset_type || '-'}
                      </td>

                      {/* 4. Size */}
                      <td style={{ padding: '7px 8px', color: 'var(--foreground-muted)', fontFamily: 'ui-monospace, monospace' }}>
                        {r.size || '-'}
                      </td>

                      {/* 5. From */}
                      <td style={{ padding: '7px 10px', color: 'var(--foreground-muted)', fontSize: 11 }}>
                        {r.from_value || '-'}
                      </td>

                      {/* 6. To */}
                      <td style={{ padding: '7px 10px', color: 'var(--foreground-muted)', fontSize: 11 }}>
                        {r.to_value || '-'}
                      </td>

                      {/* 7. Of */}
                      <td style={{ padding: '7px 10px', color: 'var(--foreground-muted)', fontSize: 11 }}>
                        {r.of_value || '-'}
                      </td>

                      {/* 8. At */}
                      <td style={{ padding: '7px 10px', color: 'var(--foreground-muted)', fontSize: 11 }}>
                        {r.at_value || '-'}
                      </td>

                      {/* 9. Description */}
                      <td style={{ padding: '7px 10px' }}>
                        <span
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--foreground)',
                          }}
                        >
                          {r.description || '-'}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <StatusBadge status={r.approval_status} />
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <button
                            onClick={() => handleApprove(r.id)}
                            title="Approve"
                            style={{
                              background: isApproved ? 'var(--success)' : 'var(--surface-muted)',
                              color: isApproved ? '#fff' : 'var(--foreground-muted)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <Check size={11} weight="bold" />
                          </button>
                          <button
                            onClick={() => handleReject(r.id)}
                            title="Reject"
                            style={{
                              background: isRejected ? 'var(--danger)' : 'var(--surface-muted)',
                              color: isRejected ? '#fff' : 'var(--foreground-muted)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <X size={11} weight="bold" />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(r)}
                            title="Edit & Customize Row"
                            style={{
                              background: 'var(--surface-muted)',
                              color: 'var(--foreground-muted)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <PencilSimple size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit & Full Customization Modal ──────────────────────────────── */}
      {editingRecord && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingRecord(null);
          }}
        >
          <div style={{ ...cardStyle, padding: 20, width: 480, boxShadow: '0 20px 40px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                  Customize MDO Attributes
                </h2>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>
                  Accenture Rule
                </span>
              </div>
              <button onClick={() => setEditingRecord(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--foreground-muted)' }}>
                &times;
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Location Prefix */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>Location Prefix</span>
                  <input
                    type="text"
                    value={editForm.location_prefix}
                    onChange={(e) => setEditForm((p) => ({ ...p, location_prefix: e.target.value.toUpperCase() }))}
                    placeholder="e.g. GRS"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>

                {/* 1. Equipment Tag */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>Equipment Tag</span>
                  <input
                    type="text"
                    value={editForm.tag_no_proposed}
                    onChange={(e) => setEditForm((p) => ({ ...p, tag_no_proposed: e.target.value }))}
                    placeholder="e.g. 30756-PT-1020A"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* 2. Short Equipment Type */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>Short Type (Short for Type)</span>
                  <input
                    type="text"
                    value={editForm.equipment_type_short}
                    onChange={(e) => setEditForm((p) => ({ ...p, equipment_type_short: e.target.value.toUpperCase() }))}
                    placeholder="e.g. PT, PIPE, BV"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>

                {/* 3. Equipment Name */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>Equipment Name</span>
                  <input
                    type="text"
                    value={editForm.equipment_name}
                    onChange={(e) => setEditForm((p) => ({ ...p, equipment_name: e.target.value }))}
                    placeholder="e.g. Pressure Transmitter"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                {/* 4. Size */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>Size / Spec</span>
                  <input
                    type="text"
                    value={editForm.size}
                    onChange={(e) => setEditForm((p) => ({ ...p, size: e.target.value }))}
                    placeholder='e.g. 1/2", 2", 4"'
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>

                {/* 7. Of */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>Of (Context / System)</span>
                  <input
                    type="text"
                    value={editForm.of_value}
                    onChange={(e) => setEditForm((p) => ({ ...p, of_value: e.target.value }))}
                    placeholder="e.g. HEADER LINE, METERING B"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* 5. From */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>From (Origin)</span>
                  <input
                    type="text"
                    value={editForm.from_value}
                    onChange={(e) => setEditForm((p) => ({ ...p, from_value: e.target.value }))}
                    placeholder="e.g. SDV-1012, GRS"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>

                {/* 6. To */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>To (Destination)</span>
                  <input
                    type="text"
                    value={editForm.to_value}
                    onChange={(e) => setEditForm((p) => ({ ...p, to_value: e.target.value }))}
                    placeholder="e.g. PRESSURE TRANSMITTER A, VENT"
                    style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                  />
                </label>
              </div>

              {/* 8. At (Location / Installation Point) */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)' }}>At (Location / Point)</span>
                <input
                  type="text"
                  value={editForm.at_value}
                  onChange={(e) => setEditForm((p) => ({ ...p, at_value: e.target.value }))}
                  placeholder="e.g. WELLHEAD, TOP TOWER, DISCHARGE NOZZLE"
                  style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12 }}
                />
              </label>

              {/* 9. Description & Formula Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground)' }}>
                    9. Formulated Description:
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: 'var(--foreground-muted)' }}>
                    <input
                      type="checkbox"
                      checked={editForm.manualDescriptionOverride}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          manualDescriptionOverride: e.target.checked,
                          description: e.target.checked ? computedDescriptionPreview : p.description,
                        }))
                      }
                    />
                    Manual Override
                  </label>
                </div>

                {editForm.manualDescriptionOverride ? (
                  <textarea
                    rows={2}
                    value={editForm.description}
                    onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      fontSize: 12,
                      fontFamily: 'ui-monospace, monospace',
                      resize: 'none',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                    }}
                  >
                    {computedDescriptionPreview || '(Empty description)'}
                  </div>
                )}
                <span style={{ fontSize: 10, color: 'var(--foreground-muted)' }}>
                  Rule: [Prefix-] + Eqp + Size + [OF] + [FROM] + [TO] + [AT]
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setEditingRecord(null)}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--foreground)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: editSaving ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <FloppyDisk size={14} />
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MdoPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, textAlign: 'center' }}>Loading MDO Workspace…</div>}>
      <MdoContent />
    </Suspense>
  );
}
