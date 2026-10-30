'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/components/UserContext';
import {
  LayoutDashboard,
  FolderKanban,
  ScanSearch,
  GitFork,
  FileText,
  BookOpen,
  BookOpenCheck,
  Settings,
  Sparkles,
  ExternalLink,
  LogOut,
  User as UserIcon,
  Users,
} from 'lucide-react';

const MENU_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/detection', label: 'Detection', icon: ScanSearch },
  { href: '/mdo', label: 'MDO Flow', icon: GitFork },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/legends', label: 'Legends', icon: BookOpen },
  { href: '/guide', label: 'User Guide', icon: BookOpenCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, refreshUser } = useUser();
  const [engineInfo, setEngineInfo] = React.useState<{ provider: string; model: string }>({
    provider: 'AI Engine',
    model: '',
  });

  React.useEffect(() => {
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.ai_provider) {
          const prov = String(data.ai_provider);
          const model =
            prov === 'openai'
              ? data.openai_model
              : prov === 'gemini'
              ? data.gemini_model
              : prov === 'anthropic'
              ? data.anthropic_model
              : data.deepseek_model;
          setEngineInfo({
            provider: prov === 'openai' ? 'OpenAI' : prov.charAt(0).toUpperCase() + prov.slice(1),
            model: model || '',
          });
        }
      })
      .catch(() => {});
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await refreshUser();
      window.location.href = '/login';

    } catch {}
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
        padding: '24px 16px 20px',
        boxSizing: 'border-box',
      }}
    >
      <div>
        {/* Brand / Logo */}
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
            padding: '4px 8px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
            marginBottom: 20,
          }}
        >
          {/* TagFlow Logo */}
          <img
            src="/logo.svg"
            alt="TagFlow Logo"
            width={42}
            height={42}
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
            }}
          />
          <div>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                display: 'block',
              }}
            >
              TagFlow.
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: 'var(--sidebar-item-text, #DCE3FF)',
                opacity: 0.85,
                letterSpacing: '0.01em',
                lineHeight: 1.25,
                display: 'block',
                marginTop: 2,
              }}
            >
              AI Asset Detection<br />Intelligence
            </span>
          </div>
        </Link>

        {/* Group Label */}
        <p
          style={{
            padding: '0 12px 10px',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--sidebar-item-text, #DCE3FF)',
            opacity: 0.65,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: 0,
          }}
        >
          Admin Tools
        </p>

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ...MENU_ITEMS,
            ...(user?.role === 'SUPERADMIN' ? [{ href: '/users', label: 'User Management', icon: Users }] : []),
          ].map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  height: 44,
                  padding: '0 14px',
                  borderRadius: 'var(--radius-button, 10px)',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  transition: 'all 150ms ease-out',
                  color: active
                    ? 'var(--sidebar-item-active-text, #1E2347)'
                    : 'var(--sidebar-item-text, #DCE3FF)',
                  background: active
                    ? 'var(--sidebar-item-active-bg, #FFFFFF)'
                    : 'transparent',
                  boxShadow: active ? '0 4px 12px rgba(0, 0, 0, 0.1)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.color = '#FFFFFF';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--sidebar-item-text, #DCE3FF)';
                  }
                }}
              >
                <Icon
                  size={19}
                  strokeWidth={2}
                  style={{
                    color: active ? 'var(--primary, #3451D1)' : 'currentColor',
                    flexShrink: 0,
                  }}
                />
                <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Support / System Status Box */}
      <div
        style={{
          background: 'var(--sidebar-support-bg, #4A66DE)',
          borderRadius: 14,
          padding: 16,
          color: '#FFFFFF',
          marginTop: 20,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--success, #2FB584)',
              boxShadow: '0 0 8px rgba(47, 181, 132, 0.6)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#FFFFFF' }}>AI Detection Engine</span>
        </div>
        <p style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.85)', margin: '0 0 12px', lineHeight: 1.4 }}>
          {engineInfo.provider} {engineInfo.model ? `(${engineInfo.model})` : ''} & queue worker active for P&ID extraction.
        </p>
        <Link href="/settings" style={{ textDecoration: 'none', display: 'block' }}>
          <button
            type="button"
            style={{
              width: '100%',
              height: 32,
              borderRadius: 8,
              background: 'var(--accent, #6CC8F2)',
              color: '#FFFFFF',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'background-color 150ms ease-out',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#52BDEC';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--accent, #6CC8F2)';
            }}
          >
            <span>Engine Settings</span>
            <ExternalLink size={12} />
          </button>
        </Link>
      </div>

      {/* User Account / Auth Section */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          background: 'rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        {user ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--primary, #3451D1)',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#FFFFFF',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.name}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'rgba(255, 255, 255, 0.65)' }}>
                  {user.role === 'SUPERADMIN' ? 'Super Admin' : user.role === 'ADMIN' ? 'Administrator' : 'User'}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'color 150ms ease-out',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#FFFFFF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              }}
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <Link
            href="/login"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              fontSize: 12,
              fontWeight: 600,
              color: '#FFFFFF',
              textDecoration: 'none',
              padding: '6px 0',
            }}
          >
            <UserIcon size={14} />
            <span>Sign In / Login</span>
          </Link>
        )}
      </div>
    </div>
  );
}
