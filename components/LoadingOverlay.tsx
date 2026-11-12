'use client';

import React from 'react';
import { Spinner } from '@phosphor-icons/react';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  subMessage?: string;
}

/**
 * Full-screen loading overlay with spinner
 * Used for: legend detection, document upload, MDO enrichment
 */
export function LoadingOverlay({
  isVisible,
  message = 'Processing...',
  subMessage,
}: LoadingOverlayProps) {
  if (!isVisible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-card, 20px)',
          padding: '40px 60px',
          textAlign: 'center',
          boxShadow: 'var(--shadow-xl)',
          animation: 'fadeIn 0.3s ease-in',
        }}
      >
        {/* Spinner */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '20px',
            animation: 'spin 1.5s linear infinite',
          }}
        >
          <Spinner size={48} weight="bold" color="var(--accent)" />
        </div>

        {/* Message */}
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
          {message}
        </h3>

        {/* Sub-message */}
        {subMessage && (
          <p style={{ margin: '0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {subMessage}
          </p>
        )}

        {/* Progress dots */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '6px',
            marginTop: '16px',
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'var(--accent)',
                opacity: 0.6,
                animation: `bounce 1.5s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes bounce {
          0%, 100% { transform: scale(0.8); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
