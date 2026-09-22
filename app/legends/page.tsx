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
  is_builtin: boolean;
  standard_code: string | null;
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
  fontSize: '11px',
  fontWeight: '600',
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

function StandardBadge({ code }: { code: string | null }) {
  if (!code) return null;
  const label =
    code === 'ISA_5_1' ? 'ISA 5.1' :
    code === 'ISO_10628_2' ? 'ISO 10628-2' :
    code === 'COMBINED' ? 'ISA + ISO' : code;

  const color =
    code === 'ISA_5_1' ? '#1d6fa8' :
    code === 'ISO_10628_2' ? '#2e7d32' :
    code === 'COMBINED' ? '#6a1b9a' : '#555';

  const bg =
    code === 'ISA_5_1' ? '#e3f2fd' :
    code === 'ISO_10628_2' ? '#e8f5e9' :
    code === 'COMBINED' ? '#f3e5f5' : '#f0f0f0';

  return (
    <span style={{ ...badgeBase, background: bg, color, border: `1px solid ${color}22` }}>
      {label}
    </span>
  );
}

function BuiltinBadge() {
  return (
    <span style={{
      ...badgeBase,
      background: '#fff8e1',
      color: '#f57f17',
      border: '1px solid #ffe08222',
      gap: '3px',
    }}>
      <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      Built-in
    </span>
  );
}

function LegendTable({
  legends,
  isBuiltin,
  deletingId,
  onDelete,
}: {
  legends: Legend[];
  isBuiltin: boolean;
  deletingId: string | null;
  onDelete: (legend: Legend) => void;
}) {
  if (legends.length === 0) return (
    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '14px' }}>
      No legends yet.
    </div>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
        <thead style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Standard</th>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>Symbols</th>
            <th style={thStyle}>Created</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {legends.map(legend => (
            <tr
              key={legend.id}
              style={{ borderTop: '1px solid var(--border)', transition: 'background 150ms ease-out' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 43, 78, 0.04)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <td style={tdBase}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: '500', color: 'var(--foreground)' }}>{legend.name}</span>
                  {legend.is_builtin && <BuiltinBadge />}
                </div>
              </td>
              <td style={tdBase}>
                {legend.standard_code
                  ? <StandardBadge code={legend.standard_code} />
                  : <span style={{ color: 'var(--foreground-muted)', fontSize: '12px' }}>Custom</span>
                }
              </td>
              <td style={{ ...tdBase, color: 'var(--foreground-muted)', maxWidth: 280 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {legend.description || '—'}
                </span>
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
                    style={{
                      fontSize: '12px', fontWeight: '500',
                      color: 'var(--foreground)', padding: '5px 10px',
                      borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                      background: 'var(--surface)', textDecoration: 'none',
                    }}
                  >
                    {isBuiltin ? 'View' : 'Edit'}
                  </Link>
                  {!isBuiltin && (
                    <button
                      onClick={() => onDelete(legend)}
                      disabled={deletingId === legend.id}
                      style={{
                        fontSize: '12px', fontWeight: '500',
                        color: 'var(--danger)', padding: '5px 10px',
                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--danger-soft)',
                        background: 'var(--danger-soft)', cursor: 'pointer',
                        opacity: deletingId === legend.id ? 0.4 : 1,
                      }}
                    >
                      {deletingId === legend.id ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Delete failed');
      } else {
        await fetchLegends();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const builtinLegends = legends.filter(l => l.is_builtin);
  const customLegends = legends.filter(l => !l.is_builtin);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
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

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: 'var(--foreground-muted)' }}>
          <Spinner />
          <span style={{ marginLeft: '8px', fontSize: '14px' }}>Loading…</span>
        </div>
      ) : (
        <>
          {/* Built-in Standards */}
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ color: '#f57f17' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>
                  Built-in Industry Standards
                </h2>
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '999px', padding: '1px 8px' }}>
                  Read-only
                </span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                {builtinLegends.length} standard{builtinLegends.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Info banner */}
            <div style={{ padding: '10px 16px', background: '#e3f2fd22', borderBottom: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <svg width="14" height="14" fill="none" stroke="#1d6fa8" strokeWidth={2} viewBox="0 0 24 24" style={{ marginTop: 1, flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0, lineHeight: 1.5 }}>
                These legends are automatically recognized by the AI detection engine. Selecting ISA 5.1, ISO 10628-2, or the Combined standard enables standard-compliant naming and tag pattern recognition.
                Built-in legends cannot be edited or deleted.
              </p>
            </div>

            {builtinLegends.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '0 0 8px' }}>
                  Built-in standards not seeded yet.
                </p>
                <code style={{ fontSize: '12px', background: 'var(--surface-muted)', padding: '4px 8px', borderRadius: 4 }}>
                  npm run seed:standards
                </code>
              </div>
            ) : (
              <LegendTable
                legends={builtinLegends}
                isBuiltin
                deletingId={deletingId}
                onDelete={handleDelete}
              />
            )}
          </div>

          {/* Custom Legends */}
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>
                Custom Legends
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                {customLegends.length} legend{customLegends.length !== 1 ? 's' : ''}
              </span>
            </div>

            {customLegends.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', textAlign: 'center' }}>
                <svg style={{ width: 36, height: 36, color: 'var(--border-strong)', marginBottom: '12px' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>No custom legends yet.</p>
                <Link href="/legends/new" style={{ marginTop: '10px', fontSize: '13px', color: 'var(--accent)', textDecoration: 'none' }}>
                  Create a custom legend →
                </Link>
              </div>
            ) : (
              <LegendTable
                legends={customLegends}
                isBuiltin={false}
                deletingId={deletingId}
                onDelete={handleDelete}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
