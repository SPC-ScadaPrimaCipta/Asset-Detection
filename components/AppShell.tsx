'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import SidebarNav from '@/app/sidebar-nav';
import Header from '@/components/Header';
import Breadcrumbs from '@/components/Breadcrumbs';
import { useUser } from '@/components/UserContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const isAuthPage = pathname === '/login' || pathname === '/register';

  if (isAuthPage) {
    return (
      <main
        style={{
          width: '100%',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-app)',
          boxSizing: 'border-box',
          padding: '16px',
        }}
      >
        {children}
      </main>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        background: 'var(--bg-app)',
        boxSizing: 'border-box',
        padding: '16px',
        gap: '20px',
      }}
    >
      {/* Floating Rounded Sidebar */}
      <aside
        style={{
          width: 'var(--sidebar-width, 240px)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          background: 'var(--sidebar-bg)',
          height: 'calc(100vh - 32px)',
          position: 'sticky',
          top: '16px',
          borderRadius: 'var(--radius-sidebar, 24px)',
          overflow: 'hidden',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.22)',
          border: '1px solid var(--border)',
          zIndex: 20,
        }}
      >
        <SidebarNav />
      </aside>

      {/* Main Content Area with Header */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          padding: '8px 12px 16px 0',
          minWidth: 0,
          background: 'transparent',
          boxSizing: 'border-box',
        }}
      >
        <Header operatorName={user?.name || 'Operator'} />
        <Breadcrumbs />
        <div style={{ flex: 1, minWidth: 0, width: '100%' }}>{children}</div>
      </main>
    </div>
  );
}
