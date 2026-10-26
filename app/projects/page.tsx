'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FolderPlus, ArrowSquareOut, CaretLeft, CaretRight, PencilSimple, Trash, FloppyDisk, X } from '@phosphor-icons/react';
import { Card, CardHeader, Button, Input } from '@/components/ui';

interface Project {
  id: string;
  name: string;
  created_at: string;
}

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
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', marginBottom: '8px' }}>Projects</h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
          Manage your industrial projects, organize documents, and run detection batches.
        </p>
      </div>

      {/* Create form */}
      <Card>
        <CardHeader title="Create New Project" subtitle="Provide a descriptive name for this engineering project." />
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '12px', marginTop: 12 }}>
          <Input
            type="text"
            placeholder="e.g. Refinery Unit 04 Upgrade"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={120}
            style={{ flex: 1 }}
          />
          <Button
            type="submit"
            disabled={creating || !newName.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <FolderPlus size={16} weight="bold" />
            <span>{creating ? 'Creating…' : 'Create Project'}</span>
          </Button>
        </form>
        {error && <p style={{ marginTop: '10px', fontSize: '13px', color: 'var(--danger)', margin: '8px 0 0' }}>{error}</p>}
      </Card>

      {/* Project list */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px' }}>
          <CardHeader title="Project Directory" subtitle="All active project workspaces and documentation repositories." />
        </div>

        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Project Name</th>
                <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Created</th>
                <th style={{ textAlign: 'right', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ padding: '36px 24px', textAlign: 'center', color: 'var(--foreground-muted)' }}>Loading projects…</td></tr>
              ) : projects.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--foreground-muted)' }}>No projects found. Create one above to get started.</td></tr>
              ) : (
                projects.slice((page - 1) * pageSize, page * pageSize).map(p => (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      transition: 'background-color 150ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <td style={{ padding: '14px 24px', fontWeight: '500', color: 'var(--foreground)' }}>
                      {editingId === p.id ? (
                        <Input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                          autoFocus
                          maxLength={120}
                          style={{ height: 38, padding: '6px 12px', fontSize: '13px' }}
                        />
                      ) : p.name}
                    </td>
                    <td style={{ padding: '14px 24px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                      {editingId === p.id ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <Button
                            onClick={handleSaveEdit}
                            disabled={savingEdit || !editName.trim()}
                            style={{ height: 34, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <FloppyDisk size={14} weight="bold" /> {savingEdit ? 'Saving…' : 'Save'}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit}
                            style={{ height: 34, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <X size={14} weight="bold" /> Cancel
                          </Button>
                        </div>
                      ) : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <Link href={`/detection?project_id=${p.id}`} style={{ textDecoration: 'none' }}>
                            <Button style={{ height: 34, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <ArrowSquareOut size={14} weight="bold" /> Detection
                            </Button>
                          </Link>
                          <Button
                            variant="secondary"
                            onClick={() => handleEdit(p)}
                            style={{ height: 34, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <PencilSimple size={14} weight="bold" /> Edit
                          </Button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
                            disabled={deletingId === p.id}
                            style={{
                              height: 34,
                              padding: '0 12px',
                              borderRadius: 'var(--radius-button, 10px)',
                              border: '1px solid var(--danger-soft, #FFE4E4)',
                              background: 'var(--danger-soft, #FFE4E4)',
                              color: 'var(--danger, #D13451)',
                              cursor: deletingId === p.id ? 'not-allowed' : 'pointer',
                              opacity: deletingId === p.id ? 0.5 : 1,
                              fontWeight: 600,
                              fontSize: '12px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              transition: 'all 150ms ease-out',
                            }}
                          >
                            <Trash size={14} weight="bold" /> {deletingId === p.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <Button
            variant="secondary"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ height: 32, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <CaretLeft size={12} weight="bold" /> Prev
          </Button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Show</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={{
                height: 28,
                padding: '2px 8px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--foreground)',
                cursor: 'pointer',
              }}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
              Page <strong>{page}</strong> of <strong>{Math.max(1, Math.ceil(projects.length / pageSize))}</strong> · {projects.length} total
            </span>
          </div>

          <Button
            variant="secondary"
            onClick={() => setPage(p => Math.min(Math.ceil(projects.length / pageSize), p + 1))}
            disabled={page >= Math.ceil(projects.length / pageSize)}
            style={{ height: 32, padding: '0 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            Next <CaretRight size={12} weight="bold" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
