'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import SidebarNav from '@/app/sidebar-nav';
import Header from '@/components/Header';
import Breadcrumbs from '@/components/Breadcrumbs';
import ThemeToggle from '@/components/ThemeToggle';
import { useUser } from '@/components/UserContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAuthPage = pathname === '/login';
  const isDashboard = pathname === '/';

  // Close drawer when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close drawer if resized to desktop breakpoint
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle ESC key and lock body scroll when mobile drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileOpen]);

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
      className="app-layout-root"
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
      {/* Floating Rounded Desktop Sidebar */}
      <aside
        className="app-sidebar-desktop"
        style={{
          width: 'var(--sidebar-width, 240px)',
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

      {/* Mobile Drawer & Backdrop - only active and rendered when mobileOpen is true */}
      {mobileOpen && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(4px)',
              zIndex: 998,
              animation: 'fadeInBackdrop 180ms ease-out',
            }}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
            style={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              left: 0,
              width: '280px',
              maxWidth: '85vw',
              zIndex: 999,
              background: 'var(--sidebar-bg)',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              animation: 'slideInDrawer 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <SidebarNav onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* Main Content Area */}
      <main
        className="app-main-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 'calc(100vh - 32px)',
          overflow: 'visible',
          padding: '8px 12px 16px 0',
          minWidth: 0,
          background: 'transparent',
          boxSizing: 'border-box',
        }}
      >
        {isDashboard ? (
          <Header
            operatorName={user?.name || 'Operator'}
            onMenuToggle={() => setMobileOpen(true)}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
              flexWrap: 'wrap',
              gap: 12,
              minHeight: 44,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open Navigation Menu"
                className="mobile-menu-btn"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-button, 10px)',
                  background: 'var(--surface, #FFFFFF)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Menu size={20} />
              </button>
              <Breadcrumbs style={{ marginBottom: 0 }} />
            </div>
            <ThemeToggle />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, width: '100%' }}>{children}</div>
      </main>
    </div>
  );
}
