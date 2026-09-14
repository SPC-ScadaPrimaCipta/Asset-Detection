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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
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

  const inputCls =
    'w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400';

  return (
    <>
      <tr className="bg-blue-50/50 dark:bg-blue-900/10">
        <td className="px-3 py-2">
          <input
            value={form.asset_type}
            onChange={e => setForm({ ...form, asset_type: e.target.value })}
            placeholder="Asset Type *"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={form.symbol_name}
            onChange={e => setForm({ ...form, symbol_name: e.target.value })}
            placeholder="Symbol Name"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={form.tag_pattern}
            onChange={e => setForm({ ...form, tag_pattern: e.target.value })}
            placeholder="P-###"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Description"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={form.aliases}
            onChange={e => setForm({ ...form, aliases: e.target.value })}
            placeholder="alias1, alias2"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 transition-colors"
            >
              {saving && <Spinner size={3} />}
              Save
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="text-xs font-medium px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-500 mt-1 text-right">{error}</p>}
        </td>
      </tr>
    </>
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

  const inputCls =
    'w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-sm text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add Symbol
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-3"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Add Symbol</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); setForm(blankSymbol()); setError(''); }}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          ✕ Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Asset Type <span className="text-red-500">*</span>
          </label>
          <input
            value={form.asset_type}
            onChange={e => setForm({ ...form, asset_type: e.target.value })}
            placeholder="e.g. Control Valve"
            required
            disabled={saving}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Symbol Name</label>
          <input
            value={form.symbol_name}
            onChange={e => setForm({ ...form, symbol_name: e.target.value })}
            placeholder="e.g. CV-GLOBE"
            disabled={saving}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Tag Pattern</label>
          <input
            value={form.tag_pattern}
            onChange={e => setForm({ ...form, tag_pattern: e.target.value })}
            placeholder="e.g. P-###"
            disabled={saving}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Aliases</label>
          <input
            value={form.aliases}
            onChange={e => setForm({ ...form, aliases: e.target.value })}
            placeholder="alias1, alias2"
            disabled={saving}
            className={inputCls}
          />
          <p className="text-xs text-zinc-400">Comma-separated</p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Description</label>
        <textarea
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Optional description…"
          rows={2}
          disabled={saving}
          className={`${inputCls} resize-none`}
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || !form.asset_type.trim()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

  const fetchSymbols = useCallback(async () => {
    const res = await fetch(`/api/legends/${legendId}/symbols`);
    if (res.ok) setSymbols(await res.json());
  }, [legendId]);

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

  const inputCls =
    'w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400">
        <Spinner size={6} />
        <span className="ml-2 text-sm">Loading…</span>
      </div>
    );
  }

  if (!legend) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-zinc-500">Legend not found.</p>
        <Link href="/legends" className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block">← Back to legends</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/legends"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Legends
          </Link>
          <span className="text-zinc-300 dark:text-zinc-600">/</span>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{legend.name}</h1>
        </div>
      </div>

      {/* Legend info card */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">Legend Info</h2>
        <form onSubmit={handleSaveInfo} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                required
                disabled={savingInfo}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Description</label>
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              rows={2}
              disabled={savingInfo}
              className={`${inputCls} resize-none`}
            />
          </div>

          {infoError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">{infoError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingInfo || !editName.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {savingInfo && <Spinner />}
              {savingInfo ? 'Saving…' : 'Save Changes'}
            </button>
            {infoSaved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Saved</span>
            )}
          </div>
        </form>
      </div>

      {/* Symbols section */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Symbols</h2>
          <span className="text-xs text-zinc-400">{symbols.length} symbol{symbols.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Add symbol form */}
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <AddSymbolForm
            legendId={legendId}
            onAdded={sym => setSymbols(prev => [...prev, sym])}
          />
        </div>

        {/* Symbols table */}
        {symbols.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="w-9 h-9 text-zinc-300 dark:text-zinc-600 mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
            </svg>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No symbols yet. Add one below.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700">
                <tr>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Asset Type</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Symbol Name</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Tag Pattern</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Description</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Aliases</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
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
                    <tr key={symbol.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{symbol.asset_type}</span>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-600 dark:text-zinc-400">
                        {symbol.symbol_name ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {symbol.tag_pattern ? (
                          <code className="text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5 rounded font-mono">
                            {symbol.tag_pattern}
                          </code>
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-500 dark:text-zinc-400 max-w-xs">
                        <span className="line-clamp-1">
                          {symbol.description ?? <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {parseAliases(symbol.aliases).length > 0 ? (
                            parseAliases(symbol.aliases).map((a, i) => (
                              <span key={i} className="inline-flex text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-1.5 py-0.5 rounded">
                                {a}
                              </span>
                            ))
                          ) : (
                            <span className="text-zinc-300 dark:text-zinc-600">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setEditingSymbolId(symbol.id)}
                            className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteSymbol(symbol)}
                            disabled={deletingSymbolId === symbol.id}
                            className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 px-2.5 py-1 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
