'use client';

import React from 'react';
import Link from 'next/link';
import { FileText, ChevronRight, MoreVertical, FileCode, Layers } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui';

export interface DocumentItem {
  id: string;
  filename: string;
  page_count?: number;
  created_at?: string;
  status?: string;
  file_type?: string;
}

interface RecentDocumentsListProps {
  documents?: DocumentItem[];
  loading?: boolean;
}

const PASTEL_COLORS = [
  { bg: 'var(--pastel-blue, #E3ECFF)', color: '#3451D1' },
  { bg: 'var(--pastel-orange, #FFE9D6)', color: '#E06A26' },
  { bg: 'var(--pastel-green, #E3F7EE)', color: '#1B8755' },
  { bg: 'var(--pastel-purple, #FFE4E4)', color: '#D13451' },
  { bg: 'var(--pastel-cyan, #DDF4FA)', color: '#0F7C99' },
];

export default function RecentDocumentsList({ documents = [], loading = false }: RecentDocumentsListProps) {
  const displayDocs = documents.slice(0, 5);

  return (
    <Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        title="Recent Documents"
        action={
          <Link
            href="/documents"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--primary)',
              textDecoration: 'none',
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--primary-soft)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            View All <ChevronRight size={12} />
          </Link>
        }
      />

      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: 13 }}>
            Loading documents...
          </div>
        ) : displayDocs.length === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--foreground-muted)',
              fontSize: 13,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--foreground-subtle)',
              }}
            >
              <FileText size={20} />
            </div>
            <span>No documents uploaded yet.</span>
            <Link href="/documents" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600, fontSize: 12 }}>
              + Upload your first P&ID
            </Link>
          </div>
        ) : (
          displayDocs.map((doc, idx) => {
            const pastel = PASTEL_COLORS[idx % PASTEL_COLORS.length];
            const isDxf = doc.filename.toLowerCase().endsWith('.dxf');
            const pageText = isDxf ? 'DXF Drawing' : `${doc.page_count ?? 1} Page${(doc.page_count ?? 1) > 1 ? 's' : ''}`;

            return (
              <Link
                key={doc.id}
                href={`/documents`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 12,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background-color 150ms ease, transform 150ms ease',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {/* 44x44 Pastel Thumbnail */}
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: pastel.bg,
                    color: pastel.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {isDxf ? <FileCode size={20} /> : <FileText size={20} />}
                </div>

                {/* Name & Page metadata */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={doc.filename}
                  >
                    {doc.filename}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--foreground-muted)',
                      marginTop: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{pageText}</span>
                    {doc.status && (
                      <>
                        <span>•</span>
                        <span
                          style={{
                            color: doc.status === 'READY' ? 'var(--success)' : 'var(--foreground-muted)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {doc.status.toLowerCase()}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Chevron */}
                <div style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>
                  <ChevronRight size={16} />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </Card>
  );
}
