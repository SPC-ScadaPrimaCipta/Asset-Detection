'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewLegendRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/legends?action=upload');
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: 'var(--foreground-muted)', gap: 8 }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--primary)', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: '14px' }}>Mengarahkan ke form upload legend…</span>
    </div>
  );
}
