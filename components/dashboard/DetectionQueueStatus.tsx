'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Cpu, Clock, CheckCircle2, Loader2, FileText, User } from 'lucide-react';
import { Card, CardHeader, Badge } from '@/components/ui';

interface QueueItem {
  id: string;
  documentId: string;
  documentName: string;
  projectId: string | null;
  projectName: string;
  user: {
    id: string | null;
    name: string;
  };
  status: string;
  queuePosition: number;
  createdAt: string;
  waitingSeconds: number;
}

interface ActiveJob {
  id: string;
  documentId: string;
  documentName: string;
  projectId: string | null;
  projectName: string;
  user: {
    id: string | null;
    name: string;
  };
  status: string;
  progressPct: number;
  startedAt: string | null;
  elapsedSeconds: number;
}

interface QueueResponse {
  isBusy: boolean;
  activeJob: ActiveJob | null;
  queue: QueueItem[];
  totalWaiting: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} dtk`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins} mnt ${secs} dtk`;
}

export default function DetectionQueueStatus() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const isBusyRef = useRef(false);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/detection/queue');
      if (res.ok) {
        const json: QueueResponse = await res.json();
        setData(json);
        isBusyRef.current = json.isBusy || (json.queue && json.queue.length > 0);
      }
    } catch (err) {
      console.warn('[DetectionQueueStatus] Polling warning:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();

    // Dynamic polling: 4s when busy, 10s when idle
    let timerId: NodeJS.Timeout;
    const scheduleNext = () => {
      const delay = isBusyRef.current ? 4000 : 10000;
      timerId = setTimeout(async () => {
        await fetchQueue();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => clearTimeout(timerId);
  }, [fetchQueue]);

  if (loading && !data) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--foreground-muted)' }}>
          <Loader2 className="animate-spin" size={16} />
          <span style={{ fontSize: 13 }}>Memuat status antrean AI...</span>
        </div>
      </Card>
    );
  }

  const isBusy = Boolean(data?.isBusy && data?.activeJob);
  const queue = data?.queue ?? [];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: isBusy ? 'rgba(52, 81, 209, 0.1)' : 'rgba(47, 181, 132, 0.1)',
              color: isBusy ? 'var(--primary)' : 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Cpu size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
              AI Detection Engine
            </h3>
            <span style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
              Pemrosesan bertahap (Concurrency = 1)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isBusy ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 999,
                background: 'rgba(52, 81, 209, 0.12)',
                color: 'var(--primary)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--primary)',
                  display: 'inline-block',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              SEDANG MEMPROSES
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 999,
                background: 'rgba(47, 181, 132, 0.12)',
                color: 'var(--success)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <CheckCircle2 size={13} />
              IDLE / READY
            </span>
          )}
        </div>
      </div>

      {/* When Busy: Show Active Job */}
      {isBusy && data?.activeJob && (
        <div
          style={{
            background: 'var(--surface-2)',
            borderRadius: 10,
            padding: 14,
            marginBottom: queue.length > 0 ? 12 : 0,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                  {data.activeJob.documentName}
                </span>
                <span style={{ fontSize: 12, color: 'var(--foreground-muted)', marginLeft: 6 }}>
                  ({data.activeJob.projectName})
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--foreground-muted)' }}>
              <User size={13} />
              <span>
                Diproses oleh: <strong style={{ color: 'var(--foreground)' }}>{data.activeJob.user.name}</strong>
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <div
              style={{
                flex: 1,
                height: 8,
                background: 'var(--surface-muted, #E2E8F0)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(5, data.activeJob.progressPct)}%`,
                  background: 'var(--primary)',
                  borderRadius: 999,
                  transition: 'width 400ms ease',
                }}
              />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
              {data.activeJob.progressPct}%
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: 'var(--foreground-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} />
              Berjalan {formatDuration(data.activeJob.elapsedSeconds)}
            </span>
            <span>Menganalisis simbol &amp; tag P&amp;ID...</span>
          </div>
        </div>
      )}

      {/* When Idle and No Queue */}
      {!isBusy && queue.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: 0, lineHeight: 1.5 }}>
          Tidak ada pekerjaan deteksi yang sedang berjalan atau mengantre. Mesin AI siap memproses dokumen baru kapan saja.
        </p>
      )}

      {/* Queue List Section */}
      {queue.length > 0 && (
        <div style={{ marginTop: isBusy ? 10 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground-muted)' }}>
              ⏳ Menunggu Giliran Antrean ({queue.length})
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queue.slice(0, 5).map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  fontSize: 12,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(224, 138, 38, 0.15)',
                      color: 'var(--warning, #E08A26)',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    #{item.queuePosition}
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                    {item.user.name}
                  </span>
                  <span style={{ color: 'var(--foreground-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    — {item.documentName}
                  </span>
                </div>

                <span style={{ fontSize: 11, color: 'var(--foreground-muted)', flexShrink: 0, marginLeft: 8 }}>
                  menunggu {formatDuration(item.waitingSeconds)}
                </span>
              </div>
            ))}

            {queue.length > 5 && (
              <span style={{ fontSize: 11, color: 'var(--foreground-muted)', textAlign: 'center', marginTop: 4 }}>
                +{queue.length - 5} dokumen lainnya dalam antrean
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

