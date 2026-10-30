'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Stack,
  Trash,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  ShieldCheck,
  Check,
  Spinner,
} from '@phosphor-icons/react';

export interface DedupGroupItem {
  id?: string;
  assetTag?: string | null;
  assetType?: string | null;
  confidence?: number | null;
  reviewStatus?: string | null;
  page?: number | null;
}

export interface DedupGroup {
  winnerId: string;
  winner: DedupGroupItem;
  duplicates: DedupGroupItem[];
}

export interface DedupPreviewData {
  total_detections: number;
  duplicate_count: number;
  groups_count: number;
  unreviewed_count: number;
  reviewed_count: number;
  groups: DedupGroup[];
}

interface DedupModalProps {
  isOpen: boolean;
  documentId: string;
  documentName?: string;
  onClose: () => void;
  onSuccess: (deletedCount: number) => void;
}

export default function DedupModal({
  isOpen,
  documentId,
  documentName,
  onClose,
  onSuccess,
}: DedupModalProps) {
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DedupPreviewData | null>(null);
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/detections/deduplicate?document_id=${documentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat pratinjau duplikat');
      setPreview(data);
    } catch (err: any) {
      console.error('[DedupModal] fetch error:', err);
      setError(err.message || 'Terjadi kesalahan saat memindai duplikat.');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (isOpen && documentId) {
      fetchPreview();
      setIncludeReviewed(false);
    } else {
      setPreview(null);
      setError(null);
      setSuccessMsg(null);
    }
  }, [isOpen, documentId, fetchPreview]);

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (!documentId) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await fetch('/api/detections/deduplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          include_reviewed: includeReviewed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membersihkan duplikat');

      const deleted = data.deleted_count ?? 0;
      setSuccessMsg(`Berhasil menghapus ${deleted} aset duplikat.`);
      onSuccess(deleted);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('[DedupModal] execute error:', err);
      setError(err.message || 'Gagal menjalankan deduplikasi.');
    } finally {
      setExecuting(false);
    }
  };

  const toDeleteCount = preview
    ? includeReviewed
      ? preview.duplicate_count
      : preview.unreviewed_count
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !executing) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          background: 'var(--surface, #1e2430)',
          border: '1px solid var(--border, rgba(255, 255, 255, 0.12))',
          borderRadius: 'var(--radius, 12px)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(245, 158, 11, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f59e0b',
              }}
            >
              <Stack size={18} weight="duotone" />
            </div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--foreground, #f8fafc)' }}>
                Deduplikasi Deteksi Aset (Dedup)
              </h2>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted, #94a3b8)', marginTop: 2 }}>
                Pembersihan deteksi berulang pada: <strong>{documentName || 'Dokumen P&ID'}</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={executing}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--foreground-muted, #94a3b8)',
              cursor: executing ? 'not-allowed' : 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Success Banner */}
          {successMsg && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#22c55e',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <CheckCircle size={18} weight="fill" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: '#ef4444',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <WarningCircle size={16} weight="fill" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={fetchPreview}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  textDecoration: 'underline',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Coba lagi
              </button>
            </div>
          )}

          {/* Loading State */}
          {loading && !preview && (
            <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--foreground-muted)' }}>
              <div style={{ marginBottom: 8 }}>
                <Stack size={28} className="animate-pulse" style={{ color: '#f59e0b' }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                Menganalisis Geometri & Kesamaan Simbol...
              </div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Mendeteksi bounding box yang tumpang tindih dan tag serupa antar-lane.
              </div>
            </div>
          )}

          {/* Preview Results */}
          {!loading && preview && (
            <>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--surface-muted, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total Duplikat
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: preview.duplicate_count > 0 ? '#f59e0b' : '#22c55e', marginTop: 2 }}>
                    {preview.duplicate_count}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 2 }}>
                    dari {preview.total_detections} total aset
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--surface-muted, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Kelompok Simbol
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--foreground)', marginTop: 2 }}>
                    {preview.groups_count}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 2 }}>
                    lokasi simbol redundan
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--surface-muted, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Aman Dihapus
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#3b82f6', marginTop: 2 }}>
                    {preview.unreviewed_count}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 2 }}>
                    status belum di-review
                  </div>
                </div>
              </div>

              {/* If 0 duplicates */}
              {preview.duplicate_count === 0 ? (
                <div
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    background: 'rgba(34, 197, 94, 0.06)',
                    borderRadius: 8,
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                  }}
                >
                  <ShieldCheck size={36} weight="duotone" color="#22c55e" style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>Dokumen Bersih</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4, maxWidth: 420, margin: '4px auto 0' }}>
                    Tidak ditemukan deteksi duplikat pada dokumen ini. Seluruh aset memiliki koordinat geometri atau identitas simbol yang unik.
                  </div>
                </div>
              ) : (
                <>
                  {/* Explanatory text */}
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--foreground-muted)',
                      lineHeight: 1.5,
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.2)',
                      padding: '8px 12px',
                      borderRadius: 8,
                    }}
                  >
                    <strong>Bagaimana Dedup Bekerja:</strong> Sistem mencocokkan tumpang-tindih koordinat (IoU), kesesuaian tipe, dan kemiripan tag. Aset dengan kelengkapan tertinggi (misal yang sudah di-tag/review) dipilih sebagai <em>pemenang</em>, dan gandaannya akan dihapus.
                  </div>

                  {/* Duplicate Group List Preview */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>
                        Daftar Kelompok Duplikat ({preview.groups.length}{preview.groups_count > preview.groups.length ? ` dari ${preview.groups_count}` : ''})
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--foreground-muted)' }}>
                        Hijau = Simpan · Merah = Hapus
                      </span>
                    </div>

                    <div
                      style={{
                        maxHeight: 180,
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.15)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: 8,
                      }}
                    >
                      {preview.groups.map((g, idx) => (
                        <div
                          key={g.winnerId || idx}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            fontSize: 11,
                          }}
                        >
                          {/* Winner Row */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: 'rgba(34, 197, 94, 0.15)',
                                  color: '#22c55e',
                                  border: '1px solid rgba(34, 197, 94, 0.3)',
                                }}
                              >
                                KEEP
                              </span>
                              <strong style={{ color: 'var(--foreground)' }}>
                                {g.winner.assetTag || '(No Tag)'}
                              </strong>
                              <span style={{ color: 'var(--foreground-muted)', fontSize: 10 }}>
                                • {g.winner.assetType || 'Equipment'}
                              </span>
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--foreground-muted)' }}>
                              Hal {g.winner.page ?? 1} · {Math.round((g.winner.confidence ?? 0) * 100)}%
                            </span>
                          </div>

                          {/* Duplicates List */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 12, borderLeft: '2px solid rgba(239, 68, 68, 0.4)' }}>
                            {g.duplicates.map((d, dIdx) => (
                              <div
                                key={d.id || dIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  fontSize: 10,
                                  color: 'var(--foreground-muted)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ color: '#ef4444' }}>✕</span>
                                  <span style={{ color: d.assetTag ? 'var(--foreground)' : 'var(--foreground-subtle)' }}>
                                    {d.assetTag || '(No Tag)'}
                                  </span>
                                  <span>— {d.assetType}</span>
                                </div>
                                <span>{Math.round((d.confidence ?? 0) * 100)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Include Reviewed Checkbox if applicable */}
                  {preview.reviewed_count > 0 && (
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        cursor: 'pointer',
                        fontSize: 11,
                        color: 'var(--foreground)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={includeReviewed}
                        onChange={(e) => setIncludeReviewed(e.target.checked)}
                        style={{ marginTop: 2, cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          Hapus juga {preview.reviewed_count} duplikat yang sudah berstatus APPROVED / REVIEWED
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 1 }}>
                          Secara default, aset yang sudah Anda setujui dilindungi dari penghapusan otomatis.
                        </div>
                      </div>
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            background: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={executing}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm, 6px)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--foreground)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {preview && preview.duplicate_count === 0 ? 'Tutup' : 'Batal'}
          </button>

          {preview && preview.duplicate_count > 0 && (
            <button
              type="button"
              onClick={handleExecute}
              disabled={executing || toDeleteCount === 0}
              style={{
                padding: '7px 16px',
                borderRadius: 'var(--radius-sm, 6px)',
                border: 'none',
                background: '#ea580c',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: executing || toDeleteCount === 0 ? 'not-allowed' : 'pointer',
                opacity: executing || toDeleteCount === 0 ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 6px rgba(234, 88, 12, 0.3)',
              }}
            >
              <Trash size={14} weight="bold" />
              {executing
                ? 'Membersihkan...'
                : `Bersihkan ${toDeleteCount} Duplikat`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
