'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight, Lock, Mail, AlertCircle, Info } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('notice') === 'registration_disabled' || params.get('notice') === 'contact_admin') {
        setNotice('Pendaftaran mandiri dinonaktifkan. Akun baru dikelola langsung oleh Super Administrator.');
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login gagal');
      }

      // Redirect to dashboard
      window.location.href = '/';

    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '80vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg, 14px)',
          padding: '32px 28px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: 'transparent',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'none',
              marginBottom: 12,
            }}
          >
            <img src="/logo.svg" alt="TagFlow Logo" width={52} height={52} style={{ width: 52, height: 52, borderRadius: 14, boxShadow: '0 6px 18px rgba(52, 81, 209, 0.25)', display: 'block' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', margin: '0 0 6px' }}>
            Masuk ke TagFlow
          </h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: 0 }}>
            AI Asset Detection Intelligence
          </p>
        </div>

        {/* Notice message */}
        {notice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(52, 81, 209, 0.08)',
              border: '1px solid rgba(52, 81, 209, 0.25)',
              color: 'var(--primary, #3451D1)',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md, 8px)',
              fontSize: 13,
              marginBottom: 16,
              lineHeight: 1.4,
            }}
          >
            <Info size={16} style={{ flexShrink: 0 }} />
            <span>{notice}</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--danger-soft, #FEF2F2)',
              border: '1px solid var(--danger, #EF4444)',
              color: 'var(--danger, #DC2626)',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md, 8px)',
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Email */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--foreground)',
                marginBottom: 6,
              }}
            >
              Email
            </label>
            <div style={{ position: 'relative' }}>
              <Mail
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
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.com"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 12px 0 36px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-muted, #F8FAFC)',
                  color: 'var(--foreground)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--foreground)',
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
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
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 12px 0 36px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-muted, #F8FAFC)',
                  color: 'var(--foreground)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              height: 42,
              borderRadius: 'var(--radius-md, 8px)',
              background: 'var(--primary, #3451D1)',
              color: '#FFFFFF',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 6,
              boxShadow: '0 2px 8px rgba(52, 81, 209, 0.25)',
            }}
          >
            {loading ? (
              <span>Memproses...</span>
            ) : (
              <>
                <span>Masuk</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            paddingTop: 18,
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--foreground-muted)',
            lineHeight: 1.5,
          }}
        >
          Pendaftaran akun baru dikelola terpusat oleh <strong style={{ color: 'var(--foreground)' }}>Super Administrator</strong>. Hubungi administrator jika membutuhkan akses.
        </div>
      </div>
    </div>
  );
}
