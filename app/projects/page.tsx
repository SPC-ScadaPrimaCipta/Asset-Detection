'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FolderPlus,
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  PencilSimple,
  Trash,
  FloppyDisk,
  X,
  ShareNetwork,
  Copy,
  Lock,
  Globe,
  Key,
  Check,
  ArrowClockwise,
} from '@phosphor-icons/react';
import { Card, CardHeader, Button, Input } from '@/components/ui';

interface Project {
  id: string;
  name: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  share_code?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  cloned_from_id?: string | null;
  document_count?: number;
  detection_count?: number;
  created_at: string;
}

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeTab, setActiveTab] = useState<'my' | 'public'>('my');

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newVisibility, setNewVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Clone State
  const [cloningId, setCloningId] = useState<string | null>(null);

  // Share Modal State
  const [shareModalProject, setShareModalProject] = useState<Project | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);

  // Join Code Modal State
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinInputCode, setJoinInputCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinResult, setJoinResult] = useState<any>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Load Current User
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => {
        setCurrentUser(d.user);
        if (!d.user) {
          setActiveTab('public');
        }
      })
      .catch(() => setCurrentUser(null));
  }, []);

  // Load Projects based on Tab
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = activeTab === 'my' ? '/api/projects?filter=my' : '/api/projects?filter=public';
      const r = await fetch(url);
      const data = await r.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setPage(1);
    load();
  }, [load]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || null,
          visibility: newVisibility,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Failed to create project');
      }
      setNewName('');
      setNewDesc('');
      showSuccess('Project created successfully!');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || !editingId) return;
    setSavingEdit(true);
    try {
      const r = await fetch(`/api/projects/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (r.ok) {
        await load();
        setEditingId(null);
        showSuccess('Project name updated!');
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}"? This will remove all associated documents and detections.`)) return;
    setDeletingId(p.id);
    try {
      await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      await load();
      showSuccess('Project deleted.');
    } finally {
      setDeletingId(null);
    }
  };

  // Clone handler
  const handleClone = async (p: Project) => {
    if (!currentUser) {
      router.push('/login');
      return;
    }
    setCloningId(p.id);
    try {
      const res = await fetch(`/api/projects/${p.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clone failed');

      showSuccess(`Project "${p.name}" berhasil di-clone ke Private Workspace Anda!`);
      setActiveTab('my');
      await load();
    } catch (err: any) {
      alert(err.message || 'Gagal meng-clone project');
    } finally {
      setCloningId(null);
    }
  };

  // Share Code generation
  const handleRegenerateShareCode = async (projectId: string) => {
    setRegeneratingCode(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share-code`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.share_code) {
        setShareModalProject((prev) => (prev ? { ...prev, share_code: data.share_code } : null));
        await load();
        showSuccess('New share code generated!');
      }
    } catch {
      alert('Gagal me-generate share code');
    } finally {
      setRegeneratingCode(false);
    }
  };

  // Toggle Project Visibility (Make Public / Make Private)
  const handleToggleVisibility = async (projectId: string, currentVis: 'PUBLIC' | 'PRIVATE') => {
    const nextVis = currentVis === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
    setUpdatingVisibility(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVis }),
      });
      if (res.ok) {
        setShareModalProject((prev) => (prev ? { ...prev, visibility: nextVis } : null));
        await load();
        showSuccess(`Project visibilitas diubah menjadi: ${nextVis}`);
      }
    } catch {
      alert('Gagal mengubah visibilitas project');
    } finally {
      setUpdatingVisibility(false);
    }
  };

  // Handle Join Code submit
  const handleJoinCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInputCode.trim()) return;
    setJoinLoading(true);
    setJoinError(null);
    setJoinResult(null);

    try {
      const res = await fetch('/api/projects/join-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinInputCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kode tidak valid');
      setJoinResult(data);
    } catch (err: any) {
      setJoinError(err.message || 'Gagal mencari project via kode');
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: 'var(--foreground)', marginBottom: '6px' }}>Projects</h1>
          <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
            Kelola ruang kerja proyek P&ID, dokumen analitik, dan batch deteksi aset.
          </p>
        </div>

        {/* Action Header Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setJoinModalOpen(true);
              setJoinInputCode('');
              setJoinError(null);
              setJoinResult(null);
            }}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md, 8px)',
              background: 'var(--surface-muted, #F1F5F9)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Key size={16} weight="bold" />
            <span>Join via Code</span>
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--success-soft, #ECFDF5)',
            border: '1px solid var(--success, #10B981)',
            color: 'var(--success, #059669)',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: '13px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Check size={16} weight="bold" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tabs: My Workspace (Private) vs Public Projects */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        <button
          onClick={() => setActiveTab('my')}
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--radius-md, 8px)',
            background: activeTab === 'my' ? 'var(--primary, #3451D1)' : 'transparent',
            color: activeTab === 'my' ? '#FFFFFF' : 'var(--foreground-muted)',
            border: 'none',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 150ms ease-out',
          }}
        >
          <Lock size={15} weight={activeTab === 'my' ? 'bold' : 'regular'} />
          <span>My Workspace (Private)</span>
        </button>

        <button
          onClick={() => setActiveTab('public')}
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--radius-md, 8px)',
            background: activeTab === 'public' ? 'var(--primary, #3451D1)' : 'transparent',
            color: activeTab === 'public' ? '#FFFFFF' : 'var(--foreground-muted)',
            border: 'none',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 150ms ease-out',
          }}
        >
          <Globe size={15} weight={activeTab === 'public' ? 'bold' : 'regular'} />
          <span>Public Projects</span>
        </button>
      </div>

      {/* Create form (only if user logged in or in My Workspace) */}
      {currentUser && (
        <Card>
          <CardHeader
            title="Create New Project"
            subtitle="Buat ruang kerja proyek baru untuk dokumen P&ID Anda."
          />
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: 12 }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Input
                type="text"
                placeholder="Nama Project, cth. Refinery Unit 04 Upgrade"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
                style={{ flex: 2, minWidth: 260 }}
              />
              <Input
                type="text"
                placeholder="Deskripsi singkat (opsional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={200}
                style={{ flex: 3, minWidth: 260 }}
              />
              <select
                value={newVisibility}
                onChange={(e) => setNewVisibility(e.target.value as any)}
                style={{
                  height: 38,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-muted, #F8FAFC)',
                  color: 'var(--foreground)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="PRIVATE">🔒 Private (Hanya Saya)</option>
                <option value="PUBLIC">🌐 Public (Bisa dilihat semua)</option>
              </select>
              <Button
                type="submit"
                disabled={creating || !newName.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
              >
                <FolderPlus size={16} weight="bold" />
                <span>{creating ? 'Creating…' : 'Create Project'}</span>
              </Button>
            </div>
          </form>
          {error && <p style={{ marginTop: '10px', fontSize: '13px', color: 'var(--danger)', margin: '8px 0 0' }}>{error}</p>}
        </Card>
      )}

      {/* Project list table */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px' }}>
          <CardHeader
            title={activeTab === 'my' ? 'My Private Projects' : 'Public Project Directory'}
            subtitle={
              activeTab === 'my'
                ? 'Proyek-proyek privat di workspace Anda. Anda dapat berbagi via share code atau publish ke public.'
                : 'Proyek publik referensi yang dapat dilihat semua orang. Anda dapat meng-clone proyek ke workspace pribadi Anda.'
            }
          />
        </div>

        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2, #F8FAFC)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Project Name
                </th>
                <th style={{ textAlign: 'left', padding: '14px 20px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Created By
                </th>
                <th style={{ textAlign: 'left', padding: '14px 20px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Scope
                </th>
                <th style={{ textAlign: 'left', padding: '14px 20px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Created
                </th>
                <th style={{ textAlign: 'right', padding: '14px 24px', fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ padding: '36px 24px', textAlign: 'center', color: 'var(--foreground-muted)' }}>
                    Loading projects…
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--foreground-muted)' }}>
                    {activeTab === 'my'
                      ? 'Belum ada project private. Buat project baru di atas atau clone dari Public Projects.'
                      : 'Tidak ada project public.'}
                  </td>
                </tr>
              ) : (
                projects.slice((page - 1) * pageSize, page * pageSize).map((p) => {
                  const isOwner = currentUser && (p.owner_id === currentUser.id || currentUser.role === 'ADMIN' || currentUser.role === 'SUPERADMIN');
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background-color 150ms ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2, #F8FAFC)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {/* Name & Visibility */}
                      <td style={{ padding: '14px 24px', color: 'var(--foreground)' }}>
                        {editingId === p.id ? (
                          <Input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                            maxLength={120}
                            style={{ height: 36, padding: '6px 12px', fontSize: '13px' }}
                          />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 600, fontSize: '14px' }}>{p.name}</span>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  background: p.visibility === 'PUBLIC' ? 'var(--success-soft, #ECFDF5)' : 'var(--surface-muted, #F1F5F9)',
                                  color: p.visibility === 'PUBLIC' ? 'var(--success, #059669)' : 'var(--foreground-muted)',
                                }}
                              >
                                {p.visibility === 'PUBLIC' ? <Globe size={11} /> : <Lock size={11} />}
                                {p.visibility}
                              </span>
                            </div>
                            {p.description && (
                              <span style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>{p.description}</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Created By */}
                      <td style={{ padding: '14px 20px', color: 'var(--foreground)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 500 }}>{p.owner_name || 'Admin / System'}</span>
                          {isOwner && (
                            <span style={{ fontSize: 10, background: 'var(--primary, #3451D1)', color: '#FFFFFF', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                              YOU
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Scope Count */}
                      <td style={{ padding: '14px 20px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                        <span>{p.document_count ?? 0} docs · {p.detection_count ?? 0} assets</span>
                      </td>

                      {/* Created Date */}
                      <td style={{ padding: '14px 20px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                        {editingId === p.id ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <Button
                              onClick={handleSaveEdit}
                              disabled={savingEdit || !editName.trim()}
                              style={{ height: 32, padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <FloppyDisk size={14} weight="bold" /> {savingEdit ? 'Saving…' : 'Save'}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setEditingId(null)}
                              disabled={savingEdit}
                              style={{ height: 32, padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <X size={14} weight="bold" /> Cancel
                            </Button>
                          </div>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <Link href={`/detection?project_id=${p.id}`} style={{ textDecoration: 'none' }}>
                              <Button style={{ height: 32, padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <ArrowSquareOut size={13} weight="bold" /> Detection
                              </Button>
                            </Link>

                            {/* Clone Button (available on Public projects or other's project) */}
                            {(!isOwner || activeTab === 'public') && (
                              <Button
                                variant="secondary"
                                onClick={() => handleClone(p)}
                                disabled={cloningId === p.id}
                                title="Clone project ke private workspace Anda"
                                style={{ height: 32, padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <Copy size={13} weight="bold" />
                                {cloningId === p.id ? 'Cloning…' : 'Clone to Private'}
                              </Button>
                            )}

                            {/* Share button (for Owner) */}
                            {isOwner && (
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setShareModalProject(p);
                                  setCopiedCode(false);
                                }}
                                style={{ height: 32, padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <ShareNetwork size={13} weight="bold" /> Share
                              </Button>
                            )}

                            {isOwner && (
                              <Button
                                variant="secondary"
                                onClick={() => handleEdit(p)}
                                style={{ height: 32, padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <PencilSimple size={13} weight="bold" /> Edit
                              </Button>
                            )}

                            {isOwner && (
                              <button
                                type="button"
                                onClick={() => handleDelete(p)}
                                disabled={deletingId === p.id}
                                style={{
                                  height: 32,
                                  padding: '0 10px',
                                  fontSize: '12px',
                                  borderRadius: 'var(--radius-md, 8px)',
                                  border: '1px solid var(--border)',
                                  background: 'transparent',
                                  color: 'var(--danger)',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <Trash size={13} weight="bold" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {projects.length > pageSize && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, projects.length)} of {projects.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ height: 30, padding: '0 8px' }}>
                <CaretLeft size={14} />
              </Button>
              <Button variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page * pageSize >= projects.length} style={{ height: 30, padding: '0 8px' }}>
                <CaretRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Share Modal */}
      {shareModalProject && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShareModalProject(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg, 14px)',
              padding: '24px',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShareNetwork size={20} style={{ color: 'var(--primary, #3451D1)' }} />
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                  Share Project
                </h3>
              </div>
              <button
                onClick={() => setShareModalProject(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '0 0 16px' }}>
              Proyek: <strong>{shareModalProject.name}</strong>
            </p>

            {/* Option 1: Share Code */}
            <div style={{ background: 'var(--surface-muted, #F8FAFC)', padding: 14, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--foreground-muted)', letterSpacing: '0.04em' }}>
                  1. Share Code
                </span>
                <button
                  type="button"
                  onClick={() => handleRegenerateShareCode(shareModalProject.id)}
                  disabled={regeneratingCode}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 11,
                    color: 'var(--primary, #3451D1)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <ArrowClockwise size={12} />
                  <span>{regeneratingCode ? 'Generating…' : 'Generate Baru'}</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  readOnly
                  value={shareModalProject.share_code || 'Belum ada kode'}
                  style={{
                    flex: 1,
                    height: 38,
                    padding: '0 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    fontFamily: 'monospace',
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: 'var(--foreground)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (shareModalProject.share_code) {
                      navigator.clipboard.writeText(shareModalProject.share_code);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }
                  }}
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 8,
                    background: copiedCode ? 'var(--success, #10B981)' : 'var(--primary, #3451D1)',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {copiedCode ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                  <span>{copiedCode ? 'Tersalin' : 'Salin Kode'}</span>
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: '6px 0 0' }}>
                Rekan Anda dapat memasukkan kode ini melalui tombol <strong>Join via Code</strong> untuk meng-clone proyek ke workspace mereka.
              </p>
            </div>

            {/* Option 2: Jadikan Public / Private */}
            <div style={{ background: 'var(--surface-muted, #F8FAFC)', padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--foreground-muted)', letterSpacing: '0.04em', display: 'block', marginBottom: 8 }}>
                2. Visibilitas Publik
              </span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', display: 'block' }}>
                    Status saat ini: {shareModalProject.visibility === 'PUBLIC' ? '🌐 Public' : '🔒 Private'}
                  </span>
                  <p style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: '2px 0 0' }}>
                    {shareModalProject.visibility === 'PUBLIC'
                      ? 'Proyek ini dapat dilihat oleh semua pengguna pada tab Public Projects.'
                      : 'Hanya Anda yang dapat melihat proyek ini.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleVisibility(shareModalProject.id, shareModalProject.visibility)}
                  disabled={updatingVisibility}
                  style={{
                    height: 36,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: shareModalProject.visibility === 'PUBLIC' ? 'var(--surface)' : 'var(--success, #10B981)',
                    color: shareModalProject.visibility === 'PUBLIC' ? 'var(--foreground)' : '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {updatingVisibility
                    ? 'Updating…'
                    : shareModalProject.visibility === 'PUBLIC'
                    ? 'Ubah ke Private'
                    : 'Jadikan Public'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Join via Code Modal */}
      {joinModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setJoinModalOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg, 14px)',
              padding: '24px',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Key size={20} style={{ color: 'var(--primary, #3451D1)' }} />
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                  Join Project via Share Code
                </h3>
              </div>
              <button
                onClick={() => setJoinModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '0 0 16px' }}>
              Masukkan kode unik yang dibagikan oleh pemilik proyek (contoh: <code>PRJ-A8K2</code>).
            </p>

            <form onSubmit={handleJoinCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                type="text"
                placeholder="cth. PRJ-XXXX"
                value={joinInputCode}
                onChange={(e) => setJoinInputCode(e.target.value.toUpperCase())}
                style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em' }}
                autoFocus
              />
              <Button type="submit" disabled={joinLoading || !joinInputCode.trim()}>
                {joinLoading ? 'Mencari project…' : 'Cari & Buka Project'}
              </Button>
            </form>

            {joinError && (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)', margin: '10px 0 0' }}>{joinError}</p>
            )}

            {joinResult && (
              <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: 'var(--surface-muted, #F8FAFC)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', display: 'block' }}>
                  {joinResult.name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--foreground-muted)', display: 'block', margin: '2px 0 12px' }}>
                  Dibuat oleh: {joinResult.owner_name || 'Admin'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    onClick={async () => {
                      setJoinModalOpen(false);
                      await handleClone({ id: joinResult.id, name: joinResult.name } as any);
                    }}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    Clone ke Workspace Saya
                  </Button>
                  <Link href={`/detection?project_id=${joinResult.id}`} style={{ textDecoration: 'none' }}>
                    <Button variant="secondary" style={{ fontSize: 12 }}>
                      Buka Deteksi
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
