'use client';

import React, { useState, useRef } from 'react';
import {
    RotateCcw,
    FileText,
    CheckCircle2,
    Layers,
    X,
    Loader2,
    UploadCloud,
    AlertCircle,
    FileCode,
    Tag,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import StorageDestinationBanner from '@/components/risk-mapping/StorageDestinationBanner';
import { pAlert } from '@/lib/riskMappingAlert';

export interface PfdTargetItem {
    pfd_id: number;
    public_id?: string | null;
    pfd_name: string;
    doc_number?: string | null;
    revision_no?: number | null;
    asset_name?: string | null;
    [key: string]: any;
}

interface UploadRevisionModalProps {
    isOpen: boolean;
    onClose: () => void;
    pfd: PfdTargetItem | null;
    onSuccess: () => void;
}

async function getPdfPageCountClientSide(file: File): Promise<number | null> {
    try {
        const buffer = await file.arrayBuffer();
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(buffer, { updateMetadata: false });
        return doc.getPageCount();
    } catch {
        return null;
    }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function UploadRevisionModal({
    isOpen,
    onClose,
    pfd,
    onSuccess,
}: UploadRevisionModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [pageCount, setPageCount] = useState<number | null>(null);
    const [defaultPage, setDefaultPage] = useState(1);
    const [notes, setNotes] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [touched, setTouched] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen || !pfd) return null;

    const currentRev = pfd.revision_no ?? 1;
    const nextRev = currentRev + 1;

    const handleFileSelect = async (selectedFile: File | null) => {
        if (!selectedFile) return;

        if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
            pAlert({
                type: 'warning',
                title: 'Invalid File',
                text: 'Please select a valid PDF file (.pdf).',
            });
            return;
        }

        setFile(selectedFile);
        setDefaultPage(1);

        const count = await getPdfPageCountClientSide(selectedFile);
        setPageCount(count);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        if (uploading) return;
        const droppedFile = e.dataTransfer.files?.[0];
        if (droppedFile) {
            handleFileSelect(droppedFile);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!uploading) setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const removeFile = () => {
        if (uploading) return;
        setFile(null);
        setPageCount(null);
        setDefaultPage(1);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSubmit = async () => {
        setTouched(true);

        if (!file) {
            pAlert({ type: 'warning', title: 'File Required', text: 'Please choose or drop a PDF drawing file.' });
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('notes', notes.trim());
            formData.append('default_page', String(defaultPage));

            const res = await fetch(`/api/risk-mapping/pfd/${pfd.pfd_id}/version`, {
                method: 'POST',
                body: formData,
            });

            const json = await res.json();
            if (json.success) {
                pAlert({
                    type: 'success',
                    title: 'New Revision Uploaded',
                    text: `Revision v${nextRev} uploaded successfully. Background text indexing has been queued.`,
                    timer: 2000,
                    showConfirmButton: false,
                });
                onSuccess();
                onClose();
            } else {
                pAlert({
                    type: 'error',
                    title: 'Upload Failed',
                    text: json.error || 'Failed to upload new revision.',
                });
            }
        } catch (e: any) {
            pAlert({
                type: 'error',
                title: 'Network Error',
                text: e.message || 'An unexpected error occurred during upload.',
            });
        } finally {
            setUploading(false);
        }
    };

    const isFileMissing = touched && !file;

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => !uploading && onClose()}
            title="Upload New Drawing Revision"
            subtitle={`Adding a new version for "${pfd.pfd_name}"`}
            icon={<RotateCcw className="h-5 w-5 text-primary" />}
            size="lg"
            footer={
                <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        {file && (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-600 dark:text-gray-300">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                <span>{file.name} ({formatFileSize(file.size)})</span>
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={uploading}
                            className="btn btn-outline-secondary btn-sm px-4 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={uploading}
                            className="btn btn-primary btn-sm px-5 rounded-lg shadow-sm font-semibold inline-flex items-center gap-1.5"
                        >
                            {uploading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                    <span>Uploading Revision v{nextRev}...</span>
                                </>
                            ) : (
                                <>
                                    <UploadCloud className="h-4 w-4 shrink-0" />
                                    <span>Upload Revision v{nextRev}</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                {/* Target Drawing Context Card */}
                <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 dark:border-gray-700/80 dark:bg-gray-800/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">
                                Target Drawing
                            </span>
                            <h6 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                                {pfd.pfd_name}
                            </h6>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                                Current: v{currentRev} &rarr; <span className="font-bold text-primary">v{nextRev}</span>
                            </span>
                        </div>
                    </div>

                    {(pfd.doc_number || pfd.asset_name) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-gray-200/60 dark:border-gray-700/60 pt-2 text-xs">
                            {pfd.doc_number && (
                                <span className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300 font-mono text-[11px] bg-white dark:bg-gray-800 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                                    <FileCode className="h-3 w-3 text-primary" />
                                    <span>Doc: {pfd.doc_number}</span>
                                </span>
                            )}
                            {pfd.asset_name && (
                                <span className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300 text-[11px] bg-white dark:bg-gray-800 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                                    <Layers className="h-3 w-3 text-emerald-500" />
                                    <span>Asset: {pfd.asset_name}</span>
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Storage Destination Banner */}
                <StorageDestinationBanner />

                {/* Drag & Drop Zone or Selected File Card */}
                <div>
                    <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
                        <span>
                            Revision PDF Document <span className="text-danger">*</span>
                        </span>
                        {pageCount && (
                            <span className="text-[11px] font-normal text-gray-400">
                                {pageCount} page{pageCount > 1 ? 's' : ''} detected
                            </span>
                        )}
                    </label>

                    {!file ? (
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`group flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                                isDragOver
                                    ? 'border-primary bg-primary/10 scale-[1.01]'
                                    : isFileMissing
                                    ? 'border-danger/60 bg-danger/5 hover:border-danger'
                                    : 'border-gray-300 dark:border-gray-700 hover:border-primary bg-gray-50/50 dark:bg-gray-800/30 hover:bg-primary/5'
                            }`}
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:scale-110 transition-transform mb-2">
                                <UploadCloud className="h-6 w-6" />
                            </div>
                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                                Click to browse or drag &amp; drop new revision PDF
                            </div>
                            <div className="mt-1 text-xs text-gray-400">
                                Select the updated engineering drawing file (.pdf)
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf,.pdf"
                                className="hidden"
                                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                            />
                        </div>
                    ) : (
                        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-3.5 transition-all">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
                                    <FileText className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-bold text-gray-900 dark:text-white truncate" title={file.name}>
                                        {file.name}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                        <span>{formatFileSize(file.size)}</span>
                                        <span>•</span>
                                        <span className="font-semibold text-primary">
                                            {pageCount ? `${pageCount} page${pageCount > 1 ? 's' : ''}` : 'Reading pages...'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading}
                                    className="btn btn-xs btn-outline-primary h-7 px-2.5 rounded-md"
                                    title="Change PDF file"
                                >
                                    Change
                                </button>
                                <button
                                    type="button"
                                    onClick={removeFile}
                                    disabled={uploading}
                                    className="h-7 w-7 rounded-md text-gray-400 hover:text-danger hover:bg-danger/10 flex items-center justify-center transition-colors"
                                    title="Remove file"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf,.pdf"
                                className="hidden"
                                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                            />
                        </div>
                    )}
                    {isFileMissing && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-danger">
                            <AlertCircle className="h-3 w-3" />
                            <span>Please select a revision PDF file to upload.</span>
                        </p>
                    )}
                </div>

                {/* Default Display Page (if multi-page) */}
                {pageCount && pageCount > 1 && (
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Default Display Sheet / Page
                        </label>
                        <select
                            className="form-select text-xs sm:text-sm rounded-lg"
                            value={defaultPage}
                            onChange={(e) => setDefaultPage(parseInt(e.target.value, 10))}
                        >
                            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                    Page {n} {n === 1 ? '(Default sheet)' : ''}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-[11px] text-gray-400">
                            The initial page displayed when opening this revision.
                        </p>
                    </div>
                )}

                {/* Revision Notes / Changelog */}
                <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Revision Notes / Changelog
                    </label>
                    <textarea
                        className="form-textarea text-xs sm:text-sm rounded-lg"
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. Rev B: Added new bypass line and updated transmitter tags as per field inspection..."
                    />
                    <p className="mt-1 text-[11px] text-gray-400">
                        Summary of changes included in this drawing revision.
                    </p>
                </div>
            </div>
        </Modal>
    );
}
