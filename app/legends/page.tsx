'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, PencilSimple, Trash, CaretLeft, CaretRight } from '@phosphor-icons/react';

interface Legend {
  id: string;
  name: string;
  description: string;
  created_at: string;
  symbol_count: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
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

const paginBtn = (disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 12px', fontSize: '12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  color: 'var(--foreground-muted)',
});

function Spinner() {
  return (
    <svg style={{ width: 20, height: 20, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function LegendsPage() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchLegends = useCallback(async () => {
    const res = await fetch('/api/legends');
    if (res.ok) setLegends(await res.json());
  }, []);

  useEffect(() => { fetchLegends().finally(() => setLoading(false)); }, [fetchLegends]);

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

  const totalPages = Math.max(1, Math.ceil(legends.length / pageSize));
  const pagedLegends = legends.slice((page - 1) * pageSize, page * pageSize);

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
        <Link
          href="/legends/new"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: '13px', fontWeight: '500', textDecoration: 'none', cursor: 'pointer' }}
        >
          <Plus size={15} weight="bold" />
          New Legend
        </Link>
      </div>

      {error && (
        <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>{error}</p>
      )}

      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>Legends</h2>
          {!loading && <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{legends.length} legend{legends.length !== 1 ? 's' : ''}</span>}
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--foreground-muted)' }}>
            <Spinner /><span style={{ marginLeft: '8px', fontSize: '14px' }}>Loading…</span>
          </div>
        ) : legends.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', textAlign: 'center' }}>
            <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>No legends yet. Create one to get started.</p>
            <Link href="/legends/new" style={{ marginTop: '12px', fontSize: '14px', color: 'var(--accent)', textDecoration: 'none' }}>Create a legend →</Link>
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
                {pagedLegends.map(legend => (
                  <tr key={legend.id} style={{ borderTop: '1px solid var(--border)', transition: 'background 150ms ease-out' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,43,78,0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={tdBase}><span style={{ fontWeight: '500', color: 'var(--foreground)' }}>{legend.name}</span></td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', maxWidth: 320 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{legend.description || '—'}</span>
                    </td>
                    <td style={tdBase}>
                      <span style={{ ...badgeBase, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>{legend.symbol_count ?? 0}</span>
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>
                      {legend.created_at ? new Date(legend.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={tdBase}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        <Link
                          href={`/legends/${legend.id}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '12px', fontWeight: '500', color: '#fff', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #002B4E', background: '#002B4E', textDecoration: 'none' }}
                        >
                          <PencilSimple size={13} weight="bold" /> Edit
                        </Link>
                        <button
                          onClick={() => handleDelete(legend)}
                          disabled={deletingId === legend.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '12px', fontWeight: '500', color: '#fff', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #A65A55', background: '#A65A55', cursor: 'pointer', opacity: deletingId === legend.id ? 0.4 : 1 }}
                        >
                          <Trash size={13} weight="bold" />
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

        {/* Pagination — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={paginBtn(page === 1)}>
            <CaretLeft size={12} weight="bold" /> Prev
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Show</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={{ padding: '2px 6px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer' }}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong> · {legends.length} total
            </span>
          </div>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={paginBtn(page === totalPages)}>
            Next <CaretRight size={12} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
