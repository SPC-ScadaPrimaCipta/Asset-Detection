'use client';

import React, { useState, useRef, useEffect } from 'react';
import { CaretDown, Check, X } from '@phosphor-icons/react';

export interface LegendOption {
  id: string;
  name: string;
  description?: string;
}

interface LegendSelectorProps {
  legends: LegendOption[];
  legendIds: string[];
  onChange: (legendIds: string[]) => void;
  disabled?: boolean;
  label?: string;
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '14px',
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  textAlign: 'left',
  userSelect: 'none',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  display: 'block',
  marginBottom: '6px',
};

export function LegendSelector({
  legends,
  legendIds,
  onChange,
  disabled = false,
  label = 'Legends',
}: LegendSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (legendIds.includes(id)) {
      onChange(legendIds.filter((i) => i !== id));
    } else {
      if (legendIds.length >= 3) return; // max 3
      onChange([...legendIds, id]);
    }
  };

  const selectedNames = legendIds
    .map((id) => legends.find((l) => l.id === id)?.name)
    .filter(Boolean) as string[];

  const displayText =
    legendIds.length === 0
      ? 'Auto-detect (No legend)'
      : `${legendIds.length} / 3 selected: ${selectedNames.join(', ')}`;

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: '220px' }} ref={containerRef}>
      <span style={fieldLabelStyle}>
        {label} {legendIds.length > 0 ? `(${legendIds.length}/3)` : '(auto-detect)'}
      </span>
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
            color: legendIds.length === 0 ? 'var(--foreground-muted)' : 'var(--foreground)',
          }}
        >
          {displayText}
        </span>
        <CaretDown size={14} weight="bold" style={{ color: 'var(--foreground-muted)', flexShrink: 0, marginLeft: 8 }} />
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
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          {legends.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--foreground-muted)' }}>
              No legends available
            </div>
          ) : (
            legends.map((l) => {
              const priority = legendIds.indexOf(l.id);
              const selected = priority >= 0;
              const maxReached = !selected && legendIds.length >= 3;

              return (
                <div
                  key={l.id}
                  onClick={() => !maxReached && toggleLegend(l.id)}
                  title={maxReached ? 'Maximum 3 legends per detection job' : `Priority ${priority + 1} of ${legendIds.length}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
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
                    onChange={() => {}} // Handled by parent div click
                    style={{ cursor: maxReached ? 'not-allowed' : 'pointer', accentColor: 'var(--primary)' }}
                  />
                  {selected && (
                    <span
                      style={{
                        minWidth: '20px',
                        height: '20px',
                        borderRadius: '10px',
                        background: priority === 0 ? 'var(--primary)' : 'var(--accent)',
                        color: 'var(--surface)',
                        fontSize: '11px',
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
                      fontSize: '13px',
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
              paddingTop: '6px',
              paddingLeft: '4px',
              fontSize: '11px',
              color: 'var(--foreground-muted)',
              lineHeight: 1.4,
            }}
          >
            {legendIds.length === 0
              ? 'No legend selected — symbols detected without reference.'
              : 'Number = priority. Legend 1 wins symbol conflicts.'}
          </div>
        </div>
      )}
    </div>
  );
}
