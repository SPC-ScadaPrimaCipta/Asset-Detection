'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from './ThemeProvider';
import { Sun, Moon, Laptop } from 'lucide-react';

interface ThemeToggleProps {
  variant?: 'button' | 'dropdown';
  className?: string;
}

export default function ThemeToggle({ variant = 'button', className = '' }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        title={`Current mode: ${theme} (${resolvedTheme}). Click to toggle.`}
        aria-label="Toggle dark and light mode"
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
          transition: 'all 150ms ease-out',
          boxShadow: 'var(--shadow-card)',
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
        {resolvedTheme === 'dark' ? (
          <Moon size={18} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
        ) : (
          <Sun size={18} strokeWidth={1.75} style={{ color: 'var(--primary)' }} />
        )}
      </button>
    );
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }} className={className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          height: 40,
          borderRadius: 'var(--radius-button, 10px)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 150ms ease-out',
        }}
      >
        {resolvedTheme === 'dark' ? (
          <Moon size={16} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
        ) : (
          <Sun size={16} strokeWidth={1.75} style={{ color: 'var(--primary)' }} />
        )}
        <span style={{ textTransform: 'capitalize' }}>{theme}</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            bottom: '100%',
            marginBottom: 8,
            left: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-button, 10px)',
            boxShadow: 'var(--shadow-card)',
            padding: 4,
            minWidth: 120,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <button
            type="button"
            onClick={() => { setTheme('light'); setOpen(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              background: theme === 'light' ? 'var(--primary-soft)' : 'transparent',
              color: theme === 'light' ? 'var(--primary)' : 'var(--text-primary)',
              border: 'none',
              fontSize: 12,
              fontWeight: theme === 'light' ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <Sun size={14} /> Light
          </button>
          <button
            type="button"
            onClick={() => { setTheme('dark'); setOpen(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              background: theme === 'dark' ? 'var(--primary-soft)' : 'transparent',
              color: theme === 'dark' ? 'var(--primary)' : 'var(--text-primary)',
              border: 'none',
              fontSize: 12,
              fontWeight: theme === 'dark' ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <Moon size={14} /> Dark
          </button>
          <button
            type="button"
            onClick={() => { setTheme('system'); setOpen(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              background: theme === 'system' ? 'var(--primary-soft)' : 'transparent',
              color: theme === 'system' ? 'var(--primary)' : 'var(--text-primary)',
              border: 'none',
              fontSize: 12,
              fontWeight: theme === 'system' ? 600 : 400,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <Laptop size={14} /> System
          </button>
        </div>
      )}
    </div>
  );
}
