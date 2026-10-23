'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Bell, Play, Menu } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { Button } from './ui/button';

interface HeaderProps {
  onMenuToggle?: () => void;
  operatorName?: string;
}

export default function Header({
  onMenuToggle,
  operatorName = 'Operator',
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/assets?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        marginBottom: 28,
        flexWrap: 'wrap',
      }}
    >
      {/* Left: Greeting and Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label="Open Navigation Menu"
            className="md:hidden"
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-button, 10px)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Menu size={20} />
          </button>
        )}
        <div>
          <span
            style={{
              fontSize: 14,
              color: 'var(--text-secondary)',
              fontWeight: 500,
              display: 'block',
              lineHeight: 1.2,
            }}
          >
            Welcome Back,
          </span>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: '2px 0 0',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            {operatorName}
          </h1>
        </div>
      </div>

      {/* Right: Actions, Search, Notifications, Theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Action Button: Run Detection */}
        <Link href="/detection" style={{ textDecoration: 'none' }}>
          <Button variant="primary" size="lg" style={{ gap: 8 }}>
            <Play size={16} fill="currentColor" />
            <span>Run Detection</span>
          </Button>
        </Link>

        {/* Search Input */}
        <form onSubmit={handleSearch} style={{ position: 'relative' }}>
          <Search
            size={18}
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Search P&ID, tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              height: 44,
              width: 220,
              padding: '0 14px 0 40px',
              borderRadius: 'var(--radius-input, 10px)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontSize: 14,
              outline: 'none',
              boxShadow: 'var(--shadow-card)',
              transition: 'all 150ms ease-out',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary)';
              e.currentTarget.style.width = '260px';
              e.currentTarget.style.boxShadow = '0 0 0 3px var(--primary-soft)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.width = '220px';
              e.currentTarget.style.boxShadow = 'var(--shadow-card)';
            }}
          />
        </form>

        {/* Notification Bell */}
        <button
          type="button"
          aria-label="Notifications"
          title="Notifications"
          style={{
            position: 'relative',
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-button, 10px)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-card)',
            transition: 'all 150ms ease-out',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--surface-2)';
            e.currentTarget.style.borderColor = 'var(--border-strong)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--surface)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          <Bell size={18} strokeWidth={1.75} />
          <span
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--primary)',
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
        </button>

        {/* Theme Toggle Button */}
        <ThemeToggle />
      </div>
    </header>
  );
}
