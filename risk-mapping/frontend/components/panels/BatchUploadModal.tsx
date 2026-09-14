'use client';

import React, { useState } from 'react';
import { UploadCloud, FileText, Trash2, Loader2, X, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { pAlert } from '@/lib/riskMappingAlert';
import ComponentTreeView from '@/components/risk-analysis/ComponentTreeView';
import StorageDestinationBanner from '@/components/risk-mapping/StorageDestinationBanner';

interface BatchUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface FileProgress {
    status: 'idle' | 'uploading' | 'done' | 'error';
    docNumber?: string;
    action?: string;
    error?: string;
}

export default function BatchUploadModal({ isOpen, onClose, onSuccess }: BatchUploadModalProps) {
    const [selectedAsset, setSelectedAsset] = useState<{ asset_id: number; asset_name: string } | null>(null);
    const [autoTagAndConfirm, setAutoTagAndConfirm] = useState(true);
    const [files, setFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [fileProgresses, setFileProgresses] = useState<Record<string, FileProgress>>({});

    if (!isOpen) return null;

    const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        if (uploading) return;
        if (e.dataTransfer.files) {
            addFiles(Array.from(e.dataTransfer.files));
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (uploading) return;
        if (e.target.files) {
            addFiles(Array.from(e.target.files));
        }
    };

    const addFiles = (newFiles: File[]) => {
        const validPdfs = newFiles.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
        if (validPdfs.length < newFiles.length) {
            pAlert({
                type: 'info',
                title: 'Notice',
                text: 'Only .pdf files were added. Non-PDF files were filtered out.',
            });
        }
        setFiles((prev) => {
            const existingNames = new Set(prev.map((f) => f.name));
            const uniqueNew = validPdfs.filter((f) => !existingNames.has(f.name));
            return [...prev, ...uniqueNew];
        });
    };

    const removeFile = (index: number) => {
        if (uploading) return;
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleUploadAll = async () => {
        if (!selectedAsset) {
            pAlert({ type: 'warning', title: 'Asset Required', text: 'Please select a linked asset from the hierarchy.' });
            return;
        }
        if (files.length === 0) {
            pAlert({ type: 'warning', title: 'Files Required', text: 'Please add at least one PDF file to upload.' });
            return;
        }

        setUploading(true);
        const initProgress: Record<string, FileProgress> = {};
        files.forEach((f) => {
            initProgress[f.name] = { status: 'idle' };
        });
        setFileProgresses(initProgress);

        let successCount = 0;
        let failCount = 0;

        // Concurrent upload pool (4 concurrent streams) to upload and process drawings 4x faster
        const CONCURRENCY_LIMIT = 4;
        let queueIndex = 0;

        const uploadWorker = async () => {
            while (queueIndex < files.length) {
                const currentIndex = queueIndex++;
                const file = files[currentIndex];
                if (!file) break;

                setFileProgresses((prev) => ({
                    ...prev,
                    [file.name]: { status: 'uploading' },
                }));

                try {
                    const formData = new FormData();
                    formData.append('asset_id', String(selectedAsset.asset_id));
                    formData.append('auto_tag', String(autoTagAndConfirm));
                    formData.append('files', file);

                    const res = await fetch('/api/risk-mapping/pfd-batch', {
                        method: 'POST',
                        body: formData,
                    });

                    const json = await res.json();
                    if (json.success && Array.isArray(json.results) && json.results.length > 0) {
                        const r = json.results[0];
                        successCount++;
                        setFileProgresses((prev) => ({
                            ...prev,
                            [file.name]: {
                                status: 'done',
                                docNumber: r.doc_number || r.pfd_name,
                                action: r.action,
                            },
                        }));
                    } else {
                        failCount++;
                        setFileProgresses((prev) => ({
                            ...prev,
                            [file.name]: {
                                status: 'error',
                                error: json.error || 'Upload failed',
                            },
                        }));
                    }
                } catch (err: any) {
                    failCount++;
                    setFileProgresses((prev) => ({
                        ...prev,
                        [file.name]: {
                            status: 'error',
                            error: err.message || 'Network error',
                        },
                    }));
                }
            }
        };

        const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, files.length) }, () => uploadWorker());
        await Promise.all(workers);

        setUploading(false);

        if (failCount === 0) {
            pAlert({
                type: 'success',
                title: 'Batch Upload Complete',
                text: `Successfully processed all ${successCount} drawing(s). ${
                    autoTagAndConfirm
                        ? 'Background text indexing and auto-tagging jobs have been queued.'
                        : 'Background text indexing jobs have been queued.'
                }`,
                timer: 3000,
                showConfirmButton: false,
            });
            onSuccess();
            onClose();
        } else {
            pAlert({
                type: 'warning',
                title: 'Upload Partially Succeeded',
                text: `Processed ${successCount} drawing(s), but ${failCount} drawing(s) encountered errors. Check the file list.`,
            });
            onSuccess();
        }
    };

    const completedCount = Object.values(fileProgresses).filter(
        (p) => p.status === 'done' || p.status === 'error'
    ).length;
    const progressPercent = files.length > 0 ? Math.round((completedCount / files.length) * 100) : 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4">
            <div className="relative w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-[#0e1726]">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
                    <div className="flex items-center gap-2">
                        <UploadCloud className="h-5 w-5 text-primary" />
                        <h4 className="text-base font-bold text-gray-900 dark:text-white">Batch Upload P&amp;ID Drawings</h4>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={uploading}
                        className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Form Body */}
                <div className="mt-4 space-y-4 text-xs">
                    {/* Live Upload Progress Indicator */}
                    {uploading && (
                        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 dark:border-primary/40 dark:bg-primary/10 shadow-sm animate-in fade-in duration-200">
                            <div className="flex items-center justify-between font-semibold">
                                <div className="flex items-center gap-2 text-primary font-bold">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                                    <span>
                                        Processing drawings ({completedCount} of {files.length} completed)
                                    </span>
                                </div>
                                <span className="text-xs font-extrabold text-primary">{progressPercent}%</span>
                            </div>
                            {/* Animated progress bar */}
                            <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                <div
                                    className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                                <span>Parallel processing active (4 concurrent streams)</span>
                                <span>
                                    {completedCount}/{files.length} Done
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Linked Asset Selector */}
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label className="font-semibold text-gray-700 dark:text-gray-300">
                                Linked Asset Hierarchy <span className="text-danger">*</span>
                            </label>
                            {selectedAsset && (
                                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                    Selected: {selectedAsset.asset_name} (ID: #{selectedAsset.asset_id})
                                </span>
                            )}
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 p-2.5 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                            <ComponentTreeView
                                onAssetSelect={(asset: any) => {
                                    if (asset && !uploading) {
                                        setSelectedAsset({ asset_id: asset.asset_id, asset_name: asset.asset_name });
                                    }
                                }}
                                showModelSelector={false}
                                showTreeTypeToggle={false}
                            />
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                            All drawings in this batch will be grouped under this asset hierarchy (e.g. Unit or Plant system).
                        </p>
                    </div>

                    {/* Auto-tagging & Confirm All Toggle */}
                    <div className="flex items-start justify-between rounded-xl border border-primary/20 bg-primary/5 p-3.5 dark:border-primary/30 dark:bg-primary/10 transition-colors">
                        <div className="flex items-start gap-2.5 pr-4">
                            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div>
                                <label htmlFor="toggle-auto-tag-batch" className="text-xs font-bold text-gray-900 dark:text-white cursor-pointer select-none">
                                    Trigger Auto-Tagging &amp; Confirm All
                                </label>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                                    Automatically scan each drawing for matching equipment &amp; pipe tags under the linked asset hierarchy, and map all detected tags to the drawings upon upload.
                                </p>
                            </div>
                        </div>
                        <label className="relative inline-flex cursor-pointer items-center shrink-0">
                            <input
                                id="toggle-auto-tag-batch"
                                type="checkbox"
                                disabled={uploading}
                                className="sr-only peer"
                                checked={autoTagAndConfirm}
                                onChange={(e) => setAutoTagAndConfirm(e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary dark:bg-gray-700"></div>
                        </label>
                    </div>

                    {/* Drag and Drop Zone */}
                    {!uploading && (
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragOver(true);
                            }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={handleFileDrop}
                            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                                isDragOver
                                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                                    : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 bg-gray-50/30 dark:bg-gray-800/20'
                            }`}
                        >
                            <UploadCloud className="h-8 w-8 text-primary/70 mb-2" />
                            <div className="font-semibold text-gray-800 dark:text-gray-200">
                                Drag &amp; drop multiple P&amp;ID drawings here
                            </div>
                            <div className="my-2">
                                <StorageDestinationBanner compact />
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                PDF format only · Title blocks, document numbers, and text layers will be indexed automatically
                            </div>
                            <label className="btn btn-outline-primary btn-sm mt-3 cursor-pointer">
                                Browse Files
                                <input type="file" multiple accept=".pdf" onChange={handleFileInput} className="hidden" />
                            </label>
                        </div>
                    )}

                    {/* Queued Files List with Live Per-File Progress */}
                    {files.length > 0 && (
                        <div>
                            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
                                <span>
                                    {uploading
                                        ? `Processing Progress (${completedCount} / ${files.length})`
                                        : `Queued Files (${files.length})`}
                                </span>
                                {!uploading && (
                                    <button
                                        type="button"
                                        onClick={() => setFiles([])}
                                        className="text-[11px] text-danger hover:underline"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>
                            <div className="max-h-52 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200 dark:border-gray-700 dark:divide-gray-800">
                                {files.map((file, idx) => {
                                    const prog = fileProgresses[file.name] || { status: 'idle' };

                                    return (
                                        <div
                                            key={idx}
                                            className={`flex items-center justify-between p-2.5 transition-colors ${
                                                prog.status === 'uploading'
                                                    ? 'bg-primary/10 dark:bg-primary/20 border-l-4 border-primary'
                                                    : prog.status === 'done'
                                                    ? 'bg-emerald-50/30 dark:bg-emerald-950/20'
                                                    : prog.status === 'error'
                                                    ? 'bg-rose-50/30 dark:bg-rose-950/20'
                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                                                {prog.status === 'uploading' ? (
                                                    <Loader2 className="h-4 w-4 shrink-0 text-primary animate-spin" />
                                                ) : prog.status === 'done' ? (
                                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                                ) : prog.status === 'error' ? (
                                                    <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
                                                ) : (
                                                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                                                )}

                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium text-gray-800 dark:text-gray-200 truncate flex items-center gap-2">
                                                        <span className="truncate">{file.name}</span>
                                                        {prog.docNumber && (
                                                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded shrink-0">
                                                                {prog.docNumber}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] text-gray-400 flex items-center gap-2">
                                                        <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                                                        {prog.status === 'error' && prog.error && (
                                                            <span className="text-danger truncate font-medium">
                                                                • {prog.error}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="shrink-0 flex items-center gap-2">
                                                {prog.status === 'uploading' && (
                                                    <span className="text-[10px] font-bold text-primary animate-pulse bg-primary/10 px-2 py-0.5 rounded-full">
                                                        Processing...
                                                    </span>
                                                )}
                                                {prog.status === 'done' && (
                                                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                                        Done
                                                    </span>
                                                )}
                                                {prog.status === 'error' && (
                                                    <span className="text-[10px] font-bold text-danger bg-danger/10 px-2 py-0.5 rounded-full">
                                                        Failed
                                                    </span>
                                                )}
                                                {!uploading && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeFile(idx)}
                                                        className="rounded p-1 text-gray-400 hover:text-danger transition-colors"
                                                        title="Remove file"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="mt-6 flex items-center justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={uploading}
                        className="btn btn-outline-secondary btn-sm"
                    >
                        {completedCount === files.length && files.length > 0 ? 'Close' : 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={handleUploadAll}
                        disabled={uploading || files.length === 0 || !selectedAsset}
                        className="btn btn-primary btn-sm gap-1.5 font-semibold"
                    >
                        {uploading ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>
                                    Uploading ({completedCount}/{files.length})...
                                </span>
                            </>
                        ) : (
                            <>
                                <UploadCloud className="h-3.5 w-3.5" />
                                <span>Upload All ({files.length})</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
