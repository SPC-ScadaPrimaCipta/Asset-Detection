'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500">Each project contains documents and detection jobs.</p>
        </div>
      </div>

      {/* Create form */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">New Project</h2>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={120}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* Project list */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Project Name</th>
              <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Created</th>
              <th className="text-right px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-zinc-400">Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-zinc-400">No projects yet. Create one above.</td></tr>
            ) : (
              projects.map(p => (
                <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{p.name}</td>
                  <td className="px-4 py-3 text-zinc-500">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/detection?project_id=${p.id}`}
                      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 font-medium"
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
