'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles, Cpu } from 'lucide-react';
import { Button } from '@/components/ui';

export default function DetectionBanner() {
  return (
    <div
      style={{
        background: 'var(--banner-bg)',
        borderRadius: 'var(--radius-card, 20px)',
        padding: '32px 36px',
        color: '#FFFFFF',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 190,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Background ambient lighting */}
      <div
        style={{
          position: 'absolute',
          top: -30,
          right: 120,
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.15)',
          pointerEvents: 'none',
        }}
      />

      {/* Content */}
      <div style={{ maxWidth: 460, position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.22)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <Sparkles size={12} /> AI Vision v3.5
          </span>
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: '0 0 8px',
            color: '#FFFFFF',
            lineHeight: 1.25,
            letterSpacing: '-0.02em',
          }}
        >
          Automate Your P&ID Asset Extraction
        </h2>
        <p
          style={{
            fontSize: 13,
            color: 'rgba(255, 255, 255, 0.88)',
            margin: '0 0 20px',
            lineHeight: 1.5,
          }}
        >
          Detect engineering symbols, associate equipment tags, and match against custom legend standards automatically.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/detection" style={{ textDecoration: 'none' }}>
            <Button
              variant="secondary"
              size="md"
              style={{
                background: '#FFFFFF',
                color: '#1E2347',
                fontWeight: 600,
                border: 'none',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.12)',
              }}
            >
              <span>Run Detection</span>
              <ArrowRight size={14} />
            </Button>
          </Link>
          <Link href="/documents" style={{ textDecoration: 'none' }}>
            <Button
              variant="ghost"
              size="md"
              style={{
                color: '#FFFFFF',
                border: '1px solid rgba(255, 255, 255, 0.35)',
              }}
            >
              Upload Drawings
            </Button>
          </Link>
        </div>
      </div>

      {/* 3D Visual Decorative Element on Right */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 24,
            background: 'rgba(255, 255, 255, 0.18)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.12)',
            transform: 'rotate(-4deg)',
          }}
        >
          <Cpu size={52} strokeWidth={1.5} style={{ color: '#FFFFFF' }} />
        </div>
      </div>
    </div>
  );
}
