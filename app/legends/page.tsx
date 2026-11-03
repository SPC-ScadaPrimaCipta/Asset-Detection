'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, BookOpen, PencilSimple, Trash } from '@phosphor-icons/react';
import { Card, CardHeader, Button, Badge } from '@/components/ui';
import UploadLegendModal from '@/components/legends/UploadLegendModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Legend {
  id: string;
  name: string;
  description: string;
  created_at: string;
  symbol_count: number;
}

export default function LegendsPage() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const fetchLegends = useCallback(async () => {
    const res = await fetch('/api/legends');
    if (res.ok) {
      const data = await res.json();
      setLegends(data);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed to load legends (${res.status})`);
    }
  }, []);

  useEffect(() => {
    fetchLegends().finally(() => setLoading(false));
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('action') === 'upload') {
        setIsUploadModalOpen(true);
      }
    }
  }, [fetchLegends]);

  const handleDelete = async (legend: Legend) => {
    if (!confirm(`Delete legend "${legend.name}"? This will also remove all its symbols.`)) return;
    setDeletingId(legend.id);
    setError('');
    try {
      const res = await fetch(`/api/legends/${legend.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Delete failed');
      } else {
        await fetchLegends();
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: '0 0 8px' }}>Legend Library</h1>
          <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
            Manage symbol standards, tagging rules, and aliases used during P&amp;ID asset extraction.
          </p>
        </div>
        <Button
          onClick={() => setIsUploadModalOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <Plus size={16} weight="bold" />
          <span>New Legend</span>
        </Button>
      </div>

      {/* Error alert */}
      {error && (
        <p style={{ fontSize: '13px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: '8px', padding: '10px 14px', margin: 0 }}>
          {error}
        </p>
      )}

      {/* Table card */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardHeader title="Symbol Legends" subtitle={!loading ? `${legends.length} configured legend standards` : undefined} />
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: '3px solid var(--border)',
                borderTopColor: 'var(--primary)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>Loading legends...</span>
          </div>
        ) : legends.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', textAlign: 'center', color: 'var(--foreground-muted)' }}>
            <BookOpen size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No legends configured yet.</p>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              style={{
                marginTop: '12px',
                fontSize: '13px',
                color: 'var(--primary)',
                fontWeight: 600,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Upload legend standard →
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', overflowX: 'auto' }} className="document-table-wrapper">
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Legend Name</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Symbols</th>
                  <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Created</th>
                  <th style={{ textAlign: 'right', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {legends.map(legend => (
                  <tr
                    key={legend.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      transition: 'background-color 150ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <td style={{ padding: '14px 24px' }}>
                      <span style={{ fontWeight: '600', color: 'var(--foreground)' }}>{legend.name}</span>
                    </td>
                    <td style={{ padding: '14px 24px', color: 'var(--foreground-muted)', maxWidth: 360 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {legend.description || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 24px' }}>
                      <Badge tone="primary">
                        <span className="tabular-nums">{legend.symbol_count ?? 0}</span> symbols
                      </Badge>
                    </td>
                    <td style={{ padding: '14px 24px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                      {legend.created_at ? new Date(legend.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <Link href={`/legends/${legend.id}`} style={{ textDecoration: 'none' }}>
                          <Button variant="secondary" style={{ height: 34, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <PencilSimple size={14} weight="bold" /> Edit
                          </Button>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(legend)}
                          disabled={deletingId === legend.id}
                          style={{
                            height: 34,
                            padding: '0 12px',
                            borderRadius: 'var(--radius-button, 10px)',
                            border: '1px solid var(--danger-soft, #FFE4E4)',
                            background: 'var(--danger-soft, #FFE4E4)',
                            color: 'var(--danger, #D13451)',
                            cursor: deletingId === legend.id ? 'not-allowed' : 'pointer',
                            opacity: deletingId === legend.id ? 0.5 : 1,
                            fontWeight: 600,
                            fontSize: '12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            transition: 'all 150ms ease-out',
                          }}
                        >
                          <Trash size={14} weight="bold" /> {deletingId === legend.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <UploadLegendModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
      />
    </div>
  );
}
