'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/components/UserContext';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  User as UserIcon,
  Search,
  Filter,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Mail,
  UserCheck,
  ArrowLeft,
  KeyRound,
} from 'lucide-react';

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'USER';
  created_at: string;
  updated_at?: string;
  projects_count: number;
}

export default function UserManagementPage() {
  const router = useRouter();
  const { user: currentUser, loading: userLoading } = useUser();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<ManagedUser | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'SUPERADMIN' | 'ADMIN' | 'USER'>('USER');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (roleFilter) params.set('role', roleFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Gagal memuat pengguna');
      }

      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat memuat data pengguna');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    if (!userLoading && currentUser?.role === 'SUPERADMIN') {
      fetchUsers();
    }
  }, [userLoading, currentUser, fetchUsers]);

  // Open Add Modal
  const openAddModal = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('USER');
    setFormError(null);
    setIsAddOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (u: ManagedUser) => {
    setEditingUser(u);
    setFormName(u.name);
    setFormEmail(u.email);
    setFormPassword(''); // blank unless changing
    setFormRole(u.role);
    setFormError(null);
  };

  // Handle Add Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim() || !formPassword) return;

    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          role: formRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menambahkan pengguna');

      setIsAddOpen(false);
      setSuccess(`Pengguna ${data.user.name} berhasil ditambahkan!`);
      setTimeout(() => setSuccess(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'Terjadi kesalahan saat menambahkan pengguna');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setFormSubmitting(true);
    setFormError(null);

    try {
      const payload: any = {
        name: formName.trim(),
        email: formEmail.trim(),
        role: formRole,
      };
      if (formPassword.trim()) {
        payload.password = formPassword.trim();
      }

      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memperbarui pengguna');

      setEditingUser(null);
      setSuccess(`Data pengguna ${data.user.name} berhasil diperbarui!`);
      setTimeout(() => setSuccess(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'Terjadi kesalahan saat memperbarui pengguna');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Delete User
  const handleDeleteConfirm = async () => {
    if (!deletingUser) return;
    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch(`/api/admin/users/${deletingUser.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus pengguna');

      setDeletingUser(null);
      setSuccess(`Pengguna ${deletingUser.name} berhasil dihapus.`);
      setTimeout(() => setSuccess(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'Gagal menghapus pengguna');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Not authorized screen
  if (!userLoading && currentUser?.role !== 'SUPERADMIN') {
    return (
      <div
        style={{
          padding: '60px 24px',
          maxWidth: 600,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'rgba(239, 68, 68, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            color: 'var(--danger, #DC2626)',
          }}
        >
          <AlertTriangle size={28} />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: 'var(--foreground)' }}>
          Akses Ditolak
        </h2>
        <p style={{ fontSize: 14, color: 'var(--foreground-muted)', margin: '0 0 24px', lineHeight: 1.5 }}>
          Halaman Manajemen Pengguna hanya dapat diakses oleh akun dengan peran <strong>Super Administrator</strong>.
        </p>
        <button
          onClick={() => router.push('/')}
          style={{
            padding: '10px 20px',
            borderRadius: 'var(--radius-button, 10px)',
            background: 'var(--primary, #3451D1)',
            color: '#FFFFFF',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ArrowLeft size={16} />
          <span>Kembali ke Dashboard</span>
        </button>
      </div>
    );
  }

  // Count metrics
  const totalCount = users.length;
  const superAdminCount = users.filter((u) => u.role === 'SUPERADMIN').length;
  const adminCount = users.filter((u) => u.role === 'ADMIN').length;
  const standardCount = users.filter((u) => u.role === 'USER').length;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* Top Banner / Alerts */}
      {success && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#059669',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md, 8px)',
            marginBottom: 20,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#DC2626',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md, 8px)',
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--foreground)',
              margin: '0 0 4px',
              letterSpacing: '-0.02em',
            }}
          >
            User Management
          </h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: 0 }}>
            Kelola akses akun, penambahan pengguna, dan penetapan peran sistem secara terpusat.
          </p>
        </div>

        <button
          onClick={openAddModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 'var(--radius-button, 10px)',
            background: 'var(--primary, #3451D1)',
            color: '#FFFFFF',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(52, 81, 209, 0.25)',
          }}
        >
          <UserPlus size={16} />
          <span>Tambah Pengguna</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card, 14px)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: 'rgba(52, 81, 209, 0.1)',
              color: 'var(--primary, #3451D1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Users size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', fontWeight: 500 }}>
              Total Pengguna
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)' }}>
              {totalCount}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card, 14px)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: 'rgba(147, 51, 234, 0.1)',
              color: '#9333EA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', fontWeight: 500 }}>
              Super Administrator
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#9333EA' }}>
              {superAdminCount}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card, 14px)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: 'rgba(37, 99, 235, 0.1)',
              color: '#2563EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shield size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', fontWeight: 500 }}>
              Administrator
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#2563EB' }}>
              {adminCount}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card, 14px)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: 'rgba(100, 116, 139, 0.1)',
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UserIcon size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', fontWeight: 500 }}>
              Standard User
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)' }}>
              {standardCount}
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card, 14px)',
          padding: '16px',
          marginBottom: 20,
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--foreground-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Cari nama atau email pengguna..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                height: 40,
                padding: '0 12px 0 38px',
                borderRadius: 'var(--radius-input, 10px)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--foreground)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Filter size={16} style={{ color: 'var(--foreground-muted)' }} />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{
              height: 40,
              padding: '0 14px',
              borderRadius: 'var(--radius-input, 10px)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--foreground)',
              fontSize: 13,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">Semua Peran (Role)</option>
            <option value="SUPERADMIN">Super Administrator</option>
            <option value="ADMIN">Administrator</option>
            <option value="USER">Standard User</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card, 14px)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card, 0 4px 16px rgba(0, 0, 0, 0.04))',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-2, #F8FAFC)',
                  color: 'var(--foreground-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <th style={{ padding: '14px 18px', width: 50 }}>No</th>
                <th style={{ padding: '14px 18px' }}>Pengguna</th>
                <th style={{ padding: '14px 18px' }}>Peran (Role)</th>
                <th style={{ padding: '14px 18px' }}>Project Dimiliki</th>
                <th style={{ padding: '14px 18px' }}>Tanggal Dibuat</th>
                <th style={{ padding: '14px 18px', textAlign: 'right' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          border: '3px solid var(--border)',
                          borderTopColor: 'var(--primary)',
                          animation: 'spin 1s linear infinite',
                        }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>Memuat data pengguna...</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--foreground-muted)' }}>
                    Tidak ada pengguna ditemukan.
                  </td>
                </tr>
              ) : (
                users.map((u, idx) => {
                  const isCurrent = currentUser?.id === u.id;
                  const initial = u.name.charAt(0).toUpperCase();

                  let roleBadgeStyle: React.CSSProperties = {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.02em',
                  };

                  if (u.role === 'SUPERADMIN') {
                    roleBadgeStyle = {
                      ...roleBadgeStyle,
                      background: 'rgba(147, 51, 234, 0.12)',
                      color: '#9333EA',
                      border: '1px solid rgba(147, 51, 234, 0.25)',
                    };
                  } else if (u.role === 'ADMIN') {
                    roleBadgeStyle = {
                      ...roleBadgeStyle,
                      background: 'rgba(37, 99, 235, 0.12)',
                      color: '#2563EB',
                      border: '1px solid rgba(37, 99, 235, 0.25)',
                    };
                  } else {
                    roleBadgeStyle = {
                      ...roleBadgeStyle,
                      background: 'rgba(100, 116, 139, 0.12)',
                      color: '#475569',
                      border: '1px solid rgba(100, 116, 139, 0.25)',
                    };
                  }

                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background-color 150ms ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--surface-2, #F8FAFC)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <td style={{ padding: '14px 18px', color: 'var(--foreground-muted)' }}>{idx + 1}</td>
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: '50%',
                              background: u.role === 'SUPERADMIN' ? '#9333EA' : 'var(--primary, #3451D1)',
                              color: '#FFFFFF',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: 13,
                              flexShrink: 0,
                            }}
                          >
                            {initial}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{u.name}</span>
                              {isCurrent && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    background: 'rgba(52, 81, 209, 0.12)',
                                    color: 'var(--primary, #3451D1)',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    fontWeight: 700,
                                  }}
                                >
                                  Akun Anda
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <span style={roleBadgeStyle}>
                          {u.role === 'SUPERADMIN' && <ShieldCheck size={13} />}
                          {u.role === 'ADMIN' && <Shield size={13} />}
                          {u.role === 'USER' && <UserIcon size={13} />}
                          <span>{u.role === 'SUPERADMIN' ? 'Super Admin' : u.role === 'ADMIN' ? 'Administrator' : 'User'}</span>
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', color: 'var(--foreground)' }}>
                        <span style={{ fontWeight: 600 }}>{u.projects_count}</span>{' '}
                        <span style={{ color: 'var(--foreground-muted)', fontSize: 12 }}>proyek</span>
                      </td>
                      <td style={{ padding: '14px 18px', color: 'var(--foreground-muted)', fontSize: 12 }}>
                        {new Date(u.created_at).toLocaleDateString('id-ID', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            onClick={() => openEditModal(u)}
                            title="Edit Pengguna"
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              padding: '6px 8px',
                              cursor: 'pointer',
                              color: 'var(--foreground)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                            }}
                          >
                            <Pencil size={13} />
                            <span>Edit</span>
                          </button>

                          <button
                            onClick={() => {
                              setFormError(null);
                              setDeletingUser(u);
                            }}
                            disabled={isCurrent}
                            title={isCurrent ? 'Tidak dapat menghapus akun sendiri' : 'Hapus Pengguna'}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              padding: '6px 8px',
                              cursor: isCurrent ? 'not-allowed' : 'pointer',
                              color: isCurrent ? 'var(--foreground-muted)' : 'var(--danger, #DC2626)',
                              opacity: isCurrent ? 0.4 : 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                            }}
                          >
                            <Trash2 size={13} />
                            <span>Hapus</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {isAddOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card, 16px)',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(52, 81, 209, 0.1)',
                    color: 'var(--primary, #3451D1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <UserPlus size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>
                    Tambah Pengguna Baru
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
                    Akun akan langsung aktif dan dapat login.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--foreground-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#DC2626',
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  placeholder="cth. Budi Pratama"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Alamat Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="budi@perusahaan.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Password Awal
                </label>
                <input
                  type="password"
                  required
                  placeholder="Minimal 6 karakter"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Peran (Role)
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as any)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="USER">Standard User (Hanya project milik sendiri & deteksi)</option>
                  <option value="ADMIN">Administrator (Akses project, legend, dan AI settings)</option>
                  <option value="SUPERADMIN">Super Administrator (Akses penuh + CRUD Pengguna)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    background: 'var(--primary, #3451D1)',
                    border: 'none',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: formSubmitting ? 'not-allowed' : 'pointer',
                    opacity: formSubmitting ? 0.7 : 1,
                  }}
                >
                  {formSubmitting ? 'Menyimpan...' : 'Simpan Pengguna'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card, 16px)',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(52, 81, 209, 0.1)',
                    color: 'var(--primary, #3451D1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Pencil size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>
                    Edit Data Pengguna
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
                    Ubah profil, email, peran, atau reset password.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setEditingUser(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--foreground-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#DC2626',
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Alamat Email
                </label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Peran (Role)
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as any)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="USER">Standard User (Hanya project milik sendiri & deteksi)</option>
                  <option value="ADMIN">Administrator (Akses project, legend, dan AI settings)</option>
                  <option value="SUPERADMIN">Super Administrator (Akses penuh + CRUD Pengguna)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
                  Ganti Password (Opsional)
                </label>
                <input
                  type="password"
                  placeholder="Biarkan kosong jika tidak ingin mengubah password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-input, 8px)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    background: 'var(--primary, #3451D1)',
                    border: 'none',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: formSubmitting ? 'not-allowed' : 'pointer',
                    opacity: formSubmitting ? 0.7 : 1,
                  }}
                >
                  {formSubmitting ? 'Menyimpan...' : 'Perbarui Pengguna'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {deletingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card, 16px)',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--danger, #DC2626)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Trash2 size={22} />
            </div>

            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>
              Hapus Pengguna?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Apakah Anda yakin ingin menghapus akun <strong style={{ color: 'var(--foreground)' }}>{deletingUser.name}</strong> ({deletingUser.email})? Tindakan ini tidak dapat dibatalkan.
            </p>

            {formError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#DC2626',
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={formSubmitting}
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  background: 'var(--danger, #DC2626)',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: formSubmitting ? 'not-allowed' : 'pointer',
                  opacity: formSubmitting ? 0.7 : 1,
                }}
              >
                {formSubmitting ? 'Menghapus...' : 'Ya, Hapus Pengguna'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
