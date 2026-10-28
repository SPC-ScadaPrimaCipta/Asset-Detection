'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowLeft, ShieldAlert } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to login with notice
    router.replace('/login?notice=registration_disabled');
  }, [router]);

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
          boxShadow: 'var(--shadow-card, 0 10px 30px rgba(0, 0, 0, 0.08))',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'rgba(52, 81, 209, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            color: 'var(--primary, #3451D1)',
          }}
        >
          <ShieldAlert size={24} />
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--foreground)', margin: '0 0 8px' }}>
          Pendaftaran Mandiri Ditutup
        </h1>
        <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '0 0 24px', lineHeight: 1.5 }}>
          Pembuatan akun pengguna dikontrol langsung oleh Super Administrator. Silakan hubungi admin untuk mendapatkan akses.
        </p>

        <Link
          href="/login"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 42,
            borderRadius: 'var(--radius-input, 10px)',
            background: 'var(--primary, #3451D1)',
            color: '#FFFFFF',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          <ArrowLeft size={16} />
          <span>Kembali ke Halaman Login</span>
        </Link>
      </div>
    </div>
  );
}
