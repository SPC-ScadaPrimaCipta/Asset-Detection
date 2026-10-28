'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  ScanSearch,
  GitFork,
  FileText,
  BookOpen,
  Settings,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

const MENU_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/detection', label: 'Detection', icon: ScanSearch },
  { href: '/mdo', label: 'MDO Flow', icon: GitFork },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/legends', label: 'Legends', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function SidebarNav() {
  const pathname = usePathname();

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
          {/* 3D Cube Icon */}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6CC8F2 0%, #FFFFFF 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              flexShrink: 0,
            }}
          >
            <Sparkles size={20} style={{ color: 'var(--primary, #3451D1)' }} />
          </div>
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
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--sidebar-item-text, #DCE3FF)',
                opacity: 0.8,
                letterSpacing: '0.04em',
                display: 'block',
              }}
            >
              AI Asset Detection Intelligence
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
          {MENU_ITEMS.map(({ href, label, icon: Icon }) => {
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
          Gemini Vision & queue worker active for P&ID extraction.
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
    </div>
  );
}
