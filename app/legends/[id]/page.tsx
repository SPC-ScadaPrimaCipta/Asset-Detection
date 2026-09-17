'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Legend {
  id: string;
  name: string;
  description: string;
}

interface LegendSymbol {
  id: string;
  legend_id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  description: string | null;
  aliases: string[] | string | null;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const tdBase: React.CSSProperties = { padding: '10px 12px' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number } = {}) {
  return (
    <svg style={{ width: size, height: size, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function parseAliases(aliases: string[] | string | null): string[] {
  if (!aliases) return [];
  if (Array.isArray(aliases)) return aliases;
  try {
    const parsed = JSON.parse(aliases);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return aliases.split(',').map(a => a.trim()).filter(Boolean);
  }
}

function aliasesToString(aliases: string[] | string | null): string {
  const arr = parseAliases(aliases);
  return arr.join(', ');
}

// ─── Blank symbol form ────────────────────────────────────────────────────────

const blankSymbol = () => ({
  asset_type: '',
  symbol_name: '',
  tag_pattern: '',
  description: '',
  aliases: '',
});

type SymbolFormState = ReturnType<typeof blankSymbol>;

// ─── Inline Edit Row ──────────────────────────────────────────────────────────

function EditRow({
  symbol,
  legendId,
  onSave,
  onCancel,
}: {
  symbol: LegendSymbol;
  legendId: string;
  onSave: (updated: LegendSymbol) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SymbolFormState>({
    asset_type: symbol.asset_type,
    symbol_name: symbol.symbol_name ?? '',
    tag_pattern: symbol.tag_pattern ?? '',
    description: symbol.description ?? '',
    aliases: aliasesToString(symbol.aliases),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.asset_type.trim()) { setError('Asset type is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${symbol.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: form.asset_type.trim(),
          symbol_name: form.symbol_name.trim() || null,
          tag_pattern: form.tag_pattern.trim() || null,
          description: form.description.trim() || null,
          aliases: form.aliases ? form.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Save failed');
      }
      const updated = await res.json();
      onSave(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr style={{ background: 'var(--accent-soft)' }}>
      <td style={tdBase}>
        <input
          value={form.asset_type}
          onChange={e => setForm({ ...form, asset_type: e.target.value })}
          placeholder="Asset Type *"
          style={{ ...inputStyle, padding: '4px 8px', fontSize: '12px' }}
        />
      </td>
      <td style={tdBase}>
        <input
          value={form.symbol_name}
          onChange={e => setForm({ ...form, symbol_name: e.target.value })}
          placeholder="Symbol Name"
          style={{ ...inputStyle, padding: '4px 8px', fontSize: '12px' }}
        />
      </td>
      <td style={tdBase}>
        <input
          value={form.tag_pattern}
          onChange={e => setForm({ ...form, tag_pattern: e.target.value })}
          placeholder="P-###"
          style={{ ...inputStyle, padding: '4px 8px', fontSize: '12px' }}
        />
      </td>
      <td style={tdBase}>
        <input
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Description"
          style={{ ...inputStyle, padding: '4px 8px', fontSize: '12px' }}
        />
      </td>
      <td style={tdBase}>
        <input
          value={form.aliases}
          onChange={e => setForm({ ...form, aliases: e.target.value })}
          placeholder="alias1, alias2"
          style={{ ...inputStyle, padding: '4px 8px', fontSize: '12px' }}
        />
      </td>
      <td style={{ ...tdBase, textAlign: 'right' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={primaryButtonStyle}
          >
            {saving && <Spinner size={12} />}
            Save
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
        </div>
        {error && <p style={{ fontSize: '11px', color: 'var(--danger)', margin: '4px 0 0', textAlign: 'right' }}>{error}</p>}
      </td>
    </tr>
  );
}

// ─── Add Symbol Form ──────────────────────────────────────────────────────────

function AddSymbolForm({
  legendId,
  onAdded,
}: {
  legendId: string;
  onAdded: (symbol: LegendSymbol) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SymbolFormState>(blankSymbol());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.asset_type.trim()) { setError('Asset type is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: form.asset_type.trim(),
          symbol_name: form.symbol_name.trim() || null,
          tag_pattern: form.tag_pattern.trim() || null,
          description: form.description.trim() || null,
          aliases: form.aliases ? form.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to add symbol');
      }
      const newSymbol: LegendSymbol = await res.json();
      onAdded(newSymbol);
      setForm(blankSymbol());
      setOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...secondaryButtonStyle, width: '100%', justifyContent: 'center' }}
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add Symbol
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ ...cardStyle, padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>Add Symbol</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); setForm(blankSymbol()); setError(''); }}
          style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer' }}
        >
          ✕ Cancel
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={fieldLabelStyle}>Asset Type *</label>
          <input
            value={form.asset_type}
            onChange={e => setForm({ ...form, asset_type: e.target.value })}
            placeholder="e.g. Control Valve"
            required
            disabled={saving}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={fieldLabelStyle}>Symbol Name</label>
          <input
            value={form.symbol_name}
            onChange={e => setForm({ ...form, symbol_name: e.target.value })}
            placeholder="e.g. CV-GLOBE"
            disabled={saving}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={fieldLabelStyle}>Tag Pattern</label>
          <input
            value={form.tag_pattern}
            onChange={e => setForm({ ...form, tag_pattern: e.target.value })}
            placeholder="e.g. P-###"
            disabled={saving}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={fieldLabelStyle}>Aliases (comma-separated)</label>
          <input
            value={form.aliases}
            onChange={e => setForm({ ...form, aliases: e.target.value })}
            placeholder="alias1, alias2"
            disabled={saving}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={fieldLabelStyle}>Description</label>
        <textarea
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Optional description…"
          rows={2}
          disabled={saving}
          style={{ ...inputStyle, resize: 'none' }}
        />
      </div>

      {error && (
        <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || !form.asset_type.trim()}
        style={{ ...primaryButtonStyle, width: 'fit-content' }}
      >
        {saving && <Spinner />}
        {saving ? 'Adding…' : 'Add Symbol'}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LegendDetailPage() {
  const params = useParams();
  const legendId = params.id as string;

  const [legend, setLegend] = useState<Legend | null>(null);
  const [symbols, setSymbols] = useState<LegendSymbol[]>([]);
  const [loading, setLoading] = useState(true);

  // Legend info edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoSaved, setInfoSaved] = useState(false);

  // Symbol row state
  const [editingSymbolId, setEditingSymbolId] = useState<string | null>(null);
  const [deletingSymbolId, setDeletingSymbolId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/legends/${legendId}`).then(r => r.json()),
      fetch(`/api/legends/${legendId}/symbols`).then(r => r.json()),
    ]).then(([leg, syms]) => {
      setLegend(leg);
      setEditName(leg.name ?? '');
      setEditDescription(leg.description ?? '');
      setSymbols(syms);
      setLoading(false);
    });
  }, [legendId]);

  // ── Save legend info ─────────────────────────────────────────────────────────
  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setSavingInfo(true);
    setInfoError('');
    setInfoSaved(false);
    try {
      const res = await fetch(`/api/legends/${legendId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Save failed');
      }
      const updated = await res.json();
      setLegend(updated);
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2500);
    } catch (err: any) {
      setInfoError(err.message);
    } finally {
      setSavingInfo(false);
    }
  };

  // ── Delete symbol ────────────────────────────────────────────────────────────
  const handleDeleteSymbol = async (symbol: LegendSymbol) => {
    if (!confirm(`Delete symbol "${symbol.asset_type}"?`)) return;
    setDeletingSymbolId(symbol.id);
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${symbol.id}`, { method: 'DELETE' });
      if (res.ok) {
        setSymbols(prev => prev.filter(s => s.id !== symbol.id));
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? 'Delete failed');
      }
    } finally {
      setDeletingSymbolId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '96px 0', color: 'var(--foreground-muted)' }}>
        <Spinner size={24} />
        <span style={{ marginLeft: '12px', fontSize: '14px' }}>Loading…</span>
      </div>
    );
  }

  if (!legend) {
    return (
      <div style={{ padding: '64px 0', textAlign: 'center' }}>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)' }}>Legend not found.</p>
        <Link href="/legends" style={{ fontSize: '14px', color: 'var(--accent)', textDecoration: 'none', marginTop: '12px', display: 'inline-block' }}>← Back to legends</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link
            href="/legends"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--foreground-muted)', textDecoration: 'none' }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Legends
          </Link>
          <span style={{ color: 'var(--foreground-subtle)' }}>/</span>
          <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>{legend.name}</h1>
        </div>
      </div>

      {/* Legend info card */}
      <div style={{ ...cardStyle, padding: '24px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: '0 0 16px' }}>Legend Info</h2>
        <form onSubmit={handleSaveInfo} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={fieldLabelStyle}>Name *</label>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                required
                disabled={savingInfo}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Description</label>
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              rows={2}
              disabled={savingInfo}
              style={{ ...inputStyle, resize: 'none' }}
            />
          </div>

          {infoError && (
            <p style={{ fontSize: '12px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: 0 }}>{infoError}</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="submit"
              disabled={savingInfo || !editName.trim()}
              style={{ ...primaryButtonStyle, opacity: (savingInfo || !editName.trim()) ? 0.4 : 1, cursor: (savingInfo || !editName.trim()) ? 'not-allowed' : 'pointer' }}
            >
              {savingInfo && <Spinner />}
              {savingInfo ? 'Saving…' : 'Save Changes'}
            </button>
            {infoSaved && (
              <span style={{ fontSize: '13px', color: 'var(--success)', fontWeight: '500' }}>✓ Saved</span>
            )}
          </div>
        </form>
      </div>

      {/* Symbols section */}
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>Symbols</h2>
          <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{symbols.length} symbol{symbols.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Add symbol form */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <AddSymbolForm
            legendId={legendId}
            onAdded={sym => setSymbols(prev => [...prev, sym])}
          />
        </div>

        {/* Symbols table */}
        {symbols.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--foreground-muted)' }}>
            <svg style={{ width: 36, height: 36, margin: '0 auto 12px' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
            </svg>
            <p style={{ fontSize: '14px', margin: 0 }}>No symbols yet. Add one above.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th style={thStyle}>Asset Type</th>
                  <th style={thStyle}>Symbol Name</th>
                  <th style={thStyle}>Tag Pattern</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Aliases</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ borderBottom: '1px solid var(--border)' }}>
                {symbols.map(symbol =>
                  editingSymbolId === symbol.id ? (
                    <EditRow
                      key={symbol.id}
                      symbol={symbol}
                      legendId={legendId}
                      onSave={updated => {
                        setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
                        setEditingSymbolId(null);
                      }}
                      onCancel={() => setEditingSymbolId(null)}
                    />
                  ) : (
                    <tr key={symbol.id} style={{ borderTop: '1px solid var(--border)', transition: 'background 150ms ease-out' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0, 43, 78, 0.04)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={tdBase}><span style={{ fontWeight: '500', color: 'var(--foreground)' }}>{symbol.asset_type}</span></td>
                      <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>{symbol.symbol_name ?? '—'}</td>
                      <td style={tdBase}>
                        {symbol.tag_pattern ? <code style={{ fontSize: '12px', background: 'var(--surface-muted)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', color: 'var(--foreground)' }}>{symbol.tag_pattern}</code> : '—'}
                      </td>
                      <td style={{ ...tdBase, color: 'var(--foreground-muted)', maxWidth: 320 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{symbol.description ?? '—'}</span></td>
                      <td style={tdBase}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {parseAliases(symbol.aliases).length > 0 ? (
                            parseAliases(symbol.aliases).map((a, i) => (
                              <span key={i} style={{ fontSize: '11px', background: 'var(--surface-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', color: 'var(--foreground-muted)' }}>
                                {a}
                              </span>
                            ))
                          ) : '—'}
                        </div>
                      </td>
                      <td style={{ ...tdBase, textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <button
                            onClick={() => setEditingSymbolId(symbol.id)}
                            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteSymbol(symbol)}
                            disabled={deletingSymbolId === symbol.id}
                            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--danger-soft)', background: 'var(--danger-soft)', color: 'var(--danger)', cursor: 'pointer', opacity: deletingSymbolId === symbol.id ? 0.4 : 1 }}
                          >
                            {deletingSymbolId === symbol.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
