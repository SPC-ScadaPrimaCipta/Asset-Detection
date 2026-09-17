'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
  border: '1px solid var(--primary)',
  background: 'var(--primary)',
  color: 'var(--surface)',
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
              style={creating || !newName.trim() ? { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' } : buttonStyle}
            >
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
              projects.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: '500', color: 'var(--foreground)' }}>{p.name}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--foreground-muted)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <Link
                      href={`/detection?project_id=${p.id}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--primary-soft)',
                        color: 'var(--primary)',
                        fontWeight: '500',
                        textDecoration: 'none',
                        transition: 'all 150ms ease-out',
                      }}
                    >
                      Open Detection
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
