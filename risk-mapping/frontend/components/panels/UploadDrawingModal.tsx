'use client';

import React, { useState, useRef } from 'react';
import {
    UploadCloud,
    FileText,
    CheckCircle2,
    Layers,
    X,
    Loader2,
    Sparkles,
    AlertCircle,
    Info,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import ComponentTreeView from '@/components/risk-analysis/ComponentTreeView';
import StorageDestinationBanner from '@/components/risk-mapping/StorageDestinationBanner';
import { pAlert } from '../../../lib/riskMappingAlert';

interface AssetData {
    asset_id: number;
    asset_name: string;
    [key: string]: any;
}

interface UploadDrawingModalProps {
    isOpen: boolean;
    onClose: () => void;
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

function cleanFilenameToTitle(filename: string): string {
    return filename
        .replace(/\.pdf$/i, '')
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export default function UploadDrawingModal({ isOpen, onClose, onSuccess }: UploadDrawingModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [pageCount, setPageCount] = useState<number | null>(null);
    const [pfdName, setPfdName] = useState('');
    const [description, setDescription] = useState('');
    const [defaultPage, setDefaultPage] = useState(1);
    const [selectedAsset, setSelectedAsset] = useState<AssetData | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [touched, setTouched] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileSelect = async (selectedFile: File | null) => {
        if (!selectedFile) return;

        if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
            pAlert({
                type: 'warning',
                title: 'Invalid File',
                text: 'Please select a valid PDF drawing file (.pdf).',
            });
            return;
        }

        setFile(selectedFile);
        setDefaultPage(1);

        // Auto-generate human-readable PFD Title if field is empty
        if (!pfdName.trim()) {
            setPfdName(cleanFilenameToTitle(selectedFile.name));
        }

        // Count pages client-side for immediate responsive preview
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
        if (!pfdName.trim()) {
            pAlert({ type: 'warning', title: 'Name Required', text: 'Please provide a PFD drawing name.' });
            return;
        }
        if (!selectedAsset) {
            pAlert({ type: 'warning', title: 'Asset Required', text: 'Please select a linked asset from the hierarchy.' });
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('pfd_name', pfdName.trim());
            formData.append('description', description.trim());
            formData.append('asset_id', String(selectedAsset.asset_id));
            formData.append('file', file);
            formData.append('default_page', String(defaultPage));

            const res = await fetch('/api/risk-mapping/pfd', {
                method: 'POST',
                body: formData,
            });

            const json = await res.json();
            if (json.success) {
                pAlert({
                    type: 'success',
                    title: 'Drawing Uploaded',
                    text: 'Process Flow Diagram uploaded successfully. Background text indexing has been queued.',
                    timer: 2000,
                    showConfirmButton: false,
                });
                onSuccess();
                onClose();
            } else {
                pAlert({
                    type: 'error',
                    title: 'Upload Failed',
                    text: json.error || 'Failed to upload PFD.',
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
    const isNameMissing = touched && !pfdName.trim();
    const isAssetMissing = touched && !selectedAsset;

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => !uploading && onClose()}
            title="Upload New Process Flow Diagram"
            subtitle="Upload an engineering drawing (P&ID/PFD) and link it to an asset in the hierarchy"
            icon={<UploadCloud className="h-5 w-5 text-primary" />}
            size="xl"
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
                                    <span>Uploading &amp; Indexing...</span>
                                </>
                            ) : (
                                <>
                                    <UploadCloud className="h-4 w-4 shrink-0" />
                                    <span>Upload PFD</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left Column: File Dropzone & Drawing Metadata (7 cols) */}
                <div className="lg:col-span-7 space-y-4">
                    {/* Storage Destination Pill Banner */}
                    <StorageDestinationBanner />

                    {/* Drag & Drop Zone or Selected File Card */}
                    <div>
                        <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
                            <span>
                                PDF Document File <span className="text-danger">*</span>
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
                                    Click to browse or drag &amp; drop PDF here
                                </div>
                                <div className="mt-1 text-xs text-gray-400">
                                    Standard engineering drawings, P&amp;IDs, and flow diagrams (PDF)
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
                            /* Selected File Card */
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
                                <span>Please select a PDF file to upload.</span>
                            </p>
                        )}
                    </div>

                    {/* PFD Name */}
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                PFD Drawing Name <span className="text-danger">*</span>
                            </label>
                            {file && (
                                <button
                                    type="button"
                                    onClick={() => setPfdName(cleanFilenameToTitle(file.name))}
                                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                                    title="Auto-fill from filename"
                                >
                                    <Sparkles className="h-3 w-3" />
                                    <span>Clean Filename</span>
                                </button>
                            )}
                        </div>
                        <input
                            type="text"
                            value={pfdName}
                            onChange={(e) => setPfdName(e.target.value)}
                            placeholder="e.g. Scrubbing Pipeline P&ID"
                            className={`form-input text-xs sm:text-sm rounded-lg ${
                                isNameMissing ? 'border-danger focus:border-danger' : ''
                            }`}
                        />
                        {isNameMissing && (
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-danger">
                                <AlertCircle className="h-3 w-3" />
                                <span>Drawing name is required.</span>
                            </p>
                        )}
                    </div>

                    {/* Default Page Selector */}
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                Default Display Sheet / Page
                            </label>
                            {pageCount && pageCount > 1 && (
                                <span className="text-[10px] text-gray-400">
                                    Multi-page drawing detected
                                </span>
                            )}
                        </div>
                        {pageCount && pageCount > 1 ? (
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
                        ) : (
                            <input
                                type="number"
                                min={1}
                                max={pageCount || 999}
                                className="form-input text-xs sm:text-sm rounded-lg"
                                value={defaultPage}
                                onChange={(e) => setDefaultPage(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            />
                        )}
                        <p className="mt-1 text-[11px] text-gray-400">
                            The initial page shown when the drawing is opened in the viewer.
                        </p>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Description / Notes
                        </label>
                        <textarea
                            className="form-textarea text-xs sm:text-sm rounded-lg"
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional notes about this drawing..."
                        />
                    </div>
                </div>

                {/* Right Column: Linked Asset Hierarchy (5 cols) */}
                <div className="lg:col-span-5 flex flex-col space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Linked Asset in Hierarchy <span className="text-danger">*</span>
                        </label>
                    </div>

                    {/* Selected Asset Banner */}
                    {selectedAsset ? (
                        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                            <div className="flex items-center gap-2 min-w-0">
                                <Layers className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <div className="min-w-0">
                                    <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 block uppercase font-bold">
                                        Selected Asset:
                                    </span>
                                    <span className="font-bold truncate block">{selectedAsset.asset_name}</span>
                                </div>
                            </div>
                            <span className="badge badge-outline-success text-[10px] shrink-0 font-semibold">
                                Ready
                            </span>
                        </div>
                    ) : (
                        <div
                            className={`rounded-lg border px-3 py-2 text-xs ${
                                isAssetMissing
                                    ? 'border-danger bg-danger/5 text-danger'
                                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400'
                            }`}
                        >
                            <span className="inline-flex items-center gap-1.5">
                                <Info className="h-3.5 w-3.5 shrink-0" />
                                <span>Click an asset in the hierarchy tree below to link it.</span>
                            </span>
                        </div>
                    )}

                    {/* Tree View Container */}
                    <div
                        className={`flex-1 min-h-[260px] max-h-[340px] overflow-y-auto rounded-xl border p-2.5 bg-gray-50/50 dark:bg-gray-800/30 ${
                            isAssetMissing ? 'border-danger' : 'border-gray-200 dark:border-gray-700'
                        }`}
                    >
                        <ComponentTreeView onAssetSelect={(asset) => setSelectedAsset(asset)} />
                    </div>
                    {isAssetMissing && (
                        <p className="flex items-center gap-1 text-[11px] text-danger">
                            <AlertCircle className="h-3 w-3" />
                            <span>An asset must be selected from the hierarchy.</span>
                        </p>
                    )}
                </div>
            </div>
        </Modal>
    );
}

