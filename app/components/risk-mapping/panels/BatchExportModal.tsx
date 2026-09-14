'use client';

import { useState, useMemo, useEffect } from 'react';
import {
    FileDown,
    FileText,
    Files,
    ShieldAlert,
    CheckCircle2,
    Layers,
    Loader2,
    ChevronDown,
    ChevronUp,
    Layers2,
    CheckSquare,
    Square,
    GripVertical,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUpDown,
    RotateCcw,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { pAlert } from '../../../lib/riskMappingAlert';

export interface BatchExportItemData {
    pfd_id: number;
    public_id?: string | null;
    pfd_name: string;
    description?: string | null;
    asset_id?: number | null;
    asset_name?: string | null;
    current_version_id?: number | null;
    doc_number?: string | null;
    drawing_revision?: string | null;
    drawing_title?: string | null;
    default_page?: number | null;
    page_count?: number | null;
    file_name?: string | null;
    default_rbim_id?: number | null;
    default_model_name?: string | null;
}

export interface BatchExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedPfds: BatchExportItemData[];
    onSuccess?: () => void;
}

type OutputMode = 'MERGED_PDF' | 'INDEPENDENT';
type PageScope = 'DEFAULT_ONLY' | 'ALL_PAGES' | 'CUSTOM';

export default function BatchExportModal({
    isOpen,
    onClose,
    selectedPfds,
    onSuccess,
}: BatchExportModalProps) {
    const [outputMode, setOutputMode] = useState<OutputMode>('MERGED_PDF');
    const [pageScope, setPageScope] = useState<PageScope>('DEFAULT_ONLY');
    const [includeSummaryIndex, setIncludeSummaryIndex] = useState(true);

    // Ordered list of PFDs (user-adjustable)
    const [orderedPfds, setOrderedPfds] = useState<BatchExportItemData[]>(selectedPfds);
    const [draggedPfdIndex, setDraggedPfdIndex] = useState<number | null>(null);

    // Map of pfd_id -> Ordered list of selected page numbers (1-indexed)
    const [customPageMap, setCustomPageMap] = useState<Record<number, number[]>>({});
    const [expandedPfdIds, setExpandedPfdIds] = useState<Set<number>>(new Set());

    // Exporting progress state
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState<{
        current: number;
        total: number;
        message: string;
    }>({ current: 0, total: 0, message: '' });

    // Synchronize ordered PFDs and initial custom pages whenever selectedPfds changes
    useEffect(() => {
        setOrderedPfds(selectedPfds);
        const initialMap: Record<number, number[]> = {};
        selectedPfds.forEach((pfd) => {
            const pageCount = pfd.page_count || 1;
            const defPage = pfd.default_page || 1;
            if (pageScope === 'ALL_PAGES') {
                initialMap[pfd.pfd_id] = Array.from({ length: pageCount }, (_, i) => i + 1);
            } else {
                initialMap[pfd.pfd_id] = [defPage];
            }
        });
        setCustomPageMap(initialMap);
    }, [selectedPfds]);

    const handlePageScopeChange = (newScope: PageScope) => {
        setPageScope(newScope);
        const nextMap: Record<number, number[]> = {};
        orderedPfds.forEach((pfd) => {
            const pageCount = pfd.page_count || 1;
            const defPage = pfd.default_page || 1;
            if (newScope === 'ALL_PAGES') {
                nextMap[pfd.pfd_id] = Array.from({ length: pageCount }, (_, i) => i + 1);
            } else {
                // DEFAULT_ONLY and CUSTOM both preselect to the default_page!
                nextMap[pfd.pfd_id] = [defPage];
            }
        });
        setCustomPageMap(nextMap);

        if (newScope === 'CUSTOM') {
            // Auto-expand multi-page drawings so checkboxes are immediately visible
            const multiPageIds = orderedPfds
                .filter((p) => (p.page_count || 1) > 1)
                .map((p) => p.pfd_id);
            setExpandedPfdIds(new Set(multiPageIds));
        }
    };

    // PFD Ordering Handlers
    const movePfdUp = (index: number) => {
        if (index <= 0) return;
        setOrderedPfds((prev) => {
            const next = [...prev];
            const [item] = next.splice(index, 1);
            next.splice(index - 1, 0, item);
            return next;
        });
    };

    const movePfdDown = (index: number) => {
        if (index >= orderedPfds.length - 1) return;
        setOrderedPfds((prev) => {
            const next = [...prev];
            const [item] = next.splice(index, 1);
            next.splice(index + 1, 0, item);
            return next;
        });
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedPfdIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (draggedPfdIndex === null || draggedPfdIndex === targetIndex) return;
        setOrderedPfds((prev) => {
            const next = [...prev];
            const [draggedItem] = next.splice(draggedPfdIndex, 1);
            next.splice(targetIndex, 0, draggedItem);
            return next;
        });
        setDraggedPfdIndex(null);
    };

    const handleSortByDocNo = () => {
        setOrderedPfds((prev) =>
            [...prev].sort((a, b) =>
                (a.doc_number || a.pfd_name).localeCompare(b.doc_number || b.pfd_name)
            )
        );
    };

    const handleSortByName = () => {
        setOrderedPfds((prev) =>
            [...prev].sort((a, b) => a.pfd_name.localeCompare(b.pfd_name))
        );
    };

    const handleResetOrder = () => {
        setOrderedPfds(selectedPfds);
    };

    // Page Toggling & Ordering within a PFD
    const togglePfdExpand = (pfdId: number) => {
        setExpandedPfdIds((prev) => {
            const next = new Set(prev);
            if (next.has(pfdId)) next.delete(pfdId);
            else next.add(pfdId);
            return next;
        });
    };

    const handleTogglePage = (pfdId: number, pageNo: number) => {
        setCustomPageMap((prev) => {
            const current = prev[pfdId] || [];
            const exists = current.includes(pageNo);
            let nextPages: number[];
            if (exists) {
                // Keep at least 1 page selected
                if (current.length === 1) return prev;
                nextPages = current.filter((p) => p !== pageNo);
            } else {
                nextPages = [...current, pageNo];
            }
            return { ...prev, [pfdId]: nextPages };
        });
    };

    const movePageEarlier = (pfdId: number, pageIndex: number) => {
        if (pageIndex <= 0) return;
        setCustomPageMap((prev) => {
            const current = [...(prev[pfdId] || [])];
            const [p] = current.splice(pageIndex, 1);
            current.splice(pageIndex - 1, 0, p);
            return { ...prev, [pfdId]: current };
        });
    };

    const movePageLater = (pfdId: number, pageIndex: number) => {
        setCustomPageMap((prev) => {
            const current = [...(prev[pfdId] || [])];
            if (pageIndex >= current.length - 1) return prev;
            const [p] = current.splice(pageIndex, 1);
            current.splice(pageIndex + 1, 0, p);
            return { ...prev, [pfdId]: current };
        });
    };

    const handleSelectAllPagesForPfd = (pfdId: number, pageCount: number) => {
        setCustomPageMap((prev) => ({
            ...prev,
            [pfdId]: Array.from({ length: pageCount }, (_, i) => i + 1),
        }));
    };

    const handleSelectDefaultPageForPfd = (pfdId: number, defPage: number) => {
        setCustomPageMap((prev) => ({
            ...prev,
            [pfdId]: [defPage],
        }));
    };

    // Calculate total pages across all ordered drawings (drawing sheets)
    const totalDrawingPages = useMemo(() => {
        return orderedPfds.reduce((sum, pfd) => {
            const pages = customPageMap[pfd.pfd_id] || [pfd.default_page || 1];
            return sum + pages.length;
        }, 0);
    }, [orderedPfds, customPageMap]);

    // Calculate summary cover page count (1 page per 10 items)
    const coverPagesCount = useMemo(() => {
        if (outputMode !== 'MERGED_PDF' || !includeSummaryIndex || orderedPfds.length === 0) {
            return 0;
        }
        return Math.max(1, Math.ceil(orderedPfds.length / 10));
    }, [outputMode, includeSummaryIndex, orderedPfds.length]);

    // Total pages in the final document
    const totalPdfPages = totalDrawingPages + coverPagesCount;

    const handleStartExport = async () => {
        const validPfds = orderedPfds.filter((p) => p.current_version_id);
        if (validPfds.length === 0) {
            pAlert({
                type: 'warning',
                title: 'No Valid Drawings',
                text: 'None of the selected drawings have an active uploaded version.',
            });
            return;
        }

        setIsExporting(true);
        setExportProgress({
            current: 0,
            total: validPfds.length,
            message: outputMode === 'MERGED_PDF' ? 'Generating consolidated PDF...' : 'Starting export...',
        });

        try {
            if (outputMode === 'MERGED_PDF') {
                // Build items array following the exact adjusted order of PFDs and pages
                const items = validPfds.map((pfd) => ({
                    pfd_id: pfd.pfd_id,
                    version_id: pfd.current_version_id!,
                    pages: customPageMap[pfd.pfd_id] || [pfd.default_page || 1],
                }));

                setExportProgress({
                    current: 1,
                    total: 1,
                    message: `Processing ${validPfds.length} drawing(s) (${totalPdfPages} total pages)...`,
                });

                const res = await fetch('/api/risk-mapping/batch-export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mode: 'MERGED_PDF',
                        includeSummaryIndex: includeSummaryIndex,
                        items,
                    }),
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || `Export failed with status ${res.status}`);
                }

                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const nowStr = new Date().toISOString().slice(0, 10);
                a.download = `Consolidated_Risk_Mapping_${nowStr}.pdf`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);

                pAlert({
                    type: 'success',
                    title: 'Export Completed',
                    text: `Consolidated PDF successfully created with ${validPfds.length} drawings and ${totalPdfPages} total pages in your custom order.`,
                    timer: 2500,
                    showConfirmButton: false,
                });

                onSuccess?.();
                onClose();
            } else {
                // Independent PDF files mode: stream each file sequentially in the custom order
                let successCount = 0;
                for (let i = 0; i < validPfds.length; i++) {
                    const pfd = validPfds[i];
                    const pages = customPageMap[pfd.pfd_id] || [pfd.default_page || 1];

                    setExportProgress({
                        current: i + 1,
                        total: validPfds.length,
                        message: `Exporting drawing ${i + 1} of ${validPfds.length}: ${pfd.doc_number || pfd.pfd_name}...`,
                    });

                    try {
                        const res = await fetch('/api/risk-mapping/batch-export', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                mode: 'INDEPENDENT',
                                includeSummaryIndex: false,
                                items: [
                                    {
                                        pfd_id: pfd.pfd_id,
                                        version_id: pfd.current_version_id!,
                                        pages,
                                    },
                                ],
                            }),
                        });

                        if (res.ok) {
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            const prefix = String(i + 1).padStart(2, '0');
                            const baseName = (pfd.doc_number || pfd.file_name || pfd.pfd_name).replace(/\.pdf$/i, '');
                            a.download = `${prefix}_${baseName}_Risk_Mapping.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                            successCount++;
                        }
                    } catch (itemErr) {
                        console.error(`Failed to export PFD ${pfd.pfd_id}`, itemErr);
                    }

                    // Small pause to allow browser download stream queue to process smoothly
                    await new Promise((r) => setTimeout(r, 400));
                }

                pAlert({
                    type: 'success',
                    title: 'Batch Export Completed',
                    text: `Successfully downloaded ${successCount} individual PDF file(s).`,
                    timer: 2500,
                    showConfirmButton: false,
                });

                onSuccess?.();
                onClose();
            }
        } catch (error: any) {
            console.error('Batch export error:', error);
            pAlert({
                type: 'error',
                title: 'Export Failed',
                text: error.message || 'An error occurred while generating the PDF export.',
            });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={isExporting ? () => {} : onClose}
            title="Batch Export Risk Mapping"
            subtitle="Configure granular pages, sequence order &amp; output options for selected drawings"
            icon={<FileDown className="h-5 w-5 text-primary" />}
            size="3xl"
            footer={
                <div className="flex items-center justify-between w-full">
                    <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                        {outputMode === 'MERGED_PDF' && coverPagesCount > 0 ? (
                            <>
                                {orderedPfds.length} drawing(s) • <span className="font-bold text-primary">{totalPdfPages} total pages</span> ({totalDrawingPages} drawing sheet{totalDrawingPages === 1 ? '' : 's'} + {coverPagesCount} summary sheet)
                            </>
                        ) : (
                            <>
                                {orderedPfds.length} drawing(s) • <span className="font-bold text-primary">{totalDrawingPages} total page(s)</span>
                            </>
                        )}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-outline-secondary btn-sm px-4 rounded-lg"
                            disabled={isExporting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleStartExport}
                            className="btn btn-primary btn-sm px-5 rounded-lg shadow-sm font-semibold flex items-center gap-2"
                            disabled={isExporting || orderedPfds.length === 0}
                        >
                            {isExporting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Exporting...</span>
                                </>
                            ) : (
                                <>
                                    <FileDown className="h-4 w-4" />
                                    <span>Start Export</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4 max-h-[72vh] overflow-y-auto custom-scroll pr-1">
                {/* 1. Output Choice (Segmented Cards) */}
                <div>
                    <label className="mb-2 block text-xs font-bold text-gray-800 dark:text-gray-200">
                        1. Output File Format
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setOutputMode('MERGED_PDF')}
                            disabled={isExporting}
                            className={`relative flex items-start gap-3.5 p-4 rounded-xl border-2 text-left transition-all ${
                                outputMode === 'MERGED_PDF'
                                    ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-xs'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-[#0e1726]'
                            }`}
                        >
                            <div
                                className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                                    outputMode === 'MERGED_PDF'
                                        ? 'bg-primary text-white shadow-xs'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                }`}
                            >
                                <FileText className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0 pr-4">
                                <div className={`text-sm font-bold ${outputMode === 'MERGED_PDF' ? 'text-primary dark:text-primary' : 'text-gray-900 dark:text-white'}`}>
                                    Single Merged PDF File
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                    Combines all drawings in your custom sequence into 1 consolidated PDF report.
                                </div>
                            </div>
                            {outputMode === 'MERGED_PDF' && (
                                <div className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
                                    <CheckCircle2 className="h-4 w-4" />
                                </div>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setOutputMode('INDEPENDENT')}
                            disabled={isExporting}
                            className={`relative flex items-start gap-3.5 p-4 rounded-xl border-2 text-left transition-all ${
                                outputMode === 'INDEPENDENT'
                                    ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-xs'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-[#0e1726]'
                            }`}
                        >
                            <div
                                className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                                    outputMode === 'INDEPENDENT'
                                        ? 'bg-primary text-white shadow-xs'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                }`}
                            >
                                <Files className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0 pr-4">
                                <div className={`text-sm font-bold ${outputMode === 'INDEPENDENT' ? 'text-primary dark:text-primary' : 'text-gray-900 dark:text-white'}`}>
                                    Independent PDF Files
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                    Downloads numbered individual <span className="font-mono">.pdf</span> files in sequential order.
                                </div>
                            </div>
                            {outputMode === 'INDEPENDENT' && (
                                <div className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary text-white flex items-center justify-center shadow-xs">
                                    <CheckCircle2 className="h-4 w-4" />
                                </div>
                            )}
                        </button>
                    </div>
                </div>

                {/* 2. Page Scope Selection */}
                <div>
                    <label className="mb-2 block text-xs font-bold text-gray-800 dark:text-gray-200">
                        2. Page Granularity
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <label
                            className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-xs font-medium cursor-pointer transition-all ${
                                pageScope === 'DEFAULT_ONLY'
                                    ? 'border-primary bg-primary/5 text-primary font-bold shadow-xs'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#0e1726] hover:border-gray-300'
                            }`}
                        >
                            <input
                                type="radio"
                                name="pageScope"
                                value="DEFAULT_ONLY"
                                checked={pageScope === 'DEFAULT_ONLY'}
                                onChange={() => handlePageScopeChange('DEFAULT_ONLY')}
                                disabled={isExporting}
                                className="form-radio text-primary"
                            />
                            <span>Default Sheet Only</span>
                        </label>

                        <label
                            className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-xs font-medium cursor-pointer transition-all ${
                                pageScope === 'ALL_PAGES'
                                    ? 'border-primary bg-primary/5 text-primary font-bold shadow-xs'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#0e1726] hover:border-gray-300'
                            }`}
                        >
                            <input
                                type="radio"
                                name="pageScope"
                                value="ALL_PAGES"
                                checked={pageScope === 'ALL_PAGES'}
                                onChange={() => handlePageScopeChange('ALL_PAGES')}
                                disabled={isExporting}
                                className="form-radio text-primary"
                            />
                            <span>All Drawing Pages</span>
                        </label>

                        <label
                            className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-xs font-medium cursor-pointer transition-all ${
                                pageScope === 'CUSTOM'
                                    ? 'border-primary bg-primary/5 text-primary font-bold shadow-xs'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#0e1726] hover:border-gray-300'
                            }`}
                        >
                            <input
                                type="radio"
                                name="pageScope"
                                value="CUSTOM"
                                checked={pageScope === 'CUSTOM'}
                                onChange={() => handlePageScopeChange('CUSTOM')}
                                disabled={isExporting}
                                className="form-radio text-primary"
                            />
                            <span>Custom Page Selection</span>
                        </label>
                    </div>
                </div>

                {/* 3. Optional Cover / Index Summary Sheet (Only for Merged PDF) */}
                {outputMode === 'MERGED_PDF' && (
                    <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                className="form-checkbox text-primary rounded mt-0.5 cursor-pointer h-4 w-4"
                                checked={includeSummaryIndex}
                                onChange={(e) => setIncludeSummaryIndex(e.target.checked)}
                                disabled={isExporting}
                            />
                            <div>
                                <span className="text-xs font-bold text-gray-900 dark:text-white">
                                    Include Executive Summary &amp; Table of Contents Sheet
                                </span>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                                    Prepends a clean cover sheet with drawing numbers, revisions, linked assets, applied risk models, and sheet index in your exact chosen order.
                                </p>
                            </div>
                        </label>
                    </div>
                )}

                {/* 4. Selected Drawings List & Reordering Controls */}
                <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                            <Layers2 className="h-3.5 w-3.5 text-primary" />
                            <span>Drawing Sequence &amp; Scope ({orderedPfds.length})</span>
                        </label>

                        {/* Order adjustment helpers */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="text-gray-400 mr-1 hidden sm:inline">Sort:</span>
                            <button
                                type="button"
                                onClick={handleSortByDocNo}
                                className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-primary hover:border-primary/40 font-medium transition-colors"
                                title="Sort A-Z by Document Number"
                            >
                                By Doc No
                            </button>
                            <button
                                type="button"
                                onClick={handleSortByName}
                                className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-primary hover:border-primary/40 font-medium transition-colors"
                                title="Sort A-Z by PFD Name"
                            >
                                By Name
                            </button>
                            <button
                                type="button"
                                onClick={handleResetOrder}
                                className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center gap-1"
                                title="Reset to table selection order"
                            >
                                <RotateCcw className="h-3 w-3" />
                                <span>Reset</span>
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2.5 max-h-72 overflow-y-auto custom-scroll pr-1 rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 bg-white dark:bg-[#0e1726]">
                        {orderedPfds.map((pfd, index) => {
                            const isExpanded = expandedPfdIds.has(pfd.pfd_id);
                            const pageCount = pfd.page_count || 1;
                            const defPage = pfd.default_page || 1;
                            const selectedPages = customPageMap[pfd.pfd_id] || [defPage];

                            return (
                                <div
                                    key={pfd.pfd_id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDrop={(e) => handleDrop(e, index)}
                                    className={`rounded-xl border transition-all p-3 ${
                                        draggedPfdIndex === index
                                            ? 'border-primary border-dashed bg-primary/10 opacity-70'
                                            : 'border-gray-200/80 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/30 hover:border-gray-300 dark:hover:border-gray-600'
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                                            {/* Drag Handle & Order Index */}
                                            <div className="flex items-center gap-1 pt-0.5 shrink-0">
                                                <GripVertical className="h-4 w-4 text-gray-400 cursor-grab active:cursor-grabbing hover:text-gray-600 dark:hover:text-gray-200" />
                                                <span className="h-5 min-w-[20px] px-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-[10px] font-bold flex items-center justify-center">
                                                    #{index + 1}
                                                </span>
                                            </div>

                                            <div className="flex-1 min-w-0 space-y-1.5">
                                                {/* Line 1: PFD Name + Doc Number + Revision */}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-xs font-bold text-gray-900 dark:text-gray-100" title={pfd.pfd_name}>
                                                        {pfd.pfd_name}
                                                    </span>
                                                    {pfd.doc_number && (
                                                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                                                            {pfd.doc_number}
                                                            {pfd.drawing_revision ? ` Rev.${pfd.drawing_revision}` : ''}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Line 2: Linked Asset, Risk Model, and Page count */}
                                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                                    {pfd.asset_name && (
                                                        <span className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300 font-medium bg-white dark:bg-gray-800 px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700">
                                                            <Layers className="h-3 w-3 text-emerald-500 shrink-0" />
                                                            <span>{pfd.asset_name}</span>
                                                        </span>
                                                    )}

                                                    {/* Risk Model Badge */}
                                                    <span
                                                        className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300 font-semibold bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800/60 text-[10px]"
                                                        title={`Assigned Risk Model: ${pfd.default_model_name || 'System Default Model'}`}
                                                    >
                                                        <ShieldAlert className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
                                                        <span>Model: {pfd.default_model_name || 'System Default'}</span>
                                                    </span>

                                                    {/* Page Export Info */}
                                                    <span className="text-gray-500 dark:text-gray-400 font-mono text-[10px] bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700">
                                                        Exporting {selectedPages.length} of {pageCount} page(s)
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action Buttons: Move Up/Down & Page Expand */}
                                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                                            {/* Move Up / Down Buttons */}
                                            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                                                <button
                                                    type="button"
                                                    onClick={() => movePfdUp(index)}
                                                    disabled={index === 0 || isExporting}
                                                    className="p-1 text-gray-500 hover:text-primary hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                                    title="Move drawing up in export order"
                                                >
                                                    <ArrowUp className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => movePfdDown(index)}
                                                    disabled={index === orderedPfds.length - 1 || isExporting}
                                                    className="p-1 border-l border-gray-200 dark:border-gray-700 text-gray-500 hover:text-primary hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                                    title="Move drawing down in export order"
                                                >
                                                    <ArrowDown className="h-3.5 w-3.5" />
                                                </button>
                                            </div>

                                            {pageScope === 'CUSTOM' && pageCount > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => togglePfdExpand(pfd.pfd_id)}
                                                    className="btn btn-xs btn-outline-secondary py-1.5 px-3 text-[11px] gap-1.5 rounded-lg"
                                                >
                                                    <span>Pages ({selectedPages.length})</span>
                                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Custom Page Picker Accordion */}
                                    {pageScope === 'CUSTOM' && isExpanded && pageCount > 1 && (
                                        <div className="mt-3 pt-2.5 border-t border-gray-200/80 dark:border-gray-700/80 space-y-2.5">
                                            <div className="flex items-center justify-between text-xs text-gray-500">
                                                <span>Select drawing pages:</span>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectAllPagesForPfd(pfd.pfd_id, pageCount)}
                                                        className="text-primary hover:underline font-semibold"
                                                    >
                                                        Select All
                                                    </button>
                                                    <span>•</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectDefaultPageForPfd(pfd.pfd_id, defPage)}
                                                        className="text-primary hover:underline font-semibold"
                                                    >
                                                        Reset to Default Only
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Page Selection Checkbox Grid */}
                                            <div className="flex flex-wrap gap-2">
                                                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => {
                                                    const isChecked = selectedPages.includes(n);
                                                    return (
                                                        <button
                                                            key={n}
                                                            type="button"
                                                            onClick={() => handleTogglePage(pfd.pfd_id, n)}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-2 transition-all ${
                                                                isChecked
                                                                    ? 'border-primary bg-primary text-white font-bold shadow-xs'
                                                                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                                                            }`}
                                                        >
                                                            {isChecked ? (
                                                                <CheckSquare className="h-4 w-4" />
                                                            ) : (
                                                                <Square className="h-4 w-4" />
                                                            )}
                                                            <span>Page {n}</span>
                                                            {n === defPage && (
                                                                <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${isChecked ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                                                                    Default
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Page Export Sequence & Order Controls (if > 1 page selected) */}
                                            {selectedPages.length > 1 && (
                                                <div className="bg-gray-100/70 dark:bg-gray-900/40 p-2 rounded-lg text-xs flex flex-wrap items-center gap-2">
                                                    <span className="text-gray-500 dark:text-gray-400 font-semibold text-[11px]">
                                                        Page Export Sequence:
                                                    </span>
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {selectedPages.map((pageNo, pIdx) => (
                                                            <div
                                                                key={pageNo}
                                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-mono text-[11px]"
                                                            >
                                                                <span className="font-bold text-gray-800 dark:text-gray-200">
                                                                    p.{pageNo}
                                                                </span>
                                                                <div className="flex items-center gap-0.5 ml-1 border-l border-gray-200 dark:border-gray-700 pl-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => movePageEarlier(pfd.pfd_id, pIdx)}
                                                                        disabled={pIdx === 0}
                                                                        className="text-gray-400 hover:text-primary disabled:opacity-20"
                                                                        title="Move earlier"
                                                                    >
                                                                        <ArrowLeft className="h-3 w-3" />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => movePageLater(pfd.pfd_id, pIdx)}
                                                                        disabled={pIdx === selectedPages.length - 1}
                                                                        className="text-gray-400 hover:text-primary disabled:opacity-20"
                                                                        title="Move later"
                                                                    >
                                                                        <ArrowRight className="h-3 w-3" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 5. Dynamic Calculation Ribbon */}
                <div className="rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3.5 text-xs flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-bold text-gray-900 dark:text-white">
                            {outputMode === 'MERGED_PDF'
                                ? '1 Consolidated PDF Report'
                                : `${orderedPfds.length} Individual PDF Files`}
                        </span>
                        <span className="text-gray-400">•</span>
                        <span className="text-gray-600 dark:text-gray-300">
                            {orderedPfds.length} drawing(s)
                        </span>
                        <span className="text-gray-400">•</span>
                        <span className="text-primary font-bold">
                            {totalPdfPages} total page{totalPdfPages === 1 ? '' : 's'}
                        </span>
                        {coverPagesCount > 0 && (
                            <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                                ({totalDrawingPages} drawing sheet{totalDrawingPages === 1 ? '' : 's'} + {coverPagesCount} cover sheet)
                            </span>
                        )}
                    </div>

                    {coverPagesCount > 0 && (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
                            + {coverPagesCount} Summary Cover Sheet
                        </span>
                    )}
                </div>

                {/* 6. Export Progress Indicator */}
                {isExporting && (
                    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/30 p-3.5 text-xs space-y-2 animate-in fade-in">
                        <div className="flex items-center justify-between text-blue-900 dark:text-blue-200 font-semibold">
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <span>{exportProgress.message}</span>
                            </div>
                            {exportProgress.total > 1 && (
                                <span>
                                    {exportProgress.current} / {exportProgress.total}
                                </span>
                            )}
                        </div>
                        {exportProgress.total > 1 && (
                            <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="bg-primary h-1.5 rounded-full transition-all duration-300"
                                    style={{
                                        width: `${(exportProgress.current / exportProgress.total) * 100}%`,
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

