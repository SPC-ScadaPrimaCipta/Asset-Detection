'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const SEGMENT_LABELS: Record<string, string> = {
  projects: 'Projects',
  detection: 'Detection Workspace',
  mdo: 'MDO Flow',
  documents: 'Documents',
  legends: 'Legends',
  new: 'New Legend',
  review: 'Review',
  settings: 'Settings',
  users: 'User Management',
};

function formatSegmentLabel(segment: string, prevSegment?: string): string {
  if (SEGMENT_LABELS[segment.toLowerCase()]) {
    return SEGMENT_LABELS[segment.toLowerCase()];
  }

  // If segment is a UUID or alphanumeric ID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    if (prevSegment === 'legends') return 'Legend Detail';
    if (prevSegment === 'projects') return 'Project Detail';
    if (prevSegment === 'documents') return 'Document Detail';
    return `${segment.slice(0, 8)}...`;
  }

  // Fallback: capitalize words
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function Breadcrumbs({ style }: { style?: React.CSSProperties } = {}) {
  const pathname = usePathname();

  const rawSegments = pathname.split('/').filter(Boolean);

  // Do not show on auth pages or dashboard root
  if (pathname === '/login' || rawSegments.length === 0) {
    return null;
  }

  // Build breadcrumb items
  const items = [
    {
      label: 'Dashboard',
      href: '/',
      isCurrent: false,
    },
  ];

  let accumulatedPath = '';
  rawSegments.forEach((seg, idx) => {
    accumulatedPath += `/${seg}`;
    const prevSeg = idx > 0 ? rawSegments[idx - 1] : undefined;
    items.push({
      label: formatSegmentLabel(seg, prevSeg),
      href: accumulatedPath,
      isCurrent: idx === rawSegments.length - 1,
    });
  });

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '6px',
        fontSize: '12px',
        color: 'var(--foreground-muted)',
        lineHeight: 1,
        ...style,
      }}
    >
      {items.map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={item.href}>
            {!isFirst && (
              <ChevronRight
                size={12}
                style={{
                  color: 'var(--border-strong, #94A3B8)',
                  opacity: 0.7,
                  flexShrink: 0,
                }}
              />
            )}

            {isLast ? (
              <span
                style={{
                  color: 'var(--foreground)',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
                aria-current="page"
              >
                {isFirst && <Home size={13} style={{ opacity: 0.8 }} />}
                <span>{item.label}</span>
              </span>
            ) : (
              <Link
                href={item.href}
                style={{
                  color: 'var(--foreground-muted)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'color 150ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--primary, #3451D1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--foreground-muted)';
                }}
              >
                {isFirst && <Home size={13} style={{ opacity: 0.8 }} />}
                <span>{item.label}</span>
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
