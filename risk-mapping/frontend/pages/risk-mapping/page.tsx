'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { DataTable, DataTableSortStatus } from 'mantine-datatable';
import Swal from 'sweetalert2';
import ComponentTreeView from '@/components/risk-analysis/ComponentTreeView';
import { getLastModelId, setLastModelId } from '@/lib/riskMappingPrefs';
import { showRiskMappingErrorAlert, isRiskMappingSchemaMissing, pAlert, promptSwal } from '@/lib/riskMappingAlert';
import { FileSearch, UploadCloud, Cpu, Loader2, X, CheckCircle2, Clock, FileText, AlertCircle, Layers, RefreshCw, RotateCcw, Link2, ExternalLink, Tag, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus, Search, ShieldAlert, FileDown, Cloud, Database, HardDrive } from 'lucide-react';
import BatchUploadModal from '@/components/risk-mapping/BatchUploadModal';
import BatchExportModal from '@/components/risk-mapping/BatchExportModal';
import JobsPanel from '@/components/risk-mapping/JobsPanel';
import EditDrawingModal from '@/components/risk-mapping/EditDrawingModal';
import UploadDrawingModal from '@/components/risk-mapping/UploadDrawingModal';
import UploadRevisionModal from '@/components/risk-mapping/UploadRevisionModal';
import StorageDestinationBanner from '@/components/risk-mapping/StorageDestinationBanner';
import Modal from '@/components/ui/Modal';

interface AssetData {
    asset_id: number;
    asset_name: string;
    [key: string]: any;
}

interface PfdListItem {
    pfd_id: number;
    public_id?: string | null;
    pfd_name: string;
    description: string | null;
    asset_id: number;
    asset_name: string | null;
    current_version_id: number | null;
    created_by: string;
    created_at: string;
    updated_by: string | null;
    updated_at: string | null;
    default_rbim_id?: number | null;
    default_model_name?: string | null;
    version_no: number | null;
    file_name: string | null;
    page_count: number | null;
    default_page: number | null;
    uploaded_at: string | null;
    storage_backend?: 'sharepoint' | 's3' | 'local';
    doc_number?: string | null;
    drawing_revision?: string | null;
    drawing_title?: string | null;
    drawing_project?: string | null;
    drawing_company?: string | null;
    drawing_job_no?: string | null;
    title_detected?: boolean;
    is_multi_drawing?: boolean;
    title_block_json?: string | null;
    indexed_pages?: number | null;
    tagged_assets_count?: number | null;
    index_job_status?: 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR' | null;
    index_job_progress?: number | null;
    index_job_id?: string | null;
    latest_job_type?: string | null;
    latest_job_status?: 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR' | null;
    latest_job_progress?: number | null;
    latest_job_message?: string | null;
    latest_job_id?: string | null;
}

async function getPdfPageCountClientSide(file: File): Promise<number | null> {
    try {
        const buffer = await file.arrayBuffer();
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(buffer, { updateMetadata: false });
        return doc.getPageCount();
    } catch (e) {
        console.error('Failed to read PDF page count', e);
        return null;
    }
}

const PAGE_SIZES = [10, 20, 50];

