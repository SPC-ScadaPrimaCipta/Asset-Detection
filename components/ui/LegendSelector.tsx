'use client';

import React, { useState, useRef, useEffect } from 'react';
import { CaretDown, Check, X } from '@phosphor-icons/react';

export interface LegendOption {
  id: string;
  name: string;
  description?: string;
}

export interface LegendSelectorProps {
  legends?: LegendOption[];
  legendIds?: string[];
  onChange?: (legendIds: string[] | string | null) => void;
  value?: string | null;
  multiValues?: string[];
  onMultiChange?: (legendIds: string[]) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '12px',
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  textAlign: 'left',
  userSelect: 'none',
  boxSizing: 'border-box',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  display: 'block',
  marginBottom: '4px',
};

export function LegendSelector({
  legends: propLegends,
  legendIds: propLegendIds,
  onChange,
  value,
  multiValues,
  onMultiChange,
  disabled = false,
  label,
  placeholder = 'Select Legend (Auto-detect)',
}: LegendSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalLegends, setInternalLegends] = useState<LegendOption[]>([]);

  // Automatically fetch legends if none were provided via props
  useEffect(() => {
    if (!propLegends || propLegends.length === 0) {
      fetch('/api/legends')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setInternalLegends(
              data.map((l: any) => ({
                id: l.id,
                name: l.name,
                description: l.description,
              }))
            );
          }
        })
        .catch((err) => console.error('[LegendSelector] failed to load legends:', err));
    }
  }, [propLegends]);

  const legends: LegendOption[] = Array.isArray(propLegends) && propLegends.length > 0
    ? propLegends
    : internalLegends;

  // Resolve active legend IDs with full fallback safety
  const activeIds: string[] = Array.isArray(multiValues)
    ? multiValues
    : Array.isArray(propLegendIds)
    ? propLegendIds
    : typeof value === 'string' && value.length > 0
    ? [value]
    : [];

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  const toggleLegend = (id: string) => {
    if (disabled) return;
    let next: string[];
    if (activeIds.includes(id)) {
      next = activeIds.filter((i) => i !== id);
    } else {
      if (activeIds.length >= 3) return; // max 3
      next = [...activeIds, id];
    }

    if (onMultiChange) {
      onMultiChange(next);
    }
    if (onChange) {
      (onChange as any)(next);
      if (next.length === 0) {
        (onChange as any)(null);
      } else {
        (onChange as any)(next[0]);
      }
    }
  };

  const selectedNames = activeIds
    .map((id) => legends.find((l) => l.id === id)?.name)
    .filter(Boolean) as string[];

  const displayText =
    activeIds.length === 0
      ? placeholder
      : `${activeIds.length}/3: ${selectedNames.join(', ')}`;

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: '180px', maxWidth: '260px' }} ref={containerRef}>
      {label && (
        <span style={fieldLabelStyle}>
          {label} {activeIds.length > 0 ? `(${activeIds.length}/3)` : ''}
        </span>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          ...selectStyle,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            color: activeIds.length === 0 ? 'var(--foreground-muted)' : 'var(--foreground)',
          }}
        >
          {displayText}
        </span>
        <CaretDown size={13} weight="bold" style={{ color: 'var(--foreground-muted)', flexShrink: 0, marginLeft: 6 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.15)',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          {legends.length === 0 ? (
            <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
              No legends available
            </div>
          ) : (
            legends.map((l) => {
              const priority = activeIds.indexOf(l.id);
              const selected = priority >= 0;
              const maxReached = !selected && activeIds.length >= 3;

              return (
                <div
                  key={l.id}
                  onClick={() => !maxReached && toggleLegend(l.id)}
                  title={maxReached ? 'Maximum 3 legends per detection job' : selected ? `Priority ${priority + 1} of ${activeIds.length}` : 'Click to select'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: selected ? 'var(--surface-muted)' : 'transparent',
                    cursor: maxReached ? 'not-allowed' : 'pointer',
                    opacity: maxReached ? 0.5 : 1,
                    transition: 'background 100ms ease-out',
                  }}
                  onMouseEnter={(e) => {
                    if (!maxReached) e.currentTarget.style.background = 'var(--surface-muted)';
                  }}
                  onMouseLeave={(e) => {
                    if (!selected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={maxReached}
                    onChange={() => {}} // Handled by parent click
                    style={{ cursor: maxReached ? 'not-allowed' : 'pointer', accentColor: 'var(--primary)' }}
                  />
                  {selected && (
                    <span
                      style={{
                        minWidth: '16px',
                        height: '16px',
                        borderRadius: '8px',
                        background: priority === 0 ? 'var(--primary)' : 'var(--accent)',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {priority + 1}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '12px',
                      color: 'var(--foreground)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {l.name}
                  </span>
                </div>
              );
            })
          )}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              marginTop: '4px',
              paddingTop: '4px',
              paddingLeft: '4px',
              fontSize: '10px',
              color: 'var(--foreground-muted)',
              lineHeight: 1.3,
            }}
          >
            {activeIds.length === 0
              ? 'No legend selected — AI detects standard symbols.'
              : 'Number = priority. Legend 1 wins symbol conflicts.'}
          </div>
        </div>
      )}
    </div>
  );
}
export default LegendSelector;
