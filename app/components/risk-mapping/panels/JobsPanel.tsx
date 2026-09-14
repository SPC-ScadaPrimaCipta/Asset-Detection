'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    CheckCircle2,
    Loader2,
    Clock,
    AlertCircle,
    RefreshCw,
    X,
    Minus,
    Maximize2,
    Cpu,
    RotateCcw,
} from 'lucide-react';

export interface BackgroundJobItem {
    job_id: string;
    job_type: 'TEXT_INDEX' | 'AUTO_DETECT';
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR';
    ref_id: number | null;
    payload: string | null;
    progress_pct: number;
    message: string | null;
    error_detail: string | null;
    created_by: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
}

interface JobsPanelProps {
    isOpen?: boolean;
    onOpen?: () => void;
    onClose?: () => void;
}

function formatJobTime(isoString: string | null): string {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    } catch {
        return '';
    }
}

function formatRelativeTime(isoString: string | null): string {
    if (!isoString) return '';
    try {
        const diffMs = Date.now() - new Date(isoString).getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 5) return 'just now';
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    } catch {
        return '';
    }
}

function formatDuration(startIso: string | null, finishIso: string | null): string {
    if (!startIso || !finishIso) return '';
    try {
        const ms = new Date(finishIso).getTime() - new Date(startIso).getTime();
        if (ms < 0) return '';
        if (ms < 1000) return `${ms}ms`;
        const sec = (ms / 1000).toFixed(1);
        return `${sec}s`;
    } catch {
        return '';
    }
}

