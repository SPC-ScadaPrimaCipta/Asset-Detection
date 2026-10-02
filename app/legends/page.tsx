'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Legend {
  id: string;
  name: string;
  description: string;
  created_at: string;
  symbol_count: number;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--primary)',
  background: 'var(--primary)',
  color: 'var(--surface)',
  fontSize: '13px',
  fontWeight: '500',
  textDecoration: 'none',
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

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: '500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg style={{ width: 20, height: 20, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LegendsPage() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: '0 0 8px' }}>Legend Library</h1>
          <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
            Manage symbol legends used during P&amp;ID asset detection.
          </p>
        </div>
        <Link href="/legends/new" style={primaryButtonStyle}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Legend
        </Link>
      </div>

      {/* Error */}
      {error && (
        <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>
          {error}
        </p>
      )}

      {/* Table card */}
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>Legends</h2>
          {!loading && (
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{legends.length} legend{legends.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--foreground-muted)' }}>
            <Spinner />
            <span style={{ marginLeft: '8px', fontSize: '14px' }}>Loading…</span>
          </div>
        ) : legends.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', textAlign: 'center' }}>
            <svg style={{ width: 40, height: 40, color: 'var(--border-strong)', marginBottom: '12px' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>No legends yet. Create one to get started.</p>
            <Link href="/legends/new" style={{ marginTop: '12px', fontSize: '14px', color: 'var(--accent)', textDecoration: 'none' }}>
              Create a legend →
            </Link>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Symbols</th>
                  <th style={thStyle}>Created</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {legends.map(legend => (
                  <tr key={legend.id} style={{ borderTop: '1px solid var(--border)', transition: 'background 150ms ease-out' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 43, 78, 0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={tdBase}>
                      <span style={{ fontWeight: '500', color: 'var(--foreground)' }}>{legend.name}</span>
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', maxWidth: 320 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{legend.description || '—'}</span>
                    </td>
                    <td style={tdBase}>
                      <span style={{ ...badgeBase, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>
                        {legend.symbol_count ?? 0}
                      </span>
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>
                      {legend.created_at ? new Date(legend.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        <Link
                          href={`/legends/${legend.id}`}
                          style={{ fontSize: '12px', fontWeight: '500', color: 'var(--foreground)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', textDecoration: 'none', transition: 'all 150ms ease-out' }}
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDelete(legend)}
                          disabled={deletingId === legend.id}
                          style={{ fontSize: '12px', fontWeight: '500', color: 'var(--danger)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--danger-soft)', background: 'var(--danger-soft)', cursor: 'pointer', opacity: deletingId === legend.id ? 0.4 : 1, transition: 'all 150ms ease-out' }}
                        >
                          {deletingId === legend.id ? 'Deleting…' : 'Delete'}
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
