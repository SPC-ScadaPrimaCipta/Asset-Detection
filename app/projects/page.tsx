'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FolderPlus, ArrowSquareOut, CaretLeft, CaretRight, PencilSimple, Trash, FloppyDisk, X } from '@phosphor-icons/react';

interface Project {
  id: string;
  name: string;
  created_at: string;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '14px',
  fontFamily: 'inherit',
  outline: 'none',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid #0078B8',
  background: '#0078B8',
  color: '#fff',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const tableHeaderStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/projects');
    const data = await r.json();
    setProjects(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!r.ok) {
      const d = await r.json();
      setError(d.error ?? 'Failed to create project');
    } else {
      setNewName('');
      await load();
    }
    setCreating(false);
  };

  const handleEdit = (p: Project) => { setEditingId(p.id); setEditName(p.name); };

  const handleSaveEdit = async () => {
    if (!editName.trim() || !editingId) return;
    setSavingEdit(true);
    const r = await fetch(`/api/projects/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (r.ok) { await load(); setEditingId(null); }
    setSavingEdit(false);
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}"? This will remove all associated documents and detections.`)) return;
    setDeletingId(p.id);
    await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    await load();
    setDeletingId(null);
  };

  return (
    <div style={{ maxWidth: '1440px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', marginBottom: '8px' }}>Projects</h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
          Each project contains documents and detection jobs.
        </p>
      </div>

      {/* Create form */}
      <div style={cardStyle}>
        <div style={{ padding: '20px' }}>
          <h2 style={{ ...tableHeaderStyle, margin: 0, marginBottom: '16px' }}>New Project</h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              style={inputStyle}
              maxLength={120}
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              style={creating || !newName.trim() ? { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 } : { ...buttonStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FolderPlus size={15} weight="bold" />
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
          {error && <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--danger)' }}>{error}</p>}
        </div>
      </div>

      {/* Project list */}
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 16px', ...tableHeaderStyle }}>Project Name</th>
              <th style={{ textAlign: 'left', padding: '12px 16px', ...tableHeaderStyle }}>Created</th>
              <th style={{ textAlign: 'right', padding: '12px 16px', ...tableHeaderStyle }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--foreground-muted)' }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--foreground-muted)' }}>No projects yet. Create one above.</td></tr>
            ) : (
              projects.slice((page - 1) * pageSize, page * pageSize).map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: '500', color: 'var(--foreground)' }}>
                    {editingId === p.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                        autoFocus
                        maxLength={120}
                        style={{ ...inputStyle, fontSize: '13px', padding: '5px 10px' }}
                      />
                    ) : p.name}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--foreground-muted)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {editingId === p.id ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <button
                          onClick={handleSaveEdit}
                          disabled={savingEdit || !editName.trim()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #0078B8', background: '#0078B8', color: '#fff', cursor: savingEdit || !editName.trim() ? 'not-allowed' : 'pointer', opacity: savingEdit || !editName.trim() ? 0.5 : 1, fontWeight: '500', transition: 'all 150ms ease-out' }}
                        >
                          <FloppyDisk size={13} weight="bold" /> {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={savingEdit}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground-muted)', cursor: 'pointer', fontWeight: '500', transition: 'all 150ms ease-out' }}
                        >
                          <X size={13} weight="bold" /> Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <Link
                          href={`/detection?project_id=${p.id}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #0078B8', background: '#0078B8', color: '#fff', fontWeight: '500', textDecoration: 'none', transition: 'all 150ms ease-out' }}
                        >
                          <ArrowSquareOut size={13} weight="bold" /> Open Detection
                        </Link>
                        <button
                          onClick={() => handleEdit(p)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #002B4E', background: '#002B4E', color: '#fff', cursor: 'pointer', fontWeight: '500', transition: 'all 150ms ease-out' }}
                        >
                          <PencilSimple size={13} weight="bold" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={deletingId === p.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid #A65A55', background: '#A65A55', color: '#fff', cursor: deletingId === p.id ? 'not-allowed' : 'pointer', opacity: deletingId === p.id ? 0.5 : 1, fontWeight: '500', transition: 'all 150ms ease-out' }}
                        >
                          <Trash size={13} weight="bold" /> {deletingId === p.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {/* Pagination — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1, color: 'var(--foreground-muted)' }}><CaretLeft size={12} weight="bold" /> Prev</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Show</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={{ padding: '2px 6px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer' }}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Page <strong>{page}</strong> of <strong>{Math.max(1, Math.ceil(projects.length / pageSize))}</strong> · {projects.length} total</span>
          </div>
          <button onClick={() => setPage(p => Math.min(Math.ceil(projects.length / pageSize), p + 1))} disabled={page >= Math.ceil(projects.length / pageSize)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: page >= Math.ceil(projects.length / pageSize) ? 'not-allowed' : 'pointer', opacity: page >= Math.ceil(projects.length / pageSize) ? 0.4 : 1, color: 'var(--foreground-muted)' }}>Next <CaretRight size={12} weight="bold" /></button>
        </div>
      </div>
    </div>
  );
}
