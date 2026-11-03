'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  Lightning,
  CheckCircle,
  XCircle,
  PencilSimple,
  FloppyDisk,
  CaretLeft,
  CaretRight,
  Plus,
  Minus,
  ArrowRight,
  X,
  SquaresFour,
  Check,
  Tag,
  ArrowClockwise,
  Trash,
  Stack,
  Crop,
} from '@phosphor-icons/react';
import { LegendSelector } from '@/components/ui/LegendSelector';
import AddManualAssetModal, { BoundingBoxCoords } from '@/components/detection/AddManualAssetModal';
import type { DxfDrawBbox } from '@/components/DxfViewer';
import DedupModal from '@/components/detection/DedupModal';
import { getAssetTypeColor } from '@/lib/asset-type-colors';

const DxfViewer = dynamic(() => import('@/components/DxfViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--foreground-muted)', fontSize: 13 }}>
      Memuat CAD Viewer...
    </div>
  ),
});

// ── Types ───────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
}

interface Document {
  id: string;
  filename: string;
  page_count: number;
  status: string;
  file_type?: string;
  project_id?: string | null;
}

interface Detection {
  id: string;
  asset_tag: string | null;
  asset_type: string;
  description: string | null;
  service: string | null;
  size: string | null;
  equipment_class: string | null;
  pid_page: number | null;
  confidence: number | null;
  detection_status: string;
  review_status: string;
  candidate_status?: string | null;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  world_bbox_x?: number | null;
  world_bbox_y?: number | null;
  world_bbox_w?: number | null;
  world_bbox_h?: number | null;
  sheet_bbox_x?: number | null;
  sheet_bbox_y?: number | null;
  sheet_bbox_w?: number | null;
  sheet_bbox_h?: number | null;
}

interface JobProgress {
  jobId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progressPct: number;
  stageText: string;
  stats?: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
    detected: number;
  };
  errorDetail?: string | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-card, 20px)',
  boxShadow: 'var(--shadow-card)',
};

function StatusBadge({ status }: { status: string }) {
  const isApproved = status === 'APPROVED' || status === 'CONFIRMED';
  const isRejected = status === 'REJECTED';
  const bg = isApproved ? 'var(--success-soft)' : isRejected ? 'var(--danger-soft)' : 'var(--warning-soft)';
  const color = isApproved ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--warning)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--radius-chip, 6px)', fontSize: 11, fontWeight: 700, background: bg, color }}>
      {isApproved ? 'APPROVED' : isRejected ? 'REJECTED' : 'PENDING'}
    </span>
  );
}

function DetectionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentId, setDocumentId] = useState<string>('');
  const [selectedLegendId, setSelectedLegendId] = useState<string | null>(null);
  const [selectedLegendIds, setSelectedLegendIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [globalQueue, setGlobalQueue] = useState<{
    isBusy: boolean;
    activeJob: { id: string; documentId: string; documentName: string; user: { name: string }; progressPct: number } | null;
    queue: Array<{ id: string; documentId: string; user: { name: string }; queuePosition: number }>;
  } | null>(null);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loadingDets, setLoadingDets] = useState(false);

  // Pagination & Filters
  const [page, setPage] = useState<number>(1);
  const [statusTab, setStatusTab] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllPages, setShowAllPages] = useState(true); // default: show all sheets
  const [listPage, setListPage] = useState(1); // pagination for right-side list
  const LIST_PAGE_SIZE = 10;

  // Multi-selection (Bulk Action)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Active sheet for DXF viewer — auto-jump to page with detections
  const [activeSheet, setActiveSheet] = useState<number | null>(null);

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<Detection | null>(null);
  const [editForm, setEditForm] = useState({
    asset_tag: '',
    asset_type: '',
    description: '',
    service: '',
    size: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  // Recrop state — track detection being recropped
  const [recropId, setRecropId] = useState<string | null>(null);

  // Viewer Pan & Zoom State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showAllBboxes, setShowAllBboxes] = useState(true);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);

  // Drag Bbox State (Move / Resize)
  const [dragBbox, setDragBbox] = useState<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    mode: 'move' | 'tl' | 'tr' | 'bl' | 'br';
  } | null>(null);
  const suppressClickRef = useRef(false);

  const viewerRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Manual Asset Drawing State
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [currentDrawRect, setCurrentDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [pendingBbox, setPendingBbox] = useState<BoundingBoxCoords>({ x: 500, y: 500, width: 50, height: 50 });

  // Container viewport size observer for high-DPI scaling
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 900, h: 650 });

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ w: rect.width, h: rect.height });
      }
    };

    updateSize();

    const ro = new ResizeObserver(() => {
      updateSize();
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  // Compute base drawing dimension that fits the viewport container comfortably at zoom=1
  const baseSize = useMemo(() => {
    if (!imgNatural || !containerSize.w || !containerSize.h) return null;
    const aspect = imgNatural.w / imgNatural.h;
    const availW = Math.max(100, containerSize.w - 32);
    const availH = Math.max(100, containerSize.h - 32);

    if (availW / availH > aspect) {
      const h = availH;
      const w = Math.round(h * aspect);
      return { w, h };
    } else {
      const w = availW;
      const h = Math.round(w / aspect);
      return { w, h };
    }
  }, [imgNatural, containerSize]);

  // Reset zoom & pan when page or document changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgNatural(null);
    setIsDrawingMode(false);
    setDrawingStart(null);
    setCurrentDrawRect(null);
  }, [page, documentId]);

  // Auto-navigate to first sheet with detections (DXF viewer)
  useEffect(() => {
    console.log('[detection] auto-sheet effect:', { detectionsCount: detections?.length, activeSheet });
    if (!detections || detections.length === 0) {
      setActiveSheet(null);
      return;
    }
    // Find pages with detections
    const pagesWithDet = new Set(detections.map(d => d.pid_page).filter(p => p !== null && p !== undefined));
    console.log('[detection] pagesWithDet:', Array.from(pagesWithDet));
    if (pagesWithDet.size > 0) {
      const firstPageWithDet = Math.min(...Array.from(pagesWithDet as Set<number>));
      console.log('[detection] setting activeSheet to:', firstPageWithDet);
      setActiveSheet(firstPageWithDet);
    }
  }, [detections]);

  // Smooth Zoom via Mouse Scroll Wheel with Cursor-Anchor Focal Point
  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Zoom factor: 1.15 on wheel up (zoom in), 0.87 on wheel down (zoom out)
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      setZoom((prevZoom) => {
        const nextZoom = Math.min(8, Math.max(0.2, Number((prevZoom * zoomFactor).toFixed(3))));
        const scaleRatio = nextZoom / prevZoom;
        setPan((prevPan) => ({
          x: Number((mouseX - (mouseX - prevPan.x) * scaleRatio).toFixed(1)),
          y: Number((mouseY - (mouseY - prevPan.y) * scaleRatio).toFixed(1)),
        }));
        return nextZoom;
      });
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Reset list pagination when filter/search/tab/mode changes
  useEffect(() => { setListPage(1); }, [searchQuery, statusTab, showAllPages, documentId]);

  // 1a. Load projects list
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setProjects(data);
      })
      .catch((err) => console.error('[detection] load projects failed:', err));
  }, []);

  // 1b. Load initial documents list (default: kosong, tidak auto-select)
  useEffect(() => {
    fetch('/api/documents')
      .then((r) => r.json())
      .then((data) => {
        const docs = Array.isArray(data) ? data : data.documents || [];
        setDocuments(docs);
        const queryDocId = searchParams.get('document_id');
        const queryProjectId = searchParams.get('project_id');

        if (queryProjectId) setSelectedProjectId(queryProjectId);

        if (queryDocId && docs.some((d: Document) => d.id === queryDocId)) {
          setDocumentId(queryDocId);
          const found = docs.find((d: Document) => d.id === queryDocId);
          if (found?.project_id) setSelectedProjectId(found.project_id);
        }
        // Default: kosong — user pilih sendiri
      })
      .catch((err) => console.error('[detection] load docs failed:', err));
  }, [searchParams]);

  // Filter documents by selected project
  const filteredDocuments = useMemo(() => {
    if (!selectedProjectId) return documents;
    return documents.filter((d) => d.project_id === selectedProjectId);
  }, [documents, selectedProjectId]);

  // Sync active document
  const activeDoc = documents.find((d) => d.id === documentId) ?? null;
  const isDxf = activeDoc?.file_type === 'dxf';
  // For DXF: page_count in DB is always 1 (DXF has no PDF pages).
  // Use actual unique pid_page values from detections as "sheets".
  const dxfPages = isDxf
    ? [...new Set(detections.map((d) => d.pid_page ?? 1))].sort((a, b) => a - b)
    : [];
  const totalPages = isDxf
    ? (dxfPages.length > 0 ? dxfPages[dxfPages.length - 1] : 1)
    : (activeDoc?.page_count || 1);

  // 2. Load detections for document
  const loadDetections = useCallback(async (jobId?: string) => {
    if (!documentId) return;
    setLoadingDets(true);
    try {
      const param = jobId
        ? `job_id=${jobId}&limit=1000`
        : `document_id=${documentId}&limit=1000`;
      console.log('[detection] fetch detections:', `/api/detections?${param}`);
      const res = await fetch(`/api/detections?${param}`);
      const body = await res.json();
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.detections) ? body.detections : [];
      console.log('[detection] loaded detections count:', list.length, 'jobId:', jobId);
      setDetections(list);
      checkDuplicates(documentId);
    } catch (err) {
      console.error('[detection] load detections failed:', err);
    } finally {
      setLoadingDets(false);
    }
  }, [documentId]);

  // Monitor background detection job progress
  const monitorJob = useCallback(
    (jobId: string) => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      setRunning(true);
      setJobProgress({
        jobId,
        status: 'PROCESSING',
        progressPct: 5,
        stageText: 'Starting detection job & preparing drawing...',
      });

      pollTimerRef.current = setInterval(async () => {
        try {
          const jRes = await fetch(`/api/detection/jobs/${jobId}`);
          const jData = await jRes.json();
          if (!jRes.ok) throw new Error(jData.error || 'Failed to poll job status');

          const pct = Math.max(5, Math.min(100, jData.progress_pct ?? 0));
          let stageText = 'Analyzing P&ID Drawing...';
          if (jData.status === 'PENDING') {
            stageText = 'Queueing job in detection worker...';
          } else if (pct < 20) {
            stageText = 'Loading drawing & extracting layers / pages...';
          } else if (pct < 50) {
            stageText = 'Detecting equipment symbols & spatial geometry...';
          } else if (pct < 75) {
            stageText = 'Matching symbols against Legend & OCR text...';
          } else if (pct < 95) {
            stageText = 'Tracing process flow & allocating incremental tags...';
          } else {
            stageText = 'Finalizing detections & updating database...';
          }

          setJobProgress({
            jobId,
            status: jData.status,
            progressPct: pct,
            stageText,
            stats: jData.stats,
            errorDetail: jData.error_detail,
          });

          if (jData.status === 'COMPLETED') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setRunning(false);
            setJobProgress({
              jobId,
              status: 'COMPLETED',
              progressPct: 100,
              stageText: `Detection completed! ${jData.stats?.total ?? 0} physical assets detected.`,
              stats: jData.stats,
            });
            await loadDetections(jobId);
            setTimeout(() => {
              setJobProgress((prev) => (prev?.status === 'COMPLETED' ? null : prev));
            }, 4500);
          } else if (jData.status === 'FAILED') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setRunning(false);
            setJobProgress({
              jobId,
              status: 'FAILED',
              progressPct: pct,
              stageText: 'Detection job failed',
              errorDetail: jData.error_detail || 'Unknown error during detection',
            });
          } else if (jData.status === 'CANCELLED') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setRunning(false);
            setJobProgress(null);
          }
        } catch (err) {
          console.error('[detection] poll job error:', err);
        }
      }, 1500);
    },
    [loadDetections]
  );

  const fetchGlobalQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/detection/queue');
      if (res.ok) {
        const data = await res.json();
        setGlobalQueue(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchGlobalQueue();
    const interval = setInterval(fetchGlobalQueue, 4000);
    return () => clearInterval(interval);
  }, [fetchGlobalQueue]);

  const myQueueItem = useMemo(() => {
    if (!globalQueue?.queue) return null;
    return (
      globalQueue.queue.find(
        (q) => q.documentId === documentId || (jobProgress?.jobId && q.id === jobProgress.jobId)
      ) ?? null
    );
  }, [globalQueue, documentId, jobProgress?.jobId]);

  const handleCancelQueue = async (jobIdToCancel?: string) => {
    const targetJobId = jobIdToCancel || jobProgress?.jobId || activeJobId;
    if (!targetJobId) return;
    if (!confirm('Apakah Anda yakin ingin membatalkan antrean deteksi ini?')) return;

    setCancellingJob(true);
    try {
      const res = await fetch(`/api/detection/jobs/${targetJobId}/cancel`, { method: 'POST' });
      if (res.ok) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setRunning(false);
        setJobProgress(null);
        await fetchGlobalQueue();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'Gagal membatalkan antrean deteksi');
      }
    } catch {
      alert('Terjadi kesalahan saat membatalkan antrean');
    } finally {
      setCancellingJob(false);
    }
  };

  useEffect(() => {
    if (documentId) {
      setSelectedIds(new Set());
      setSelectedId(null);
      setPage(1);
      setPan({ x: 0, y: 0 });
      setZoom(1);

      // Fetch latest job for this document, load detections scoped to that job
      fetch(`/api/detection/jobs?document_id=${documentId}&limit=1`)
        .then((r) => r.json())
        .then((body) => {
          const latestJob = Array.isArray(body?.data) ? body.data[0] : null;
          if (latestJob) {
            setActiveJobId(latestJob.id);
            loadDetections(latestJob.id);
            if (latestJob.status === 'PROCESSING' || latestJob.status === 'PENDING') {
              monitorJob(latestJob.id);
            }
          } else {
            // No job yet — load by document (empty or legacy)
            loadDetections();
          }
        })
        .catch((err) => {
          console.warn('[detection] check active job failed:', err);
          loadDetections();
        });
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [documentId, loadDetections, monitorJob]);

  // 3. Trigger Detection
  const handleRunDetection = async () => {
    if (!documentId) return;
    setRunning(true);
    try {
      const res = await fetch('/api/detection/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          legend_id: selectedLegendId || undefined,
          legend_ids: selectedLegendIds.length ? selectedLegendIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Job creation failed');

      const jobId = data.job?.id || data.id;
      setActiveJobId(jobId);
      monitorJob(jobId);
    } catch (err) {
      console.error('[detection] start job failed:', err);
      setRunning(false);
      setJobProgress({
        jobId: 'error',
        status: 'FAILED',
        progressPct: 0,
        stageText: 'Failed to start detection job',
        errorDetail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // 4. Quick Actions: Approve, Reject, Edit
  const handleApprove = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await fetch(`/api/detections/${id}/confirm`, { method: 'POST' });
      setDetections((prev) =>
        prev.map((d) => (d.id === id ? { ...d, review_status: 'APPROVED', detection_status: 'CONFIRMED' } : d))
      );
    } catch (err) {
      console.error('[detection] approve failed:', err);
    }
  };

  const handleReject = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await fetch(`/api/detections/${id}/reject`, { method: 'POST' });
      setDetections((prev) =>
        prev.map((d) => (d.id === id ? { ...d, review_status: 'REJECTED', detection_status: 'REJECTED' } : d))
      );
    } catch (err) {
      console.error('[detection] reject failed:', err);
    }
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await fetch(`/api/detections/${id}`, { method: 'DELETE' });
      setDetections((prev) => prev.filter((d) => d.id !== id));
      if (selectedId === id) setSelectedId(null);
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      console.error('[detection] delete failed:', err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/detections/${id}`, { method: 'DELETE' })));
      setDetections((prev) => prev.filter((d) => !selectedIds.has(d.id)));
      if (selectedId && selectedIds.has(selectedId)) setSelectedId(null);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('[detection] bulk delete failed:', err);
    }
  };

  // Keyboard shortcut: Del or Backspace to delete currently selected detection(s)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
      if (isInput || editingItem) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleBulkDelete();
        } else if (selectedId) {
          e.preventDefault();
          handleDelete(selectedId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, selectedIds, editingItem]);

  const handleOpenEdit = (item: Detection, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingItem(item);
    setEditForm({
      asset_tag: item.asset_tag || '',
      asset_type: item.asset_type || '',
      description: item.description || '',
      service: item.service || '',
      size: item.size || '',
    });
  };

  const handleRecrop = (id: string) => {
    setRecropId(id);
    setSelectedId(id);
    setIsDrawingMode(true);
    // Scroll ke card di list
    setTimeout(() => cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  };

  const handleEditFromViewer = (detection: Detection) => {
    handleOpenEdit(detection);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/detections/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error('Save failed');
      setDetections((prev) =>
        prev.map((d) => (d.id === editingItem.id ? { ...d, ...editForm } : d))
      );
      setEditingItem(null);
    } catch (err) {
      console.error('[detection] save edit failed:', err);
    } finally {
      setEditSaving(false);
    }
  };

  // 5. Bulk Actions (Approve / Reject Selected)
  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredDetections.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDetections.map((d) => d.id)));
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await fetch('/api/detections/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'confirm' }),
      });
      setDetections((prev) =>
        prev.map((d) => (selectedIds.has(d.id) ? { ...d, review_status: 'APPROVED', detection_status: 'CONFIRMED' } : d))
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error('[detection] bulk approve failed:', err);
    }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await fetch('/api/detections/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'reject' }),
      });
      setDetections((prev) =>
        prev.map((d) => (selectedIds.has(d.id) ? { ...d, review_status: 'REJECTED', detection_status: 'REJECTED' } : d))
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error('[detection] bulk reject failed:', err);
    }
  };

  // 5b. Duplicate detection count & modal state
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null);
  const [isDedupOpen, setIsDedupOpen] = useState(false);
  const checkDuplicates = useCallback(async (docId: string) => {
    if (!docId) { setDuplicateCount(null); return; }
    try {
      const res = await fetch(`/api/detections/deduplicate?document_id=${docId}`);
      if (res.ok) {
        const data = await res.json();
        setDuplicateCount(data.duplicate_count ?? 0);
      }
    } catch (err) {
      console.error('[detection] checkDuplicates failed:', err);
    }
  }, []);

  // 5c. Auto-tagging for missing tags
  const [autoTagging, setAutoTagging] = useState(false);
  const handleAutoTag = async () => {
    if (!documentId) return;
    setAutoTagging(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/auto-tag`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-tag failed');
      await loadDetections();
    } catch (err) {
      console.error('[detection] auto-tag failed:', err);
    } finally {
      setAutoTagging(false);
    }
  };

  // 6. Filtering & Search
  const pageDetections = detections.filter((d) => (d.pid_page ?? 1) === page);
  const listSource = showAllPages ? detections : pageDetections;
  const filteredDetections = listSource.filter((d) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches =
        (d.asset_tag ?? '').toLowerCase().includes(q) ||
        (d.asset_type ?? '').toLowerCase().includes(q) ||
        (d.service ?? '').toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (statusTab === 'PENDING') return d.review_status === 'PENDING';
    if (statusTab === 'APPROVED') return d.review_status === 'APPROVED' || d.detection_status === 'CONFIRMED';
    if (statusTab === 'REJECTED') return d.review_status === 'REJECTED' || d.detection_status === 'REJECTED';
    return true;
  });

  const counts = {
    total: listSource.length,
    pending: listSource.filter((d) => d.review_status === 'PENDING').length,
    approved: listSource.filter((d) => d.review_status === 'APPROVED' || d.detection_status === 'CONFIRMED').length,
    rejected: listSource.filter((d) => d.review_status === 'REJECTED' || d.detection_status === 'REJECTED').length,
    untagged: detections.filter((d) => !d.asset_tag || d.asset_tag.trim() === '').length,
  };

  // Pagination for list panel
  const totalListPages = Math.max(1, Math.ceil(filteredDetections.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, totalListPages);
  const paginatedDetections = filteredDetections.slice(
    (safeListPage - 1) * LIST_PAGE_SIZE,
    safeListPage * LIST_PAGE_SIZE
  );

  // Bboxes for viewer: always all detections on current sheet (viewer is per-sheet by design)
  // But labels/highlights still cross-reference selectedId from any sheet
  const viewerDetections = pageDetections;

  const selectedItem = detections.find((d) => d.id === selectedId) ?? null;

  // Zoom handlers
  const handleZoomIn = () => setZoom((z) => Math.min(8, Number((z * 1.25).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, Number((z * 0.8).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const imgSrc = documentId && !isDxf ? `/api/documents/${documentId}/pages/${page}/image` : null;

  return (
    <>
      <LoadingOverlay
        isVisible={running}
        message="Starting Detection Job..."
        subMessage="Submitting to AI detection queue. This may take a moment."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: 'calc(100vh - var(--topbar-height) - 48px)', overflow: 'hidden' }}>
      {/* ── Top Header Bar ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, padding: '4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          {/* Project Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                const pId = e.target.value;
                setSelectedProjectId(pId);
                if (documentId) {
                  const curDoc = documents.find((d) => d.id === documentId);
                  if (pId && curDoc && curDoc.project_id !== pId) setDocumentId('');
                }
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--foreground)',
                fontSize: 12,
                fontWeight: 600,
                maxWidth: 160,
              }}
            >
              <option value="">Semua Project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>📁 {p.name}</option>
              ))}
            </select>
          </div>

          {/* Document Selector */}
          <select
            value={documentId}
            onChange={(e) => {
              const newId = e.target.value;
              setDocumentId(newId);
              if (newId) {
                const doc = documents.find((d) => d.id === newId);
                if (doc?.project_id && (!selectedProjectId || selectedProjectId !== doc.project_id)) {
                  setSelectedProjectId(doc.project_id);
                }
              }
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              fontSize: 13,
              fontWeight: 600,
              maxWidth: 240,
            }}
          >
            <option value="">— Pilih Dokumen —</option>
            {filteredDocuments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>

          <LegendSelector
            projectId={selectedProjectId || undefined}
            value={selectedLegendId}
            onChange={(val) => {
              if (typeof val === 'string') setSelectedLegendId(val);
              else if (Array.isArray(val)) setSelectedLegendId(val[0] ?? null);
              else setSelectedLegendId(null);
            }}
            multiValues={selectedLegendIds}
            onMultiChange={(ids) => {
              setSelectedLegendIds(ids);
              setSelectedLegendId(ids[0] ?? null);
            }}
            placeholder="Select Legend standard…"
          />

          <button
            onClick={handleRunDetection}
            disabled={running || !documentId}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid #16a34a',
              background: '#16a34a',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: running ? 'not-allowed' : 'pointer',
              opacity: running ? 0.8 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {running ? (
              jobProgress?.status === 'PENDING' ? (
                <>
                  <ArrowClockwise size={14} weight="bold" className="animate-spin" />
                  Antrean #{myQueueItem?.queuePosition ?? 1}
                </>
              ) : (
                <>
                  <ArrowClockwise size={14} weight="bold" className="animate-spin" />
                  Detecting ({jobProgress?.progressPct ?? 5}%)
                </>
              )
            ) : (
              <>
                <Lightning size={14} weight="fill" />
                Run Detection
              </>
            )}
          </button>
        </div>

        {/* Right side header: Stats & Proceed to MDO Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>
              Total: <strong>{counts.total}</strong>
            </span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--success-soft)', color: 'var(--success)' }}>
              Approved: <strong>{counts.approved}</strong>
            </span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              Pending: <strong>{counts.pending}</strong>
            </span>
            {duplicateCount !== null && duplicateCount > 0 && (
              <button
                onClick={() => setIsDedupOpen(true)}
                title="Duplicates detected! Click to review and deduplicate"
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: 'rgba(234, 179, 8, 0.15)',
                  color: '#b45309',
                  border: '1px solid #facc15',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Stack size={12} weight="bold" />
                Duplicates: <strong>{duplicateCount}</strong>
              </button>
            )}
          </div>

          <Link
            href={`/mdo?document_id=${documentId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 2px 4px rgba(37,99,235,0.2)',
            }}
          >
            Proceed to MDO <ArrowRight size={14} weight="bold" />
          </Link>
        </div>
      </div>

      {/* ── Global Queue Banner (When another user's job is active) ── */}
      {globalQueue?.isBusy &&
        globalQueue.activeJob &&
        globalQueue.activeJob.documentId !== documentId && (
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: 'rgba(52, 81, 209, 0.08)',
              border: '1px solid rgba(52, 81, 209, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--foreground)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              <span>
                Mesin deteksi sedang memproses dokumen{' '}
                <strong>{globalQueue.activeJob.documentName}</strong> oleh{' '}
                <strong>{globalQueue.activeJob.user.name}</strong> ({globalQueue.activeJob.progressPct}%).
                {globalQueue.queue.length > 0 && ` Ada ${globalQueue.queue.length} dokumen dalam antrean.`}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
              Dokumen baru yang dijalankan akan otomatis masuk antrean berikutnya.
            </span>
          </div>
        )}

      {/* ── Detection Progress Bar (Active when detection is running or completed/failed recently) ── */}
      {jobProgress && (
        <div
          style={{
            ...cardStyle,
            padding: '10px 14px',
            background:
              jobProgress.status === 'FAILED'
                ? 'rgba(239,68,68,0.06)'
                : jobProgress.status === 'COMPLETED'
                ? 'rgba(34,197,94,0.06)'
                : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-muted) 100%)',
            border: `1px solid ${
              jobProgress.status === 'FAILED'
                ? 'var(--danger)'
                : jobProgress.status === 'COMPLETED'
                ? 'var(--success)'
                : 'rgba(37,99,235,0.5)'
            }`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            position: 'relative',
          }}
        >
          {/* Header row: Status, text, percentage & stats */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {jobProgress.status === 'FAILED' ? (
                <XCircle size={20} weight="fill" color="var(--danger)" style={{ flexShrink: 0 }} />
              ) : jobProgress.status === 'COMPLETED' ? (
                <CheckCircle size={20} weight="fill" color="var(--success)" style={{ flexShrink: 0 }} />
              ) : (
                <ArrowClockwise
                  size={18}
                  weight="bold"
                  color="#3b82f6"
                  className="animate-spin"
                  style={{ flexShrink: 0 }}
                />
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                    {jobProgress.status === 'FAILED'
                      ? 'Detection Failed'
                      : jobProgress.status === 'COMPLETED'
                      ? 'Detection Completed'
                      : jobProgress.status === 'PENDING'
                      ? `Menunggu Antrean (#${myQueueItem?.queuePosition ?? 1})`
                      : `Analyzing P&ID Assets (${jobProgress.progressPct}%)`}
                  </span>
                  <span
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      background:
                        jobProgress.status === 'FAILED'
                          ? 'var(--danger-soft)'
                          : jobProgress.status === 'COMPLETED'
                          ? 'var(--success-soft)'
                          : jobProgress.status === 'PENDING'
                          ? 'rgba(224, 138, 38, 0.15)'
                          : 'rgba(37,99,235,0.15)',
                      color:
                        jobProgress.status === 'FAILED'
                          ? 'var(--danger)'
                          : jobProgress.status === 'COMPLETED'
                          ? 'var(--success)'
                          : jobProgress.status === 'PENDING'
                          ? 'var(--warning, #E08A26)'
                          : '#2563eb',
                    }}
                  >
                    {jobProgress.status === 'PENDING' ? `ANTREAN #${myQueueItem?.queuePosition ?? 1}` : jobProgress.status}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: jobProgress.status === 'FAILED' ? 'var(--danger)' : 'var(--foreground-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {jobProgress.status === 'PENDING'
                    ? `Menunggu giliran... Dokumen Anda berada di urutan #${myQueueItem?.queuePosition ?? 1}. Mesin AI akan memulai deteksi otomatis begitu antrean sebelumnya selesai.`
                    : (jobProgress.errorDetail || jobProgress.stageText)}
                </span>
              </div>
            </div>

            {/* Right side stats & Cancel button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {jobProgress.status === 'PENDING' && (
                <button
                  type="button"
                  onClick={() => handleCancelQueue(jobProgress.jobId)}
                  disabled={cancellingJob}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: 'var(--danger-soft, #fef2f2)',
                    border: '1px solid var(--danger, #ef4444)',
                    color: 'var(--danger, #b91c1c)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: cancellingJob ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="Batalkan dari antrean deteksi"
                >
                  <X size={12} weight="bold" />
                  {cancellingJob ? 'Membatalkan...' : 'Batalkan Antrean'}
                </button>
              )}
              {jobProgress.stats && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
                    Detected: <strong>{jobProgress.stats.total}</strong>
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                    Pending: <strong>{jobProgress.stats.pending}</strong>
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--success-soft)', color: 'var(--success)' }}>
                    Confirmed: <strong>{jobProgress.stats.confirmed}</strong>
                  </span>
                </div>
              )}

              {/* Dismiss button when completed or failed */}
              {(jobProgress.status === 'COMPLETED' || jobProgress.status === 'FAILED') && (
                <button
                  onClick={() => setJobProgress(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--foreground-muted)',
                    cursor: 'pointer',
                    fontSize: 18,
                    padding: '2px 6px',
                    lineHeight: 1,
                  }}
                  title="Close progress banner"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar Track */}
          <div
            style={{
              width: '100%',
              height: 7,
              borderRadius: 999,
              background: 'rgba(0,0,0,0.25)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${jobProgress.progressPct}%`,
                borderRadius: 999,
                background:
                  jobProgress.status === 'FAILED'
                    ? 'var(--danger)'
                    : jobProgress.status === 'COMPLETED'
                    ? 'var(--success)'
                    : 'linear-gradient(90deg, #2563eb 0%, #7c3aed 50%, #10b981 100%)',
                transition: 'width 0.4s ease-out',
                boxShadow:
                  jobProgress.status === 'FAILED'
                    ? '0 0 8px rgba(239,68,68,0.5)'
                    : jobProgress.status === 'COMPLETED'
                    ? '0 0 8px rgba(34,197,94,0.5)'
                    : '0 0 10px rgba(37,99,235,0.5)',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Bulk Actions Toolbar (Active when items are selected) ────────── */}
      {selectedIds.size > 0 && (
        <div
          style={{
            ...cardStyle,
            padding: '6px 12px',
            background: 'var(--surface-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0,
            borderLeft: '3px solid #2563eb',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--foreground)' }}>
            <strong>{selectedIds.size}</strong> asset(s) selected
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Deselect all
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleBulkApprove}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--success)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Check size={12} weight="bold" /> Approve Selected
            </button>
            <button
              onClick={handleBulkReject}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--danger)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <X size={12} weight="bold" /> Reject Selected
            </button>
            <button
              onClick={handleBulkDelete}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: '#dc2626',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Delete selected assets permanently (Shortcut: Del)"
            >
              <Trash size={12} weight="bold" /> Delete Selected (Del)
            </button>
          </div>
        </div>
      )}

      {/* ── Main Workspace Area (Split Viewer + Cards) ─────────────────── */}
      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Side: Interactive Canvas / DXF Viewer */}
        <div style={{ ...cardStyle, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Viewer Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-muted)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>
                {isDxf ? 'CAD Drawing View' : 'P&ID Page View'}
              </span>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    style={{ padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                  >
                    <CaretLeft size={12} />
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    style={{ padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                  >
                    <CaretRight size={12} />
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button
                  onClick={handleZoomOut}
                  style={{ padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                >
                  <Minus size={12} />
                </button>
                <span style={{ fontSize: 11, width: 34, textAlign: 'center', color: 'var(--foreground-muted)' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  style={{ padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                >
                  <Plus size={12} />
                </button>
                <button
                  onClick={handleResetZoom}
                  style={{ padding: '2px 8px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', marginLeft: 4 }}
                >
                  Reset
                </button>
              </div>

              <div style={{ width: 1, height: 14, background: 'var(--border)' }} />

              <button
                onClick={() => setShowAllBboxes((v) => !v)}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${showAllBboxes ? 'var(--primary)' : 'var(--border)'}`,
                  background: showAllBboxes ? 'var(--primary)' : 'var(--surface)',
                  color: showAllBboxes ? '#fff' : 'var(--foreground)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                <SquaresFour size={12} /> {showAllBboxes ? 'All BBoxes' : 'Selected BBox'}
              </button>

              <div style={{ width: 1, height: 14, background: 'var(--border)' }} />

              <button
                type="button"
                onClick={() => {
                  setIsDrawingMode((v) => !v);
                  setDrawingStart(null);
                  setCurrentDrawRect(null);
                }}
                disabled={!documentId}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${isDrawingMode ? '#22c55e' : 'var(--border)'}`,
                  background: isDrawingMode ? 'rgba(34, 197, 94, 0.18)' : 'var(--surface)',
                  color: isDrawingMode ? '#22c55e' : 'var(--foreground)',
                  cursor: !documentId ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  opacity: !documentId ? 0.5 : 1,
                  boxShadow: isDrawingMode ? '0 0 10px rgba(34,197,94,0.3)' : 'none',
                }}
                title={isDxf ? 'Klik dan drag area simbol pada viewer DXF untuk menambah aset' : 'Draw bounding box on PDF preview to add asset'}
              >
                <Plus size={12} weight="bold" />
                {isDrawingMode ? 'Drawing Mode Active' : 'Add Asset Manual'}
              </button>
            </div>
          </div>

          {/* Drawing Mode Helper Banner */}
          {isDrawingMode && (
            <div
              style={{
                padding: '6px 12px',
                background: 'rgba(34, 197, 94, 0.12)',
                borderBottom: '1px solid rgba(34, 197, 94, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 11,
                color: '#22c55e',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <span>
                {recropId 
                  ? 'Mode Recrop: Klik dan drag untuk menandai ulang area simbol yang terdeteksi.'
                  : 'Mode Seleksi Aktif: Klik dan drag mouse pada gambar P&ID untuk menandai area simbol asset baru.'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsDrawingMode(false);
                  setDrawingStart(null);
                  setCurrentDrawRect(null);
                  setRecropId(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#22c55e',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Batalkan
              </button>
            </div>
          )}

          {/* Canvas Viewport */}
          <div
            ref={viewerRef}
            onMouseDown={(e) => {
              if (isDrawingMode) {
                if (!imageContainerRef.current) return;
                const rect = imageContainerRef.current.getBoundingClientRect();
                const normX = Math.min(1000, Math.max(0, ((e.clientX - rect.left) / rect.width) * 1000));
                const normY = Math.min(1000, Math.max(0, ((e.clientY - rect.top) / rect.height) * 1000));
                setDrawingStart({ x: normX, y: normY });
                setCurrentDrawRect({ x: normX, y: normY, w: 0, h: 0 });
              } else if (e.button === 0 || e.button === 1) {
                setDragging(true);
                setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
              }
            }}
            onMouseMove={(e) => {
              if (dragBbox && imageContainerRef.current) {
                const rect = imageContainerRef.current.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  const dx = ((e.clientX - dragBbox.startX) / rect.width) * 1000;
                  const dy = ((e.clientY - dragBbox.startY) / rect.height) * 1000;
                  let nx = dragBbox.origX;
                  let ny = dragBbox.origY;
                  let nw = dragBbox.origW;
                  let nh = dragBbox.origH;

                  if (dragBbox.mode === 'move') {
                    nx = Math.max(0, Math.min(1000 - nw, Math.round(dragBbox.origX + dx)));
                    ny = Math.max(0, Math.min(1000 - nh, Math.round(dragBbox.origY + dy)));
                  } else if (dragBbox.mode === 'br') {
                    nw = Math.max(10, Math.min(1000 - nx, Math.round(dragBbox.origW + dx)));
                    nh = Math.max(10, Math.min(1000 - ny, Math.round(dragBbox.origH + dy)));
                  } else if (dragBbox.mode === 'tl') {
                    nx = Math.max(0, Math.min(dragBbox.origX + dragBbox.origW - 10, Math.round(dragBbox.origX + dx)));
                    ny = Math.max(0, Math.min(dragBbox.origY + dragBbox.origH - 10, Math.round(dragBbox.origY + dy)));
                    nw = dragBbox.origX + dragBbox.origW - nx;
                    nh = dragBbox.origY + dragBbox.origH - ny;
                  } else if (dragBbox.mode === 'tr') {
                    ny = Math.max(0, Math.min(dragBbox.origY + dragBbox.origH - 10, Math.round(dragBbox.origY + dy)));
                    nw = Math.max(10, Math.min(1000 - nx, Math.round(dragBbox.origW + dx)));
                    nh = dragBbox.origY + dragBbox.origH - ny;
                  } else if (dragBbox.mode === 'bl') {
                    nx = Math.max(0, Math.min(dragBbox.origX + dragBbox.origW - 10, Math.round(dragBbox.origX + dx)));
                    nw = dragBbox.origX + dragBbox.origW - nx;
                    nh = Math.max(10, Math.min(1000 - ny, Math.round(dragBbox.origH + dy)));
                  }
                  setDragBbox((prev) => (prev ? { ...prev, x: nx, y: ny, w: nw, h: nh } : null));
                  suppressClickRef.current = true;
                }
              } else if (isDrawingMode && drawingStart) {
                if (!imageContainerRef.current) return;
                const rect = imageContainerRef.current.getBoundingClientRect();
                const currentX = Math.min(1000, Math.max(0, ((e.clientX - rect.left) / rect.width) * 1000));
                const currentY = Math.min(1000, Math.max(0, ((e.clientY - rect.top) / rect.height) * 1000));
                const rx = Math.min(drawingStart.x, currentX);
                const ry = Math.min(drawingStart.y, currentY);
                const rw = Math.abs(currentX - drawingStart.x);
                const rh = Math.abs(currentY - drawingStart.y);
                setCurrentDrawRect({ x: rx, y: ry, w: rw, h: rh });
              } else if (dragging) {
                setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
              }
            }}
            onMouseUp={() => {
              if (dragBbox) {
                const finalBbox = dragBbox;
                setDragBbox(null);
                const hasChanged =
                  finalBbox.x !== finalBbox.origX ||
                  finalBbox.y !== finalBbox.origY ||
                  finalBbox.w !== finalBbox.origW ||
                  finalBbox.h !== finalBbox.origH;

                if (hasChanged) {
                  setDetections((prev) =>
                    prev.map((d) =>
                      d.id === finalBbox.id
                        ? { ...d, bbox_x: finalBbox.x, bbox_y: finalBbox.y, bbox_w: finalBbox.w, bbox_h: finalBbox.h }
                        : d
                    )
                  );
                  fetch(`/api/detections/${finalBbox.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      bbox_x: finalBbox.x,
                      bbox_y: finalBbox.y,
                      bbox_w: finalBbox.w,
                      bbox_h: finalBbox.h,
                    }),
                  }).catch((err) => console.error('[detection] save bbox failed:', err));
                }
              } else if (isDrawingMode && drawingStart && currentDrawRect) {
                if (currentDrawRect.w >= 8 && currentDrawRect.h >= 8) {
                  setPendingBbox({
                    x: Math.round(currentDrawRect.x),
                    y: Math.round(currentDrawRect.y),
                    width: Math.round(currentDrawRect.w),
                    height: Math.round(currentDrawRect.h),
                  });
                  setManualModalOpen(true);
                  setIsDrawingMode(false);
                }
                setDrawingStart(null);
                setCurrentDrawRect(null);
              } else if (dragging) {
                setDragging(false);
              }
            }}
            onMouseLeave={() => {
              if (dragBbox) {
                setDragBbox(null);
              }
              if (isDrawingMode) {
                setDrawingStart(null);
                setCurrentDrawRect(null);
              } else {
                setDragging(false);
              }
            }}
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              background: '#14161b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isDrawingMode ? 'crosshair' : dragBbox ? 'move' : dragging ? 'grabbing' : 'grab',
              userSelect: 'none',
            }}
          >
            {isDxf ? (
              <DxfViewer
                  url={`/api/documents/${documentId}/raw`}
                  detections={detections}
                  selectedId={selectedId}
                  showAll={showAllBboxes}
                  onSelectAsset={(id: string) => {
                    setSelectedId(id);
                    // find which list-page this detection is on and scroll to it
                    const idx = filteredDetections.findIndex((d) => d.id === id);
                    if (idx >= 0) {
                      const targetListPage = Math.floor(idx / LIST_PAGE_SIZE) + 1;
                      setListPage(targetListPage);
                    }
                    setTimeout(() => cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                  }}
                  activeSheet={activeSheet}
                  onDeleteAsset={(id: string) => handleDelete(id)}
                  onRecrop={handleRecrop}
                  onEdit={handleEditFromViewer}
                  onBboxUpdate={(id, bbox) => {
                    // Auto-save immediate
                    setDetections((prev) =>
                      prev.map((d) =>
                        d.id === id
                          ? {
                              ...d,
                              bbox_x: bbox.x,
                              bbox_y: bbox.y,
                              bbox_w: bbox.width,
                              bbox_h: bbox.height,
                              world_bbox_x: bbox.world?.x ?? d.world_bbox_x,
                              world_bbox_y: bbox.world?.y ?? d.world_bbox_y,
                              world_bbox_w: bbox.world?.width ?? d.world_bbox_w,
                              world_bbox_h: bbox.world?.height ?? d.world_bbox_h,
                            }
                          : d
                      )
                    );
                    fetch(`/api/detections/${id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        bbox_x: bbox.x,
                        bbox_y: bbox.y,
                        bbox_w: bbox.width,
                        bbox_h: bbox.height,
                        world_bbox_x: bbox.world?.x,
                        world_bbox_y: bbox.world?.y,
                        world_bbox_w: bbox.world?.width,
                        world_bbox_h: bbox.world?.height,
                      }),
                    }).catch((err) => console.error('[detection] bbox update failed:', err));
                  }}
                  drawingEnabled={isDrawingMode}
                  onDrawComplete={(bbox: DxfDrawBbox) => {
                    if (recropId) {
                      // Recrop existing detection
                      setDetections((prev) =>
                        prev.map((d) =>
                          d.id === recropId
                            ? {
                                ...d,
                                bbox_x: bbox.x,
                                bbox_y: bbox.y,
                                bbox_w: bbox.width,
                                bbox_h: bbox.height,
                                world_bbox_x: bbox.world?.x,
                                world_bbox_y: bbox.world?.y,
                                world_bbox_w: bbox.world?.width,
                                world_bbox_h: bbox.world?.height,
                              }
                            : d
                        )
                      );
                      // Save ke API
                      fetch(`/api/detections/${recropId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          bbox_x: bbox.x,
                          bbox_y: bbox.y,
                          bbox_w: bbox.width,
                          bbox_h: bbox.height,
                          world_bbox_x: bbox.world?.x,
                          world_bbox_y: bbox.world?.y,
                          world_bbox_w: bbox.world?.width,
                          world_bbox_h: bbox.world?.height,
                        }),
                      }).catch((err) => console.error('[detection] recrop failed:', err));
                      
                      // Open edit modal untuk ubah nama
                      const detection = detections.find(d => d.id === recropId);
                      if (detection) {
                        handleOpenEdit(detection);
                      }
                      setRecropId(null);
                      setIsDrawingMode(false);
                    } else {
                      // Manual add baru
                      setPendingBbox(bbox);
                      setManualModalOpen(true);
                      setIsDrawingMode(false);
                    }
                  }}
                  style={{ position: 'absolute', inset: 0, minHeight: 0 }}
                />
            ) : imgSrc ? (
              <div
                ref={imageContainerRef}
                style={{
                  position: 'relative',
                  width: baseSize ? Math.round(baseSize.w * zoom) : 'auto',
                  height: baseSize ? Math.round(baseSize.h * zoom) : 'auto',
                  maxWidth: baseSize ? undefined : '100%',
                  maxHeight: baseSize ? undefined : '100%',
                  flexShrink: 0,
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                  transition: dragging || (isDrawingMode && drawingStart) ? 'none' : 'transform 40ms ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  key={imgSrc}
                  src={imgSrc}
                  alt={`P&ID page ${page}`}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImgNatural({ w: img.naturalWidth || 2000, h: img.naturalHeight || 1400 });
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    objectFit: 'contain',
                    userSelect: 'none',
                    pointerEvents: 'none',
                    imageRendering: '-webkit-optimize-contrast',
                  }}
                  draggable={false}
                />

                {/* SVG Bounding Boxes Overlay */}
                {imgNatural && (
                  <svg
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                  >
                    {[...pageDetections]
                      .filter((d) => d.bbox_x !== null && d.bbox_y !== null && (showAllBboxes || d.id === selectedId))
                      .sort((a, b) => (a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0))
                      .map((d) => {
                        const isSel = d.id === selectedId;
                        const isDraggingThis = dragBbox?.id === d.id;
                        const x = isDraggingThis ? dragBbox.x : d.bbox_x!;
                        const y = isDraggingThis ? dragBbox.y : d.bbox_y!;
                        const w = isDraggingThis ? dragBbox.w : Math.max(10, d.bbox_w || 25);
                        const h = isDraggingThis ? dragBbox.h : Math.max(10, d.bbox_h || 25);
                        const isApproved = d.review_status === 'APPROVED' || d.detection_status === 'CONFIRMED';
                        const isRejected = d.review_status === 'REJECTED' || d.detection_status === 'REJECTED';
                        // Per-asset-type color; override for approved/rejected status
                        const typeColor = getAssetTypeColor(d.asset_type);
                        const stroke = isRejected ? '#ef4444' : isApproved ? '#22c55e' : typeColor.stroke;
                        const fillOpacity = isSel ? 0.35 : 0.10;
                        const strokeWidth = isSel ? 3 : isRejected ? 1.5 : 1.2;
                        const label = d.asset_tag || d.asset_type;
                        const labelBg = isRejected ? '#ef4444' : isApproved ? '#22c55e' : typeColor.stroke;

                        return (
                          <g
                            key={d.id}
                            style={{ pointerEvents: 'all', cursor: isSel ? 'move' : 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                              }
                              setSelectedId(d.id);
                              const idx = filteredDetections.findIndex((fd) => fd.id === d.id);
                              if (idx >= 0) {
                                const targetListPage = Math.floor(idx / LIST_PAGE_SIZE) + 1;
                                setListPage(targetListPage);
                              }
                              setTimeout(() => cardRefs.current[d.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              suppressClickRef.current = false;
                              const handle = (e.target as Element).getAttribute?.('data-handle') as 'tl' | 'tr' | 'bl' | 'br' | null;
                              if (handle) {
                                setDragBbox({
                                  id: d.id,
                                  x, y, w, h,
                                  startX: e.clientX, startY: e.clientY,
                                  origX: x, origY: y, origW: w, origH: h,
                                  mode: handle,
                                });
                              } else if (isSel) {
                                setDragBbox({
                                  id: d.id,
                                  x, y, w, h,
                                  startX: e.clientX, startY: e.clientY,
                                  origX: x, origY: y, origW: w, origH: h,
                                  mode: 'move',
                                });
                              } else {
                                setSelectedId(d.id);
                              }
                            }}
                          >
                            {/* Selected glow ring */}
                            {isSel && (
                              <rect
                                x={x - 3}
                                y={y - 3}
                                width={w + 6}
                                height={h + 6}
                                fill="none"
                                stroke={stroke}
                                strokeWidth={1}
                                strokeOpacity={0.4}
                                vectorEffect="non-scaling-stroke"
                                rx={3}
                              />
                            )}
                            <rect
                              x={x}
                              y={y}
                              width={w}
                              height={h}
                              fill={stroke}
                              fillOpacity={fillOpacity}
                              stroke={stroke}
                              strokeWidth={strokeWidth}
                              vectorEffect="non-scaling-stroke"
                              strokeDasharray={isSel || isApproved ? undefined : '4 2'}
                              rx={1}
                            />
                            {/* Label Tag Header */}
                            {(() => {
                              const labelWidth = Math.max(w, Math.min(80, Math.max(26, label.slice(0, 15).length * 5.4 + 6)));
                              const labelY = y > 16 ? y - 13 : y + h + 2;
                              return (
                                <>
                                  <rect
                                    x={x}
                                    y={labelY}
                                    width={labelWidth}
                                    height={11}
                                    rx={2}
                                    fill={labelBg}
                                    opacity={isSel ? 1 : 0.88}
                                  />
                                  <text
                                    x={x + 3}
                                    y={labelY + 8.5}
                                    fill="#fff"
                                    fontSize={isSel ? 8.5 : 7.5}
                                    fontFamily="ui-monospace, monospace"
                                    fontWeight={isSel ? 700 : 500}
                                  >
                                    {label.slice(0, 15)}
                                  </text>
                                </>
                              );
                            })()}
                            {/* Asset type sub-label when selected */}
                            {isSel && d.asset_tag && (
                              <>
                                <rect
                                  x={x}
                                  y={y > 18 ? y - 28 : y + h + 16}
                                  width={Math.min(120, Math.max(w, 50))}
                                  height={12}
                                  rx={2}
                                  fill={stroke}
                                  opacity={0.7}
                                />
                                <text
                                  x={x + 3}
                                  y={(y > 18 ? y - 28 : y + h + 16) + 9}
                                  fill="#fff"
                                  fontSize={8}
                                  fontFamily="ui-sans-serif, sans-serif"
                                  fontWeight={400}
                                >
                                  {d.asset_type.slice(0, 18)}
                                </text>
                              </>
                            )}

                            {/* Resize Handles - 4 corners, only on selected bbox */}
                            {isSel && ([
                              { m: 'tl', hx: x, hy: y, c: 'nwse-resize', t: 'Resize top-left' },
                              { m: 'tr', hx: x + w, hy: y, c: 'nesw-resize', t: 'Resize top-right' },
                              { m: 'bl', hx: x, hy: y + h, c: 'nesw-resize', t: 'Resize bottom-left' },
                              { m: 'br', hx: x + w, hy: y + h, c: 'nwse-resize', t: 'Resize bottom-right' },
                            ] as const).map((handle) => (
                              <rect
                                key={handle.m}
                                data-handle={handle.m}
                                x={handle.hx - 4}
                                y={handle.hy - 4}
                                width={8}
                                height={8}
                                fill="#fff"
                                stroke={stroke}
                                strokeWidth={1.5}
                                vectorEffect="non-scaling-stroke"
                                rx={1.5}
                                style={{ cursor: handle.c, pointerEvents: 'all' }}
                              >
                                <title>{handle.t}</title>
                              </rect>
                            ))}
                          </g>
                        );
                      })}

                    {/* Live Manual Selection Bounding Box */}
                    {currentDrawRect && (
                      <g>
                        <rect
                          x={currentDrawRect.x}
                          y={currentDrawRect.y}
                          width={currentDrawRect.w}
                          height={currentDrawRect.h}
                          fill="rgba(34, 197, 94, 0.25)"
                          stroke="#22c55e"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                          strokeDasharray="4 2"
                        />
                        <rect
                          x={currentDrawRect.x}
                          y={Math.max(2, currentDrawRect.y - 14)}
                          width={95}
                          height={12}
                          rx={2}
                          fill="#22c55e"
                        />
                        <text
                          x={currentDrawRect.x + 3}
                          y={Math.max(2, currentDrawRect.y - 14) + 9}
                          fill="#fff"
                          fontSize={8}
                          fontFamily="ui-monospace, monospace"
                          fontWeight={700}
                        >
                          + NEW ASSET
                        </text>
                      </g>
                    )}
                  </svg>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>Pilih dokumen P&ID untuk ditampilkan</div>
            )}
          </div>
        </div>

        {/* Right Side: Compact Cards List (Legend Preview Layout) */}
        <aside
          style={{
            ...cardStyle,
            width: 380,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* List Header & Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === filteredDetections.length}
                  onChange={handleSelectAll}
                  style={{ cursor: 'pointer' }}
                  title="Select all on this page"
                />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>Detected Assets</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setShowAllPages((v) => !v)}
                  title={showAllPages ? 'Tampilkan hanya sheet/halaman aktif' : 'Tampilkan semua deteksi lintas sheet/halaman'}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${showAllPages ? 'var(--primary)' : 'var(--border)'}`,
                    background: showAllPages ? 'var(--primary)' : 'var(--surface)',
                    color: showAllPages ? '#fff' : 'var(--foreground-muted)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {showAllPages ? 'All Sheets' : 'Current Sheet'}
                </button>
                {counts.untagged > 0 && (
                  <button
                    onClick={handleAutoTag}
                    disabled={autoTagging}
                    title="Auto-generate incrementing equipment tags for untagged assets (e.g. FLT-001, GTV-001)"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid #7c3aed',
                      background: 'rgba(124,58,237,0.1)',
                      color: '#7c3aed',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: autoTagging ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Tag size={11} weight="bold" />
                    {autoTagging ? 'Tagging…' : `Auto-Tag (${counts.untagged})`}
                  </button>
                )}
                {documentId && (
                  <button
                    onClick={() => setIsDedupOpen(true)}
                    title={
                      duplicateCount && duplicateCount > 0
                        ? `Ditemukan ${duplicateCount} potensi deteksi duplikat. Klik untuk meninjau dan menggabungkan.`
                        : 'Pindai dan satukan deteksi duplikat yang tumpang tindih'
                    }
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${duplicateCount && duplicateCount > 0 ? '#eab308' : 'var(--border)'}`,
                      background: duplicateCount && duplicateCount > 0 ? 'rgba(234, 179, 8, 0.12)' : 'var(--surface)',
                      color: duplicateCount && duplicateCount > 0 ? '#b45309' : 'var(--foreground-muted)',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Stack size={11} weight="bold" />
                    {duplicateCount && duplicateCount > 0 ? `Deduplicate (${duplicateCount})` : 'Deduplicate'}
                  </button>
                )}
                <span style={{ fontSize: 11, color: 'var(--foreground-subtle)', background: 'var(--surface-muted)', padding: '1px 6px', borderRadius: 999 }}>
                  {filteredDetections.length} / {listSource.length}
                </span>
              </div>
            </div>

            {/* Search Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tag, type, service…"
              style={{
                width: '100%',
                padding: '5px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />

            {/* Filter Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((t) => {
                const count = t === 'all' ? counts.total : t === 'PENDING' ? counts.pending : t === 'APPROVED' ? counts.approved : counts.rejected;
                const active = statusTab === t;
                return (
                  <button
                    key={t}
                    onClick={() => setStatusTab(t)}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 999,
                      border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                      background: active ? 'var(--primary)' : 'var(--surface)',
                      color: active ? '#fff' : 'var(--foreground-muted)',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    {t} ({count})
                  </button>
                );
              })}
            </div>

            {/* Selected Asset Banner */}
            {selectedItem && (() => {
              const selColor = getAssetTypeColor(selectedItem.asset_type);
              const selIsApproved = selectedItem.review_status === 'APPROVED' || selectedItem.detection_status === 'CONFIRMED';
              const selIsRejected = selectedItem.review_status === 'REJECTED' || selectedItem.detection_status === 'REJECTED';
              const selAccent = selIsRejected ? '#ef4444' : selIsApproved ? '#22c55e' : selColor.stroke;
              return (
              <div
                style={{
                  border: `1px solid ${selAccent}`,
                  borderLeft: `4px solid ${selAccent}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: 8,
                  background: `${selAccent}0d`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                      {selectedItem.asset_tag || '(No Tag)'}
                    </span>
                    <span style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: `${selAccent}22`,
                      color: selAccent,
                      fontWeight: 700,
                      border: `1px solid ${selAccent}44`,
                    }}>
                      {selectedItem.asset_type}
                    </span>
                  </div>
                  <StatusBadge status={selectedItem.review_status} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                  Confidence: <strong>{Math.round((selectedItem.confidence ?? 0) * 100)}%</strong>
                </div>
                {selectedItem.service && (
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                    Service: {selectedItem.service}
                  </div>
                )}
                {/* Actions on selected item */}
                <div style={{ display: 'flex', gap: 6, paddingTop: 2 }}>
                  <button
                    onClick={(e) => handleApprove(selectedItem.id, e)}
                    style={{
                      flex: 1,
                      padding: '4px 0',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: 'var(--success)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <CheckCircle size={12} weight="fill" /> Approve
                  </button>
                  <button
                    onClick={(e) => handleReject(selectedItem.id, e)}
                    style={{
                      flex: 1,
                      padding: '4px 0',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: 'var(--danger-soft)',
                      color: 'var(--danger)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <XCircle size={12} weight="fill" /> Reject
                  </button>
                  <button
                    onClick={(e) => handleOpenEdit(selectedItem, e)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--foreground)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <PencilSimple size={12} /> Edit
                  </button>
                </div>
              </div>
              );
            })()}
          </div>
{/*  */}
          {/* Scrollable List of Asset Cards */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loadingDets ? (
              <p style={{ fontSize: 11, color: 'var(--foreground-muted)', textAlign: 'center', padding: 20 }}>
                Loading detections…
              </p>
            ) : filteredDetections.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--foreground-subtle)', textAlign: 'center', padding: 24 }}>
                No assets found{showAllPages ? ' across any sheet.' : ' on this sheet.'}
              </p>
            ) : (
              paginatedDetections.map((d) => {
                const isSelected = d.id === selectedId;
                const isChecked = selectedIds.has(d.id);
                const isApproved = d.review_status === 'APPROVED' || d.detection_status === 'CONFIRMED';
                const isRejected = d.review_status === 'REJECTED' || d.detection_status === 'REJECTED';

                return (
                  <div
                    key={d.id}
                    ref={(el) => {
                      cardRefs.current[d.id] = el;
                    }}
                    onClick={() => setSelectedId(d.id)}
                    style={{
                      ...cardStyle,
                      padding: '7px 9px',
                      cursor: 'pointer',
                      borderColor: isSelected ? 'var(--primary)' : 'var(--border)',
                      background: isApproved
                        ? 'rgba(34,197,94,0.06)'
                        : isRejected
                        ? 'rgba(239,68,68,0.06)'
                        : 'var(--surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {/* Per-type color strip */}
                      <div style={{
                        width: 3,
                        alignSelf: 'stretch',
                        borderRadius: 2,
                        background: isRejected ? '#ef4444' : isApproved ? '#22c55e' : getAssetTypeColor(d.asset_type).stroke,
                        flexShrink: 0,
                      }} />
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => toggleSelect(d.id, e as unknown as React.MouseEvent)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.asset_tag || '(No Tag)'}
                          </span>
                          <span style={{
                            fontSize: 10,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: isRejected ? 'rgba(239,68,68,0.15)' : isApproved ? 'rgba(34,197,94,0.15)' : `${getAssetTypeColor(d.asset_type).stroke}22`,
                            color: isRejected ? '#ef4444' : isApproved ? '#22c55e' : getAssetTypeColor(d.asset_type).stroke,
                            fontWeight: 600,
                            border: `1px solid ${isRejected ? '#ef444440' : isApproved ? '#22c55e40' : `${getAssetTypeColor(d.asset_type).stroke}44`}`,
                          }}>
                            {d.asset_type}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--foreground-muted)' }}>
                          Confidence: {Math.round((d.confidence ?? 0) * 100)}%
                          {d.size && (
                            <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'var(--surface-muted)', color: 'var(--foreground-muted)', fontWeight: 600 }}>
                              {d.size}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick Micro Action Buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={(e) => handleApprove(d.id, e)}
                        title="Approve"
                        style={{
                          background: isApproved ? 'var(--success)' : 'var(--surface-muted)',
                          color: isApproved ? '#fff' : 'var(--foreground-muted)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '3px 6px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        <Check size={11} weight="bold" />
                      </button>
                      <button
                        onClick={(e) => handleReject(d.id, e)}
                        title="Reject"
                        style={{
                          background: isRejected ? 'var(--danger)' : 'var(--surface-muted)',
                          color: isRejected ? '#fff' : 'var(--foreground-muted)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '3px 6px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        <X size={11} weight="bold" />
                      </button>
                      <button
                        onClick={(e) => handleOpenEdit(d, e)}
                        title="Edit"
                        style={{
                          background: 'var(--surface-muted)',
                          color: 'var(--foreground-muted)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '3px 6px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        <PencilSimple size={11} />
                      </button>
                      {isDxf && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRecrop(d.id);
                          }}
                          title="Recrop Bbox"
                          style={{
                            background: recropId === d.id ? 'rgba(59,130,246,0.2)' : 'var(--surface-muted)',
                            color: recropId === d.id ? '#60a5fa' : 'var(--foreground-muted)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            padding: '3px 6px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          <Crop size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Pagination Bar ── */}
          {totalListPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderTop: '1px solid var(--border)',
                background: 'var(--surface-muted)',
                flexShrink: 0,
                gap: 8,
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                {(safeListPage - 1) * LIST_PAGE_SIZE + 1}–{Math.min(safeListPage * LIST_PAGE_SIZE, filteredDetections.length)} of {filteredDetections.length}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => setListPage(1)}
                  disabled={safeListPage === 1}
                  style={{ padding: '2px 6px', fontSize: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: safeListPage === 1 ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius-sm)', opacity: safeListPage === 1 ? 0.4 : 1 }}
                >
                  «
                </button>
                <button
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  disabled={safeListPage === 1}
                  style={{ padding: '2px 6px', fontSize: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: safeListPage === 1 ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius-sm)', opacity: safeListPage === 1 ? 0.4 : 1 }}
                >
                  ‹
                </button>
                {Array.from({ length: Math.min(5, totalListPages) }, (_, i) => {
                  // Show pages around current
                  let start = Math.max(1, safeListPage - 2);
                  const end = Math.min(totalListPages, start + 4);
                  start = Math.max(1, end - 4);
                  const p = start + i;
                  if (p > totalListPages) return null;
                  const active = p === safeListPage;
                  return (
                    <button
                      key={p}
                      onClick={() => setListPage(p)}
                      style={{
                        padding: '2px 7px',
                        fontSize: 10,
                        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                        background: active ? 'var(--primary)' : 'var(--surface)',
                        color: active ? '#fff' : 'var(--foreground)',
                        cursor: 'pointer',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: active ? 700 : 400,
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
                  disabled={safeListPage === totalListPages}
                  style={{ padding: '2px 6px', fontSize: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: safeListPage === totalListPages ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius-sm)', opacity: safeListPage === totalListPages ? 0.4 : 1 }}
                >
                  ›
                </button>
                <button
                  onClick={() => setListPage(totalListPages)}
                  disabled={safeListPage === totalListPages}
                  style={{ padding: '2px 6px', fontSize: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: safeListPage === totalListPages ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius-sm)', opacity: safeListPage === totalListPages ? 0.4 : 1 }}
                >
                  »
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Edit Asset Dialog Modal ────────────────────────────────────── */}
      {editingItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingItem(null);
          }}
        >
          <div style={{ ...cardStyle, padding: 20, width: 400, boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>Edit Asset Details</h2>
              <button onClick={() => setEditingItem(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--foreground-muted)' }}>
                &times;
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Asset Tag</span>
                <input
                  type="text"
                  value={editForm.asset_tag}
                  onChange={(e) => setEditForm((p) => ({ ...p, asset_tag: e.target.value }))}
                  placeholder="e.g. 30756-PT-1020A"
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Asset Type</span>
                <input
                  type="text"
                  value={editForm.asset_type}
                  onChange={(e) => setEditForm((p) => ({ ...p, asset_type: e.target.value }))}
                  placeholder="e.g. PUMP, VALVE, VESSEL"
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Size / Specs</span>
                <input
                  type="text"
                  value={editForm.size}
                  onChange={(e) => setEditForm((p) => ({ ...p, size: e.target.value }))}
                  placeholder={'e.g. 1/2", 2", 4"'}
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Service / Duty</span>
                <input
                  type="text"
                  value={editForm.service}
                  onChange={(e) => setEditForm((p) => ({ ...p, service: e.target.value }))}
                  placeholder="e.g. Production line pressure"
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Description</span>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Optional equipment description…"
                  rows={2}
                  style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13, resize: 'none' }}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, paddingTop: 6 }}>
                <button
                  onClick={() => setEditingItem(null)}
                  style={{ flex: 1, padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 12, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: editSaving ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <FloppyDisk size={13} /> {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Add Manual Asset Modal ────────────────────────────────────── */}
      <AddManualAssetModal
        isOpen={manualModalOpen}
        documentId={documentId}
        pidPage={page}
        bbox={pendingBbox}
        onClose={() => setManualModalOpen(false)}
        onSuccess={(newDetection) => {
          setDetections((prev) => [newDetection, ...prev]);
          setSelectedId(newDetection.id);
        }}
      />
      {/* ── Deduplicate Modal ─────────────────────────────────────────── */}
      {documentId && (
        <DedupModal
          isOpen={isDedupOpen}
          documentId={documentId}
          documentName={activeDoc?.filename}
          onClose={() => setIsDedupOpen(false)}
          onSuccess={(_deletedCount) => {
            loadDetections();
            if (documentId) checkDuplicates(documentId);
          }}
        />
      )}
    </div>
    </>
  );
}

export default function DetectionPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-muted)' }}>Loading Detection Workspace…</div>}>
      <DetectionContent />
    </Suspense>
  );
}