export default function RiskMappingPage() {
    const { data: session } = useSession();
    const isEditor = String((session?.user as any)?.group ?? '').trim() === '0';

    const [pfds, setPfds] = useState<PfdListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = sessionStorage.getItem('pfd_table_state');
                if (saved) return JSON.parse(saved).search ?? '';
            } catch {}
        }
        return '';
    });
    const [page, setPage] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = sessionStorage.getItem('pfd_table_state');
                if (saved && typeof JSON.parse(saved).page === 'number') return JSON.parse(saved).page;
            } catch {}
        }
        return 1;
    });
    const [pageSize, setPageSize] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = sessionStorage.getItem('pfd_table_state');
                if (saved && typeof JSON.parse(saved).pageSize === 'number') return JSON.parse(saved).pageSize;
            } catch {}
        }
        return PAGE_SIZES[0];
    });

    // Upload modal
    const [uploadOpen, setUploadOpen] = useState(false);

    // Edit modal
    const [editOpen, setEditOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<PfdListItem | null>(null);

    // New revision modal
    const [revisionOpen, setRevisionOpen] = useState(false);
    const [revisionTarget, setRevisionTarget] = useState<PfdListItem | null>(null);

    // Multi-PFD export modal state & selection
    const [selectedPfds, setSelectedPfds] = useState<PfdListItem[]>([]);
    const [batchExportOpen, setBatchExportOpen] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [workerStatus, setWorkerStatus] = useState<{ is_active: boolean; last_heartbeat: string | null; seconds_ago: number | null } | null>(null);
    const [schemaMissing, setSchemaMissing] = useState(false);
    const [sortStatus, setSortStatus] = useState<DataTableSortStatus>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = sessionStorage.getItem('pfd_table_state');
                if (saved && JSON.parse(saved).sortStatus) return JSON.parse(saved).sortStatus;
            } catch {}
        }
        return {
            columnAccessor: 'pfd_name',
            direction: 'asc',
        };
    });

    useEffect(() => {
        try {
            localStorage.removeItem('pfd_table_col_widths_v2');
        } catch { }
    }, []);

    // Batch upload modal
    const [batchUploadOpen, setBatchUploadOpen] = useState(false);

    // Jobs progress panel
    const [jobsPanelOpen, setJobsPanelOpen] = useState(false);
    const [pendingIndexIds, setPendingIndexIds] = useState<Set<number>>(new Set());
    const [deletingRowId, setDeletingRowId] = useState<number | null>(null);

    // Cross-PFD global tag search
    const [tagSearchQuery, setTagSearchQuery] = useState('');
    const [tagSearchResults, setTagSearchResults] = useState<any[]>([]);
    const [tagSearchLoading, setTagSearchLoading] = useState(false);
    const [tagSearchOpen, setTagSearchOpen] = useState(false);
    const tagSearchContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (tagSearchContainerRef.current && !tagSearchContainerRef.current.contains(e.target as Node)) {
                setTagSearchOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const showError = (msg: string) => {
        if (isRiskMappingSchemaMissing(msg)) {
            setSchemaMissing(true);
        }
        return showRiskMappingErrorAlert(msg);
    };

    const fetchPfds = async (searchTerm?: string, silent = false) => {
        if (!silent) setLoading(true);
        try {
            const params = new URLSearchParams();
            if (searchTerm) params.set('search', searchTerm);
            const res = await fetch(`/api/risk-mapping/pfd${params.toString() ? `?${params}` : ''}`);
            const json = await res.json();
            if (json.success) {
                setPfds(json.data);
                if (json.worker) {
                    setWorkerStatus(json.worker);
                }
                setSchemaMissing(false);
            } else if (!silent) {
                showError(json.error || 'Failed to load PFDs');
            }
        } catch (e: any) {
            if (!silent) showError(e.message);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedPfds.length === 0) return;
        const result = await pAlert({
            type: 'warning',
            title: 'Confirm Batch Delete',
            text: `Delete ${selectedPfds.length} selected drawing(s)? Their file and version history are preserved, but they will be hidden from this list.`,
            showCancelButton: true,
            confirmButtonText: 'Delete Selected',
            cancelButtonText: 'Cancel',
        });
        if (!result.isConfirmed) return;

        setDeletingBatch(true);
        try {
            const res = await fetch('/api/risk-mapping/pfd/batch-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pfd_ids: selectedPfds.map((p) => p.pfd_id) }),
            });
            const json = await res.json();
            if (json.success) {
                setSelectedPfds([]);
                pAlert({
                    type: 'success',
                    title: 'Deleted',
                    text: `Successfully deleted ${json.count} drawing(s).`,
                    timer: 1800,
                    showConfirmButton: false,
                });
                fetchPfds(search);
            } else {
                showError(json.error || 'Batch delete failed');
            }
        } catch (err: any) {
            showError(err.message);
        } finally {
            setDeletingBatch(false);
        }
    };

    const isFirstRender = useRef(true);

    useEffect(() => {
        try {
            sessionStorage.setItem(
                'pfd_table_state',
                JSON.stringify({
                    search,
                    page,
                    pageSize,
                    sortStatus,
                })
            );
        } catch {}
    }, [search, page, pageSize, sortStatus]);

    useEffect(() => {
        fetchPfds(search);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        setPage(1);
    }, [pageSize, search]);

    useEffect(() => {
        const t = setTimeout(() => fetchPfds(search), 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    // Auto-poll PFD list if any document is currently indexing or queued
    useEffect(() => {
        const hasActiveJobs = pfds.some(
            (p) =>
                p.index_job_status === 'RUNNING' ||
                p.index_job_status === 'PENDING' ||
                p.latest_job_status === 'RUNNING' ||
                p.latest_job_status === 'PENDING' ||
                ((p.indexed_pages || 0) > 0 && (p.indexed_pages || 0) < (p.page_count || 1))
        );

        if (!hasActiveJobs) return;

        const timer = setInterval(() => {
            fetchPfds(search, true);
        }, 3000);

        return () => clearInterval(timer);
    }, [pfds, search]);

    useEffect(() => {
        if (!tagSearchQuery.trim() || tagSearchQuery.trim().length < 2) {
            setTagSearchResults([]);
            setTagSearchOpen(false);
            return;
        }

        const t = setTimeout(async () => {
            setTagSearchLoading(true);
            try {
                const res = await fetch(`/api/risk-mapping/pfd-search?q=${encodeURIComponent(tagSearchQuery.trim())}`);
                const data = await res.json();
                if (data.success) {
                    setTagSearchResults(data.data.results || []);
                    setTagSearchOpen(true);
                }
            } catch (err) {
                console.error('Tag search error:', err);
            } finally {
                setTagSearchLoading(false);
            }
        }, 350);

        return () => clearTimeout(t);
    }, [tagSearchQuery]);

    const JOB_STATUS_RANK: Record<string, number> = {
        ERROR: 0,
        RUNNING: 1,
        PENDING: 2,
        NOT_INDEXED: 3,
        DONE: 4,
    };

    const getJobStatusRank = (p: PfdListItem): number => {
        if (p.latest_job_status === 'ERROR') return JOB_STATUS_RANK.ERROR;
        if (p.latest_job_status === 'RUNNING') return JOB_STATUS_RANK.RUNNING;
        if (p.latest_job_status === 'PENDING') return JOB_STATUS_RANK.PENDING;
        if (p.latest_job_status === 'DONE') return JOB_STATUS_RANK.DONE;
        if (p.indexed_pages && p.indexed_pages >= (p.page_count || 1)) return JOB_STATUS_RANK.DONE;
        return JOB_STATUS_RANK.NOT_INDEXED;
    };

    const sortedPfds = useMemo(() => {
        if (!sortStatus.columnAccessor) return pfds;
        const { columnAccessor, direction } = sortStatus;
        const sorted = [...pfds].sort((a, b) => {
            if (columnAccessor === 'pfd_name') {
                const valA = (a.pfd_name || '').toLowerCase();
                const valB = (b.pfd_name || '').toLowerCase();
                return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            if (columnAccessor === 'tagged_assets') {
                const valA = a.tagged_assets_count || 0;
                const valB = b.tagged_assets_count || 0;
                return direction === 'asc' ? valA - valB : valB - valA;
            }

            if (columnAccessor === 'job_status') {
                const rankA = getJobStatusRank(a);
                const rankB = getJobStatusRank(b);
                return direction === 'asc' ? rankA - rankB : rankB - rankA;
            }

            if (columnAccessor === 'description') {
                const valA = (a.description || '').toLowerCase();
                const valB = (b.description || '').toLowerCase();
                return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }

            if (columnAccessor === 'uploaded_at') {
                const valA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
                const valB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
                return direction === 'asc' ? valA - valB : valB - valA;
            }

            return 0;
        });

        return sorted;
    }, [pfds, sortStatus]);

    const totalCount = sortedPfds.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const from = (page - 1) * pageSize;
    const to = Math.min(from + pageSize, totalCount);
    const paged = sortedPfds.slice(from, from + pageSize);

    const getPageNumbers = (currentPage: number, total: number): (number | '...')[] => {
        if (total <= 7) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }
        if (currentPage <= 4) {
            return [1, 2, 3, 4, 5, '...', total];
        }
        if (currentPage >= total - 3) {
            return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }
        return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', total];
    };

    const openUpload = () => {
        setUploadOpen(true);
    };

    const openEdit = (pfd: PfdListItem) => {
        setEditTarget(pfd);
        setEditOpen(true);
    };

    const handleDelete = async (pfd: PfdListItem) => {
        const result = await pAlert({
            type: 'warning',
            title: 'Confirm Delete',
            text: `Delete "${pfd.pfd_name}"? Its file and version history are kept, but it will be hidden from this list.`,
            showCancelButton: true,
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel',
        });
        if (!result.isConfirmed) return;

        setDeletingRowId(pfd.pfd_id);
        try {
            const res = await fetch(`/api/risk-mapping/pfd/${pfd.pfd_id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                fetchPfds(search);
            } else {
                showError(json.error || 'Delete failed');
            }
        } catch (e: any) {
            showError(e.message);
        } finally {
            setDeletingRowId(null);
        }
    };

    const openRevision = (pfd: PfdListItem) => {
        setRevisionTarget(pfd);
        setRevisionOpen(true);
    };

    // Opens the granular Batch Export modal for selected drawings
    const handleExportSelected = () => {
        if (selectedPfds.length === 0) return;
        const exportable = selectedPfds.filter((p) => p.current_version_id);
        if (exportable.length === 0) {
            showError('None of the selected PFDs have an uploaded version to export.');
            return;
        }
        setBatchExportOpen(true);
    };

    const triggerIndex = async (versionId: number, pfdId?: number) => {
        if (pfdId) setPendingIndexIds((prev) => new Set(prev).add(pfdId));
        try {
            const res = await fetch(`/api/risk-mapping/pfd-text/${versionId}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setJobsPanelOpen(true);
                fetchPfds(search);
            } else {
                showError(data.error || 'Failed to trigger indexing');
            }
        } catch (err: any) {
            showError(err.message);
        } finally {
            if (pfdId) {
                setPendingIndexIds((prev) => {
                    const next = new Set(prev);
                    next.delete(pfdId);
                    return next;
                });
            }
        }
    };

    const renderPfdNameCell = (r: PfdListItem) => (
        <div className="space-y-1 py-1 min-w-0">
            <Link
                href={`/risk-analysis/risk-mapping/${r.public_id || r.pfd_id}`}
                className="text-primary hover:underline font-bold text-sm block leading-snug break-words"
                title={r.pfd_name}
            >
                {r.pfd_name}
            </Link>
            {/* Row 1: Version, Doc Number, Revision, Page count */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {/* Version Pill */}
                <span className="font-bold px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                    v{r.version_no || 1}
                </span>
                {/* Storage Location Badge */}
                {r.storage_backend && (
                    <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                            r.storage_backend === 'sharepoint'
                                ? 'bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20'
                                : r.storage_backend === 's3'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                        }`}
                        title={`Stored in ${r.storage_backend === 'sharepoint' ? 'SharePoint' : r.storage_backend === 's3' ? 'S3 Storage' : 'Local Disk'}`}
                    >
                        {r.storage_backend === 'sharepoint' && <Cloud className="h-2.5 w-2.5 shrink-0 text-[#0078D4]" />}
                        {r.storage_backend === 's3' && <Database className="h-2.5 w-2.5 shrink-0 text-amber-500" />}
                        {r.storage_backend === 'local' && <HardDrive className="h-2.5 w-2.5 shrink-0 text-gray-500" />}
                        <span>{r.storage_backend === 'sharepoint' ? 'SP' : r.storage_backend === 's3' ? 'S3' : 'Local'}</span>
                    </span>
                )}
                {/* Document Number */}
                {r.doc_number && (
                    <span className="font-mono text-gray-500 dark:text-gray-400">
                        Doc: <span className="font-semibold text-gray-800 dark:text-gray-200">{r.doc_number}</span>
                    </span>
                )}
                {/* Drawing Revision */}
                {r.drawing_revision && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
                        Rev. {r.drawing_revision}
                    </span>
                )}
                {/* Page count & Drawing Page */}
                {r.page_count && (
                    <span
                        className={`text-[10px] font-medium ${(r.page_count || 1) > 1
                            ? 'bg-primary/5 text-primary px-1.5 py-0.5 rounded border border-primary/20 font-semibold'
                            : 'text-gray-400'
                            }`}
                        title={
                            (r.page_count || 1) > 1
                                ? `Drawing Sheet is set to Page ${r.default_page || 1} of ${r.page_count}`
                                : 'Single page drawing'
                        }
                    >
                        {(r.page_count || 1) > 1 ? `Drawing: p.${r.default_page || 1}/${r.page_count}` : `1 page`}
                    </span>
                )}
            </div>
            {/* Row 2: Linked Asset & Default Risk Model */}
            {(r.asset_name || r.default_model_name) && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-0.5">
                    {/* Linked Asset */}
                    {r.asset_name && (
                        <span
                            className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300 font-medium bg-gray-50 dark:bg-gray-800/60 px-1.5 py-0.5 rounded border border-gray-200/60 dark:border-gray-700 text-[10px]"
                            title={`Linked Asset: ${r.asset_name}`}
                        >
                            <Layers className="h-3 w-3 text-primary/70 shrink-0" />
                            <span>{r.asset_name}</span>
                        </span>
                    )}
                    {/* Default Risk Model */}
                    {r.default_model_name && (
                        <span
                            className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300 font-medium bg-purple-50 dark:bg-purple-950/30 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800/60 text-[10px]"
                            title={`Default Risk Model: ${r.default_model_name}`}
                        >
                            <ShieldAlert className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
                            <span>{r.default_model_name}</span>
                        </span>
                    )}
                </div>
            )}
        </div>
    );

    const renderJobStatusCell = (r: PfdListItem) => {
        const jobType = r.latest_job_type;
        const jobStatus = r.latest_job_status;
        const jobProgress = r.latest_job_progress;
        const jobMsg = r.latest_job_message;
        const pageCount = r.page_count || 1;
        const indexedPages = r.indexed_pages || 0;
        const isFullyIndexed = indexedPages > 0 && indexedPages >= pageCount;

        if (jobStatus === 'RUNNING') {
            return (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary" title={jobMsg || 'Processing...'}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                    <span>
                        {jobType === 'AUTO_DETECT' ? 'Auto-Tagging' : 'Indexing'}
                        {jobProgress != null ? ` (${jobProgress}%)` : '...'}
                    </span>
                </span>
            );
        }

        if (jobStatus === 'PENDING') {
            return (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-500" title={jobMsg || 'Waiting in queue'}>
                    <Clock className="h-3.5 w-3.5 text-amber-500 animate-pulse shrink-0" />
                    <span>Queued ({jobType === 'AUTO_DETECT' ? 'Auto-Tag' : 'Index'})</span>
                </span>
            );
        }

        if (jobStatus === 'ERROR') {
            return (
                <div className="inline-flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger" title={jobMsg || 'Job failed'}>
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Job Failed</span>
                    </span>
                    {isEditor && r.current_version_id && (
                        <button
                            type="button"
                            onClick={() => triggerIndex(r.current_version_id!, r.pfd_id)}
                            disabled={pendingIndexIds.has(r.pfd_id)}
                            className="btn btn-xs btn-outline-danger py-0.5 px-1.5 text-[10px] gap-1"
                            title="Retry job"
                        >
                            {pendingIndexIds.has(r.pfd_id) ? (
                                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            ) : (
                                'Retry'
                            )}
                        </button>
                    )}
                </div>
            );
        }

        if (jobStatus === 'DONE') {
            return (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success" title={jobMsg || 'Completed'}>
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                    <span className="truncate max-w-[140px]">
                        {jobMsg || (jobType === 'AUTO_DETECT' ? 'Auto-Tagged' : isFullyIndexed ? `Indexed (${indexedPages}p)` : 'Finished')}
                    </span>
                </span>
            );
        }

        if (isFullyIndexed) {
            return (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                    <span>Indexed ({indexedPages}p)</span>
                </span>
            );
        }

        return (
            <div className="inline-flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>Not indexed</span>
                </span>
                {isEditor && r.current_version_id && (
                    <button
                        type="button"
                        onClick={() => triggerIndex(r.current_version_id!, r.pfd_id)}
                        disabled={pendingIndexIds.has(r.pfd_id)}
                        className="btn btn-xs btn-outline-primary py-0.5 px-1.5 text-[10px] gap-1"
                        title="Index text layer for searching"
                    >
                        {pendingIndexIds.has(r.pfd_id) ? (
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                        ) : (
                            'Index'
                        )}
                    </button>
                )}
            </div>
        );
    };

    return (
        <div>
            <ul className="mb-6 flex space-x-2 rtl:space-x-reverse">
                <li>
                    <Link href="#" className="text-primary hover:underline">
                        Risk Analysis
                    </Link>
                </li>
                <li className="before:content-['/'] ltr:before:mr-2 rtl:before:ml-2">
                    <span>Risk Mapping</span>
                </li>
            </ul>

            <div className="panel">
                {schemaMissing && (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning-dark dark:text-warning shadow-sm">
                        <div className="flex items-start gap-3">
                            <svg className="h-5 w-5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                                <h6 className="text-sm font-bold">Database Schema Missing (`dbo.rbi_pfd_*`)</h6>
                                <p className="text-xs opacity-90 mt-0.5">
                                    The Risk Mapping tables do not exist in the database. Run <code className="rounded bg-black/10 dark:bg-white/10 px-1.5 py-0.5 font-mono font-bold">npm run db:migrate</code> in your project root terminal to create the tables.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => fetchPfds(search)}
                            className="btn btn-sm btn-outline-warning rounded-lg shrink-0"
                        >
                            Retry Loading
                        </button>
                    </div>
                )}

                <div className="mb-5 space-y-3.5">
                    {/* Top Row: Title + Action Buttons */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <h5 className="text-lg font-bold text-gray-900 dark:text-white-light tracking-tight">Process Flow Diagrams</h5>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => fetchPfds(search)}
                                className="btn btn-outline-primary btn-sm gap-1.5 whitespace-nowrap shadow-2xs"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Refresh</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setJobsPanelOpen(true)}
                                className={`btn btn-sm gap-1.5 whitespace-nowrap shadow-2xs ${workerStatus && !workerStatus.is_active && pfds.some((p) => p.latest_job_status === 'PENDING' || p.latest_job_status === 'RUNNING')
                                    ? 'btn-outline-warning border-amber-400 text-amber-700 dark:text-amber-300'
                                    : 'btn-outline-secondary'
                                    }`}
                                title={workerStatus?.is_active ? 'Background Processing: Active' : 'Background Processing: Paused'}
                            >
                                <span className={`h-2 w-2 rounded-full shrink-0 ${workerStatus?.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                                <Cpu className="h-3.5 w-3.5 text-primary" />
                                <span>Jobs</span>
                                {workerStatus && !workerStatus.is_active && (
                                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">(Paused)</span>
                                )}
                            </button>
                            {isEditor && (
                                <button
                                    type="button"
                                    onClick={() => setBatchUploadOpen(true)}
                                    className="btn btn-outline-primary btn-sm gap-1.5 whitespace-nowrap shadow-2xs"
                                >
                                    <UploadCloud className="h-3.5 w-3.5" />
                                    <span>Batch Upload</span>
                                </button>
                            )}
                            {isEditor && (
                                <button
                                    type="button"
                                    onClick={openUpload}
                                    className="btn btn-primary btn-sm gap-1.5 whitespace-nowrap shadow-xs"
                                >
                                    <Plus className="h-4 w-4" />
                                    <span>Upload New PFD</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Search & Filter Row: 2 Clean Search Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
                        {/* Filter by Drawing / Doc Name */}
                        <div className="relative sm:col-span-1 lg:col-span-5">
                            <input
                                type="text"
                                className="form-input h-9 pl-8 pr-3 text-xs sm:text-sm w-full rounded-lg"
                                placeholder="Filter by PFD or doc name..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                                <Search className="h-4 w-4" />
                            </span>
                        </div>

                        {/* Cross-PFD Global Tag Search */}
                        <div ref={tagSearchContainerRef} className="relative sm:col-span-1 lg:col-span-7">
                            <input
                                type="text"
                                className="form-input h-9 pl-8 pr-7 text-xs sm:text-sm w-full border-primary/40 focus:border-primary rounded-lg shadow-2xs"
                                placeholder="Search tag across drawings (e.g. asset ID, tag name)..."
                                value={tagSearchQuery}
                                onChange={(e) => setTagSearchQuery(e.target.value)}
                                onFocus={() => tagSearchResults.length > 0 && setTagSearchOpen(true)}
                            />
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-primary">
                                <FileSearch className="h-4 w-4" />
                            </span>
                            {tagSearchLoading ? (
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                </span>
                            ) : tagSearchQuery ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTagSearchQuery('');
                                        setTagSearchOpen(false);
                                    }}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            ) : null}

                            {/* Dropdown Results Popover */}
                            {tagSearchOpen && tagSearchResults.length > 0 && (
                                <div className="absolute left-0 right-0 sm:left-auto sm:right-0 top-full mt-1.5 z-50 w-full sm:w-[540px] md:w-[600px] max-w-[calc(100vw-3rem)] rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-[#0e1726] p-3 max-h-[26rem] overflow-y-auto">
                                    <div className="flex items-center justify-between px-2 py-1.5 text-xs font-bold text-gray-500 border-b border-gray-100 dark:border-gray-800">
                                        <span className="flex items-center gap-1.5 text-primary">
                                            <FileSearch className="h-3.5 w-3.5" />
                                            <span>Found in {tagSearchResults.length} drawing location(s)</span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setTagSearchOpen(false)}
                                            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-2 py-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                        >
                                            Close
                                        </button>
                                    </div>
                                    <div className="divide-y divide-gray-100 dark:divide-gray-800 mt-2 space-y-1">
                                        {tagSearchResults.map((hit, i) => (
                                            <Link
                                                key={i}
                                                href={`/risk-analysis/risk-mapping/${hit.public_id || hit.pfd_id}?page=${hit.page_no}&focus_tag=${encodeURIComponent(hit.matched_tag_name || hit.matched_asset_id || tagSearchQuery.trim())}`}
                                                className="block p-3 rounded-xl hover:bg-primary/5 dark:hover:bg-primary/10 transition-all group border border-transparent hover:border-primary/20"
                                            >
                                                <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100 gap-2">
                                                    <span className="group-hover:text-primary truncate">{hit.pfd_name}</span>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span className="text-[11px] rounded-md bg-primary/10 text-primary font-bold px-2 py-0.5 font-mono">
                                                            Page {hit.page_no}
                                                        </span>
                                                        <ExternalLink className="h-3.5 w-3.5 text-gray-400 group-hover:text-primary" />
                                                    </div>
                                                </div>

                                                {/* Tags: Match Source, Doc Number, Rev, Linked Asset */}
                                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                                    {hit.match_source === 'TAG' && (
                                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 shrink-0">
                                                            Tagged Asset
                                                        </span>
                                                    )}
                                                    {hit.match_source === 'CHILD_COMPONENT' && (
                                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0">
                                                            Child Component
                                                        </span>
                                                    )}
                                                    {hit.match_source === 'DOCUMENT' && (
                                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                                            Drawing Asset
                                                        </span>
                                                    )}
                                                    {hit.match_source === 'OCR_TEXT' && (
                                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 shrink-0">
                                                            Text Layer
                                                        </span>
                                                    )}

                                                    {hit.doc_number && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-primary/10 text-primary border border-primary/20 shrink-0">
                                                            <FileText className="h-3 w-3 text-primary shrink-0" />
                                                            <span>{hit.doc_number}</span>
                                                            {hit.drawing_revision && (
                                                                <span className="ml-0.5 px-1 py-0.2 rounded bg-primary/20 text-[9px] uppercase font-bold">
                                                                    Rev. {hit.drawing_revision}
                                                                </span>
                                                            )}
                                                        </span>
                                                    )}
                                                    {!hit.doc_number && hit.drawing_revision && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-primary/10 text-primary border border-primary/20 shrink-0">
                                                            Rev. {hit.drawing_revision}
                                                        </span>
                                                    )}
                                                    {hit.doc_asset_name && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 truncate max-w-[260px]">
                                                            <Link2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                                            <span>{hit.doc_asset_name}</span>
                                                        </span>
                                                    )}
                                                    {hit.version_no && (
                                                        <span className="text-[11px] text-gray-400 font-mono">
                                                            v{hit.version_no}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Match Snippet */}
                                                {hit.snippet && (
                                                    <div className="text-xs text-gray-700 dark:text-gray-300 font-medium mt-1.5 font-mono bg-gray-50 dark:bg-gray-800/70 p-1.5 rounded-md border border-gray-100 dark:border-gray-800/80 break-words">
                                                        {hit.snippet}
                                                    </div>
                                                )}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {workerStatus && !workerStatus.is_active && pfds.some((p) => p.latest_job_status === 'PENDING' || p.latest_job_status === 'RUNNING') && (
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300 animate-in fade-in">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span>
                                <strong>Background Processing is Paused:</strong> Drawings are waiting in queue. Processing will resume automatically once the background service is started.
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setJobsPanelOpen(true)}
                            className="font-semibold underline hover:text-amber-950 dark:hover:text-white shrink-0"
                        >
                            View Queue
                        </button>
                    </div>
                )}

                {selectedPfds.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 px-4 py-2.5">
                        <span className="text-sm font-semibold text-primary">
                            {selectedPfds.length} selected
                        </span>
                        <button
                            type="button"
                            onClick={handleExportSelected}
                            className="btn btn-sm btn-outline-primary gap-1.5 font-semibold shadow-2xs"
                        >
                            <FileDown className="h-3.5 w-3.5" />
                            <span>Export ({selectedPfds.length})</span>
                        </button>
                        {isEditor && (
                            <button
                                type="button"
                                onClick={handleBatchDelete}
                                className="btn btn-sm btn-danger gap-1.5"
                                disabled={deletingBatch}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                {deletingBatch ? 'Deleting...' : 'Delete'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setSelectedPfds([])}
                            className="ml-auto text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                            Clear selection
                        </button>
                    </div>
                )}

                {/* Mobile Card List View (< md) */}
                <div className="block md:hidden space-y-3">
                    {paged.length === 0 ? (
                        <div className="panel rounded-xl border border-gray-200 p-8 text-center dark:border-gray-800 bg-white dark:bg-[#0e1726]">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 mx-auto mb-3">
                                <FileSearch className="h-6 w-6" />
                            </div>
                            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">No Process Flow Diagrams found</p>
                            <p className="text-xs text-gray-400 mt-1">
                                {search ? `No drawings match "${search}". Try clearing or refining your search filter.` : 'No drawings have been added yet.'}
                            </p>
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch('')}
                                    className="btn btn-xs btn-outline-primary mt-3 font-semibold"
                                >
                                    Clear Search Filter
                                </button>
                            )}
                        </div>
                    ) : (
                        paged.map((r) => {
                            const isSelected = selectedPfds.some((p) => p.pfd_id === r.pfd_id);
                            return (
                                <div
                                    key={r.pfd_id}
                                    className={`panel rounded-xl border p-4 transition-all bg-white dark:bg-[#0e1726] ${isSelected
                                        ? 'border-primary/50 bg-primary/5 dark:border-primary/40 dark:bg-primary/10'
                                        : 'border-gray-200 dark:border-gray-800 shadow-sm'
                                        }`}
                                >
                                    {/* Card Header: Checkbox + PFD Name & Metadata */}
                                    <div className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            className="form-checkbox mt-1 text-primary shrink-0"
                                            checked={isSelected}
                                            onChange={() => {
                                                if (isSelected) {
                                                    setSelectedPfds((prev) => prev.filter((p) => p.pfd_id !== r.pfd_id));
                                                } else {
                                                    setSelectedPfds((prev) => [...prev, r]);
                                                }
                                            }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            {renderPfdNameCell(r)}
                                        </div>
                                    </div>

                                    {/* Description */}
                                    {r.description && (
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                            {r.description}
                                        </p>
                                    )}

                                    {/* Middle info: Tags & Job Status */}
                                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-800 pt-2.5">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${(r.tagged_assets_count || 0) > 0
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800'
                                                    : 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700'
                                                    }`}
                                            >
                                                <Tag className="h-3 w-3" />
                                                <span>{r.tagged_assets_count || 0} tag{(r.tagged_assets_count || 0) === 1 ? '' : 's'}</span>
                                            </span>
                                            {renderJobStatusCell(r)}
                                        </div>

                                        <div className="text-[10px] text-gray-400">
                                            {r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString() : ''}
                                        </div>
                                    </div>

                                    {/* Card Actions */}
                                    <div className="mt-3 flex items-center gap-1.5 border-t border-gray-100 dark:border-gray-800 pt-2.5 overflow-x-auto">
                                        <Link
                                            href={`/risk-analysis/risk-mapping/${r.public_id || r.pfd_id}`}
                                            className="btn btn-xs btn-primary flex-1 justify-center text-center font-bold h-7"
                                        >
                                            View
                                        </Link>
                                        {isEditor && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline-primary flex-1 justify-center text-center font-bold h-7"
                                                    onClick={() => openEdit(r)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline-secondary flex-1 justify-center text-center font-bold h-7"
                                                    onClick={() => openRevision(r)}
                                                >
                                                    Revision
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline-danger flex-1 justify-center text-center font-bold h-7"
                                                    onClick={() => handleDelete(r)}
                                                    disabled={deletingRowId === r.pfd_id}
                                                >
                                                    {deletingRowId === r.pfd_id ? 'Deleting...' : 'Delete'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {/* Mobile Pagination Controls */}
                    {totalCount > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                Showing <span className="font-semibold text-gray-800 dark:text-gray-200">{from + 1}</span>–<span className="font-semibold text-gray-800 dark:text-gray-200">{to}</span> of <span className="font-semibold text-gray-800 dark:text-gray-200">{totalCount}</span> drawings
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value));
                                        setPage(1);
                                    }}
                                    className="h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] px-2 py-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-2xs"
                                >
                                    {PAGE_SIZES.map((size) => (
                                        <option key={size} value={size}>
                                            {size} / page
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    disabled={page <= 1}
                                    onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                                    className="btn btn-xs btn-outline-secondary px-2.5 py-1 font-semibold disabled:opacity-30"
                                >
                                    Prev
                                </button>
                                <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                    {page}/{totalPages}
                                </span>
                                <button
                                    type="button"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                                    className="btn btn-xs btn-outline-secondary px-2.5 py-1 font-semibold disabled:opacity-30"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Desktop Table View (>= md) */}
                <div className="hidden md:block datatables rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0e1726] shadow-xs overflow-hidden">
                    <DataTable
                        highlightOnHover
                        className="table-hover whitespace-normal"
                        records={paged}
                        fetching={loading}
                        idAccessor="pfd_id"
                        selectedRecords={selectedPfds}
                        onSelectedRecordsChange={setSelectedPfds}
                        sortStatus={sortStatus}
                        onSortStatusChange={(status) => {
                            setSortStatus(status);
                            setPage(1);
                        }}
                        columns={[
                            {
                                accessor: 'pfd_name',
                                title: 'PFD Drawing',
                                sortable: true,
                                render: (r: PfdListItem) => renderPfdNameCell(r),
                            },
                            {
                                accessor: 'tagged_assets',
                                title: 'Tagged Assets',
                                sortable: true,
                                width: 120,
                                textAlignment: 'center',
                                render: (r: PfdListItem) => {
                                    const tagCount = r.tagged_assets_count || 0;
                                    return (
                                        <div className="flex items-center justify-center">
                                            <span
                                                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${tagCount > 0
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800'
                                                    : 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700'
                                                    }`}
                                            >
                                                <Tag className="h-3.5 w-3.5" />
                                                <span>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>
                                            </span>
                                        </div>
                                    );
                                },
                            },
                            {
                                accessor: 'job_status',
                                title: 'Job Status',
                                sortable: true,
                                width: 150,
                                render: (r: PfdListItem) => renderJobStatusCell(r),
                            },
                            {
                                accessor: 'description',
                                title: 'Description',
                                sortable: true,
                                render: (r: PfdListItem) => (
                                    <div className="text-gray-500 dark:text-gray-400 text-xs break-words line-clamp-2" title={r.description || ''}>
                                        {r.description || '—'}
                                    </div>
                                ),
                            },
                            {
                                accessor: 'uploaded_at',
                                title: 'Uploaded',
                                sortable: true,
                                width: 145,
                                render: (r: PfdListItem) => (
                                    <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap pr-2">
                                        <div className="font-medium text-gray-800 dark:text-gray-200">
                                            {r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString('en-GB') : '—'}
                                        </div>
                                        <div className="text-[11px] text-gray-400 truncate max-w-[130px]" title={r.created_by ? `by ${r.created_by}` : ''}>
                                            by {r.created_by || '—'}
                                        </div>
                                    </div>
                                ),
                            },
                            {
                                accessor: 'actions',
                                title: 'Actions',
                                sortable: false,
                                textAlignment: 'right',
                                titleClassName: '!text-right',
                                width: isEditor ? 275 : 90,
                                render: (r: PfdListItem) => (
                                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap pl-1">
                                        <Link
                                            href={`/risk-analysis/risk-mapping/${r.public_id || r.pfd_id}`}
                                            className="btn btn-xs btn-primary h-7 px-3 justify-center text-center font-bold shrink-0"
                                        >
                                            View
                                        </Link>
                                        {isEditor && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline-primary h-7 px-2.5 justify-center text-center font-bold shrink-0"
                                                    onClick={() => openEdit(r)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline-secondary h-7 px-2.5 justify-center text-center font-bold shrink-0"
                                                    onClick={() => openRevision(r)}
                                                >
                                                    Revision
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline-danger h-7 px-2.5 justify-center text-center font-bold shrink-0"
                                                    onClick={() => handleDelete(r)}
                                                    disabled={deletingRowId === r.pfd_id}
                                                >
                                                    {deletingRowId === r.pfd_id ? 'Deleting...' : 'Delete'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ),
                            },
                        ]}
                        minHeight={280}
                        noRecordsText="No Process Flow Diagrams found"
                        emptyState={
                            <div className="flex flex-col items-center justify-center p-8 text-center select-none pointer-events-auto">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 mb-3">
                                    <FileSearch className="h-6 w-6" />
                                </div>
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">No Process Flow Diagrams found</p>
                                <p className="text-xs text-gray-400 mt-1 max-w-sm">
                                    {search ? `No drawings match "${search}". Try clearing or refining your search filter.` : 'No drawings have been added yet.'}
                                </p>
                                {search && (
                                    <button
                                        type="button"
                                        onClick={() => setSearch('')}
                                        className="btn btn-xs btn-outline-primary mt-3 font-semibold pointer-events-auto"
                                    >
                                        Clear Search Filter
                                    </button>
                                )}
                            </div>
                        }
                    />

                    {/* Desktop Custom Pagination Footer */}
                    {totalCount > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-[#0a1220]/50 px-4 py-3">
                            {/* Record Count */}
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                Showing <span className="font-semibold text-gray-800 dark:text-gray-200">{from + 1}</span> to <span className="font-semibold text-gray-800 dark:text-gray-200">{to}</span> of <span className="font-semibold text-gray-800 dark:text-gray-200">{totalCount}</span> drawings
                            </div>

                            {/* Page Size Selector */}
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <span>Rows per page:</span>
                                <select
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value));
                                        setPage(1);
                                    }}
                                    className="h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-2xs hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer transition-colors"
                                >
                                    {PAGE_SIZES.map((size) => (
                                        <option key={size} value={size} className="bg-white dark:bg-[#0e1726] text-gray-800 dark:text-gray-200">
                                            {size}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Page Controls */}
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    disabled={page <= 1}
                                    onClick={() => setPage(1)}
                                    className="h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors shadow-2xs"
                                    title="First Page"
                                >
                                    <ChevronsLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    disabled={page <= 1}
                                    onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                                    className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1 transition-colors shadow-2xs"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    <span>Prev</span>
                                </button>

                                <div className="flex items-center gap-1 mx-1">
                                    {getPageNumbers(page, totalPages).map((p, idx) =>
                                        p === '...' ? (
                                            <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-400 select-none">
                                                ...
                                            </span>
                                        ) : (
                                            <button
                                                key={`page-${p}`}
                                                type="button"
                                                onClick={() => setPage(p as number)}
                                                className={`h-8 min-w-[32px] px-2 rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center justify-center ${p === page
                                                    ? 'bg-primary text-white border border-primary'
                                                    : 'border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                                                    }`}
                                            >
                                                {p}
                                            </button>
                                        )
                                    )}
                                </div>

                                <button
                                    type="button"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                                    className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1 transition-colors shadow-2xs"
                                >
                                    <span>Next</span>
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage(totalPages)}
                                    className="h-8 w-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121e32] text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors shadow-2xs"
                                    title="Last Page"
                                >
                                    <ChevronsRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Upload New Drawing Modal */}
            <UploadDrawingModal
                isOpen={uploadOpen}
                onClose={() => setUploadOpen(false)}
                onSuccess={() => {
                    fetchPfds(search);
                    setJobsPanelOpen(true);
                }}
            />

            {/* Edit Modal */}
            {editOpen && editTarget && (
                <EditDrawingModal
                    isOpen={editOpen}
                    onClose={() => setEditOpen(false)}
                    pfd={editTarget}
                    onSaved={() => {
                        fetchPfds(search);
                    }}
                />
            )}

            {/* New Revision Modal */}
            <UploadRevisionModal
                isOpen={revisionOpen}
                onClose={() => setRevisionOpen(false)}
                pfd={revisionTarget}
                onSuccess={() => {
                    fetchPfds(search);
                    setJobsPanelOpen(true);
                }}
            />

            {/* Batch Upload Modal */}
            <BatchUploadModal
                isOpen={batchUploadOpen}
                onClose={() => setBatchUploadOpen(false)}
                onSuccess={() => {
                    fetchPfds(search);
                    setJobsPanelOpen(true);
                }}
            />

            {/* Batch Export Modal */}
            {batchExportOpen && selectedPfds.length > 0 && (
                <BatchExportModal
                    isOpen={batchExportOpen}
                    onClose={() => setBatchExportOpen(false)}
                    selectedPfds={selectedPfds}
                    onSuccess={() => {
                        setSelectedPfds([]);
                    }}
                />
            )}

            {/* Background Jobs Progress Panel */}
            <JobsPanel
                isOpen={jobsPanelOpen}
                onOpen={() => setJobsPanelOpen(true)}
                onClose={() => setJobsPanelOpen(false)}
            />
        </div>
    );
}