export default function JobsPanel({ isOpen: controlledIsOpen, onOpen, onClose }: JobsPanelProps) {
    const [jobs, setJobs] = useState<BackgroundJobItem[]>([]);
    const [workerStatus, setWorkerStatus] = useState<{ is_active: boolean; last_heartbeat: string | null; seconds_ago: number | null } | null>(null);
    const [loading, setLoading] = useState(false);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [retryingAll, setRetryingAll] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [internalOpen, setInternalOpen] = useState(false);
    const hasFetchedRef = useRef(false);

    const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

    const fetchJobs = useCallback(async (showLoading = false) => {
        try {
            if (showLoading) setLoading(true);
            const res = await fetch('/api/risk-mapping/jobs?limit=25');
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                setJobs(data.data);
                if (data.worker) {
                    setWorkerStatus(data.worker);
                }
            }
        } catch (err) {
            console.error('Failed to fetch background jobs:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial background fetch to populate activeCount and cache
    useEffect(() => {
        if (!hasFetchedRef.current) {
            hasFetchedRef.current = true;
            fetchJobs(false);
        }
    }, [fetchJobs]);

    // Active polling when open
    useEffect(() => {
        if (!isOpen) return;

        fetchJobs(jobs.length === 0);

        const timer = setInterval(() => {
            fetchJobs(false);
        }, 3000);

        return () => clearInterval(timer);
    }, [isOpen, fetchJobs, jobs.length]);

    const handleRetry = async (jobId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setRetryingId(jobId);
        try {
            const res = await fetch(`/api/risk-mapping/jobs/${jobId}/retry`, {
                method: 'POST',
            });
            const data = await res.json();
            if (data.success) {
                await fetchJobs(false);
            }
        } catch (err) {
            console.error('Failed to retry job:', err);
        } finally {
            setRetryingId(null);
        }
    };

    const handleRetryAll = async () => {
        if (errorCount === 0 || retryingAll) return;
        setRetryingAll(true);
        try {
            const res = await fetch('/api/risk-mapping/jobs/retry-all', {
                method: 'POST',
            });
            const data = await res.json();
            if (data.success) {
                await fetchJobs(false);
            }
        } catch (err) {
            console.error('Failed to retry all jobs:', err);
        } finally {
            setRetryingAll(false);
        }
    };

    const activeCount = jobs.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING').length;
    const errorCount = jobs.filter((j) => j.status === 'ERROR').length;
    const isServiceOffline = workerStatus && !workerStatus.is_active;

    // Trigger pill button when panel is closed: ONLY show if there are active jobs in progress!
    if (!isOpen) {
        if (activeCount === 0) return null;

        return (
            <button
                type="button"
                onClick={() => {
                    setIsMinimized(false);
                    if (onOpen) onOpen();
                    else setInternalOpen(true);
                }}
                className={`fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold shadow-xl transition-all cursor-pointer ${
                    isServiceOffline
                        ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
                        : 'border-primary/30 bg-white text-gray-700 hover:bg-gray-50 dark:border-primary/40 dark:bg-gray-800 dark:text-gray-200 animate-bounce'
                }`}
                title={isServiceOffline ? 'Background service is paused' : 'View background jobs in progress'}
            >
                {isServiceOffline ? (
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                ) : (
                    <Cpu className="h-4 w-4 text-primary shrink-0" />
                )}
                <span>{isServiceOffline ? 'Processing Paused' : 'Jobs'}</span>
                <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
                    isServiceOffline ? 'bg-amber-600' : 'bg-primary'
                }`}>
                    {activeCount}
                </span>
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-[90] w-full max-w-xl sm:max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-[#0e1726] transition-all">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/60">
                <div className="flex items-center gap-2.5">
                    <Cpu className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-bold text-gray-800 dark:text-white">Background Jobs</span>
                    {workerStatus && (
                        <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                workerStatus.is_active
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                            }`}
                            title={workerStatus.is_active ? 'Background processing service is running' : 'Background processing service is not running'}
                        >
                            <span className={`h-1.5 w-1.5 rounded-full ${workerStatus.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                            <span>{workerStatus.is_active ? 'Service Active' : 'Service Paused'}</span>
                        </span>
                    )}
                    {activeCount > 0 && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary animate-pulse">
                            {activeCount} active
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {errorCount > 0 && (
                        <button
                            type="button"
                            onClick={handleRetryAll}
                            disabled={retryingAll}
                            className="btn btn-xs btn-outline-danger gap-1.5 font-bold py-1 px-2.5 text-[11px] rounded-lg"
                            title="Retry all failed jobs"
                        >
                            <RotateCcw className={`h-3.5 w-3.5 ${retryingAll ? 'animate-spin' : ''}`} />
                            <span>{retryingAll ? 'Retrying...' : `Retry All Failed (${errorCount})`}</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => fetchJobs(true)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-200/60 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-200/60 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
                        title={isMinimized ? 'Expand' : 'Minimize'}
                    >
                        {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (onClose) onClose();
                            else setInternalOpen(false);
                        }}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-200/60 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
                        title="Close"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Body */}
            {!isMinimized && (
                <div>
                    {isServiceOffline && (
                        <div className="mx-4 mt-3 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                                <div className="font-bold">Background Service is Paused</div>
                                <div className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
                                    Jobs will remain queued until the background processing service is running.
                                </div>
                            </div>
                        </div>
                    )}
                <div className="max-h-[30rem] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 text-xs">
                    {loading && jobs.length === 0 ? (
                        <div className="p-8 text-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Loading background jobs...</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">Fetching job queue status</div>
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="p-8 text-center">
                            <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400">
                                <Cpu className="h-4 w-4" />
                            </div>
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">No Background Jobs Found</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">Jobs will appear when drawings are uploaded or indexed</div>
                        </div>
                    ) : (
                        jobs.map((job) => {
                            const isRunning = job.status === 'RUNNING';
                            const isDone = job.status === 'DONE';
                            const isError = job.status === 'ERROR';
                            const isPending = job.status === 'PENDING';

                            let payloadLabel = '';
                            if (job.payload) {
                                try {
                                    const parsed = JSON.parse(job.payload);
                                    if (parsed.version_id) payloadLabel = `Version #${parsed.version_id}`;
                                } catch {
                                    // ignore
                                }
                            }

                            return (
                                <div key={job.job_id} className="p-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-start gap-2 min-w-0">
                                            {isRunning && <Loader2 className="h-4 w-4 shrink-0 text-primary animate-spin mt-0.5" />}
                                            {isDone && <CheckCircle2 className="h-4 w-4 shrink-0 text-success mt-0.5" />}
                                            {isError && <AlertCircle className="h-4 w-4 shrink-0 text-danger mt-0.5" />}
                                            {isPending && <Clock className="h-4 w-4 shrink-0 text-amber-500 animate-pulse mt-0.5" />}

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200 truncate">
                                                    <span>
                                                        {job.job_type === 'TEXT_INDEX'
                                                            ? 'PDF Text Indexing'
                                                            : job.job_type === 'AUTO_DETECT'
                                                            ? 'Auto-Tagging & Mapping'
                                                            : job.job_type}
                                                    </span>
                                                    {payloadLabel && (
                                                        <span className="text-[10px] font-normal text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 rounded">
                                                            {payloadLabel}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                                    {job.message || (isDone ? 'Completed' : isPending ? 'Waiting in queue...' : 'Processing...')}
                                                </div>

                                                {/* Timestamp & Timing */}
                                                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                                                    <span className="inline-flex items-center gap-1">
                                                        <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                                                        <span>{formatJobTime(job.created_at)}</span>
                                                        {job.created_at && (
                                                            <span className="text-gray-400 font-medium">({formatRelativeTime(job.created_at)})</span>
                                                        )}
                                                    </span>
                                                    {job.started_at && job.finished_at && (
                                                        <span>• Duration: {formatDuration(job.started_at, job.finished_at)}</span>
                                                    )}
                                                    {job.created_by && job.created_by !== 'system' && (
                                                        <span>• by {job.created_by}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                            {isDone && (
                                                <span className="text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.5 rounded">
                                                    Done
                                                </span>
                                            )}
                                            {isPending && (
                                                <span className="text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                                    Queued
                                                </span>
                                            )}
                                            {isRunning && (
                                                <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded animate-pulse">
                                                    {job.progress_pct}%
                                                </span>
                                            )}
                                            {isError && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleRetry(job.job_id, e)}
                                                    disabled={retryingId === job.job_id}
                                                    className="btn btn-xs btn-outline-danger gap-1 px-2 py-0.5 text-[10px]"
                                                >
                                                    <RefreshCw className={`h-3 w-3 ${retryingId === job.job_id ? 'animate-spin' : ''}`} />
                                                    Retry
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Progress bar for RUNNING state */}
                                    {isRunning && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <div className="h-1.5 flex-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                                <div
                                                    className="h-full bg-primary rounded-full transition-all duration-300"
                                                    style={{ width: `${Math.max(10, job.progress_pct)}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 shrink-0">
                                                {job.progress_pct}%
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
                </div>
            )}
        </div>
    );
}
