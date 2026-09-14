'use client';

import { useState, useEffect } from 'react';
import {
    FileText,
    CheckCircle2,
    AlertCircle,
    RefreshCw,
    Link2,
    RotateCcw,
    FolderTree,
    Clock,
    ShieldAlert,
    Cloud,
    Database,
    HardDrive,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import ComponentTreeView from '@/components/risk-analysis/ComponentTreeView';
import { pAlert } from '@/lib/riskMappingAlert';

export interface EditDrawingTarget {
    pfd_id: number;
    pfd_name: string;
    description?: string | null;
    asset_id?: number | null;
    asset_name?: string | null;
    current_version_id?: number | null;
    doc_number?: string | null;
    drawing_revision?: string | null;
    drawing_title?: string | null;
    drawing_project?: string | null;
    drawing_company?: string | null;
    drawing_job_no?: string | null;
    default_page?: number | null;
    page_count?: number | null;
    file_name?: string | null;
    version_no?: number | null;
    title_detected?: boolean;
    title_block_json?: string | null;
    indexed_pages?: number | null;
    default_rbim_id?: number | null;
    default_model_name?: string | null;
    created_by?: string;
    uploaded_at?: string | null;
    storage_backend?: 'sharepoint' | 's3' | 'local';
}

interface AssetData {
    asset_id: number;
    asset_name: string;
    [key: string]: any;
}

interface RiskModelOption {
    rbim_id: number;
    name: string;
    level?: number;
}

export interface EditDrawingModalProps {
    isOpen: boolean;
    onClose: () => void;
    pfd: EditDrawingTarget;
    onSaved?: (newAsset?: AssetData | null, shouldReviewTags?: boolean) => void;
}

export default function EditDrawingModal({ isOpen, onClose, pfd, onSaved }: EditDrawingModalProps) {
    const [editName, setEditName] = useState(pfd.pfd_name || '');
    const [editDocNumber, setEditDocNumber] = useState(pfd.doc_number || '');
    const [editRevision, setEditRevision] = useState(pfd.drawing_revision || '');
    const [editTitle, setEditTitle] = useState(pfd.drawing_title || '');
    const [editProject, setEditProject] = useState(pfd.drawing_project || '');
    const [editCompany, setEditCompany] = useState(pfd.drawing_company || '');
    const [editJobNo, setEditJobNo] = useState(pfd.drawing_job_no || '');
    const [editDescription, setEditDescription] = useState(pfd.description || '');
    const [editDefaultPage, setEditDefaultPage] = useState(pfd.default_page || 1);
    const [editModelId, setEditModelId] = useState<number | null>(pfd.default_rbim_id ?? null);
    const [titleDetected, setTitleDetected] = useState(pfd.title_detected ?? false);

    // Available risk models
    const [models, setModels] = useState<RiskModelOption[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);

    // Linked Asset state
    const [editAsset, setEditAsset] = useState<AssetData | null>(
        pfd.asset_id ? { asset_id: pfd.asset_id, asset_name: pfd.asset_name || `Asset #${pfd.asset_id}` } : null
    );
    const [showAssetTree, setShowAssetTree] = useState(false);
    const [adjustTags, setAdjustTags] = useState(true);

    const [saving, setSaving] = useState(false);
    const [rescanning, setRescanning] = useState(false);

    useEffect(() => {
        let isMounted = true;
        setLoadingModels(true);
        fetch('/api/risk-analysis/model')
            .then((res) => res.json())
            .then((json) => {
                if (json.success && Array.isArray(json.data) && isMounted) {
                    const uniqueMap = new Map<number, RiskModelOption>();
                    for (const m of json.data) {
                        if (!uniqueMap.has(m.rbim_id)) {
                            uniqueMap.set(m.rbim_id, {
                                rbim_id: m.rbim_id,
                                name: m.name,
                                level: m.level,
                            });
                        }
                    }
                    setModels(Array.from(uniqueMap.values()));
                }
            })
            .catch((err) => console.error('Failed to load risk models', err))
            .finally(() => {
                if (isMounted) setLoadingModels(false);
            });
        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        setEditName(pfd.pfd_name || '');
        setEditDocNumber(pfd.doc_number || '');
        setEditRevision(pfd.drawing_revision || '');
        setEditTitle(pfd.drawing_title || '');
        setEditProject(pfd.drawing_project || '');
        setEditCompany(pfd.drawing_company || '');
        setEditJobNo(pfd.drawing_job_no || '');
        setEditDescription(pfd.description || '');
        setEditDefaultPage(pfd.default_page || 1);
        setEditModelId(pfd.default_rbim_id ?? null);
        setTitleDetected(pfd.title_detected ?? false);
        setEditAsset(
            pfd.asset_id ? { asset_id: pfd.asset_id, asset_name: pfd.asset_name || `Asset #${pfd.asset_id}` } : null
        );
        setShowAssetTree(false);
        setAdjustTags(true);
    }, [pfd]);

    const handleRescanTitleBlock = async () => {
        setRescanning(true);
        try {
            const res = await fetch(`/api/risk-mapping/pfd/${pfd.pfd_id}/rescan-title-block`, {
                method: 'POST',
            });
            const json = await res.json();
            if (!json.success) {
                pAlert({ type: 'error', title: 'Error', text: json.error || 'Failed to re-scan title block' });
                return;
            }

            const d = json.data;
            if (d.doc_number) setEditDocNumber(d.doc_number);
            if (d.drawing_revision) setEditRevision(d.drawing_revision);
            if (d.drawing_title) setEditTitle(d.drawing_title);
            if (d.drawing_project) setEditProject(d.drawing_project);
            if (d.drawing_company) setEditCompany(d.drawing_company);
            if (d.drawing_job_no) setEditJobNo(d.drawing_job_no);
            if (d.default_page) setEditDefaultPage(d.default_page);
            if (d.title_detected !== undefined) setTitleDetected(d.title_detected);

            const pageMsg = d.default_page && (pfd.page_count || 1) > 1
                ? `\n\nDefault drawing page set to Page ${d.default_page} of ${pfd.page_count}.`
                : '';

            if (d.title_detected) {
                pAlert({
                    type: 'success',
                    title: 'Title Block Detected',
                    text: (d.doc_number
                        ? `Document Number: ${d.doc_number}${d.drawing_title ? ` — ${d.drawing_title}` : ''}`
                        : 'Drawing metadata was successfully updated from drawing vector text.') + pageMsg,
                    confirmButtonText: 'OK',
                });
            } else {
                pAlert({
                    type: 'info',
                    title: 'Scan Complete',
                    text: ('No title block was auto-detected on this drawing. Manual entry is enabled.' + pageMsg),
                    confirmButtonText: 'OK',
                });
            }
        } catch (e: any) {
            pAlert({ type: 'error', title: 'Error', text: e.message });
        } finally {
            setRescanning(false);
        }
    };

    const handleSave = async () => {
        if (!editName.trim()) {
            pAlert({ type: 'warning', title: 'Validation', text: 'PFD name is required.' });
            return;
        }

        setSaving(true);
        try {
            const bodyPayload: any = {
                pfd_name: editName.trim(),
                doc_number: editDocNumber.trim() || null,
                drawing_revision: editRevision.trim() || null,
                drawing_title: editTitle.trim() || null,
                drawing_project: editProject.trim() || null,
                drawing_company: editCompany.trim() || null,
                drawing_job_no: editJobNo.trim() || null,
                description: editDescription.trim() || null,
                default_rbim_id: editModelId,
            };

            const assetChanged = Boolean(editAsset && editAsset.asset_id !== pfd.asset_id);
            const newAssetId = editAsset?.asset_id;

            // Include updated asset_id if changed or present.
            // adjust_tags: false ensures tags are not silently wiped in background;
            // instead, the interactive Auto-Detect review modal will prompt for confirmation.
            if (editAsset && editAsset.asset_id) {
                bodyPayload.asset_id = editAsset.asset_id;
                bodyPayload.adjust_tags = false;
            }

            const res = await fetch(`/api/risk-mapping/pfd/${pfd.pfd_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload),
            });

            const json = await res.json();
            if (!json.success) {
                pAlert({ type: 'error', title: 'Update Failed', text: json.error || 'Update failed' });
                return;
            }

            // Update default page if changed
            if (pfd.current_version_id && editDefaultPage !== pfd.default_page) {
                const pageRes = await fetch(`/api/risk-mapping/pfd/${pfd.pfd_id}/version/${pfd.current_version_id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ default_page: editDefaultPage }),
                });
                const pageJson = await pageRes.json();
                if (!pageJson.success) {
                    pAlert({ type: 'error', title: 'Error', text: pageJson.error || 'Failed to update default page' });
                    return;
                }
            }

            const shouldReview = assetChanged && adjustTags;
            if (shouldReview) {
                // Instant smooth transition to auto-tag review
                onSaved?.(editAsset, true);
                onClose();
            } else {
                pAlert({
                    type: 'success',
                    title: 'Saved',
                    text: 'Drawing properties and metadata updated successfully.',
                    timer: 1500,
                    showConfirmButton: false,
                });
                onSaved?.(editAsset, false);
                onClose();
            }
        } catch (e: any) {
            pAlert({ type: 'error', title: 'Error', text: e.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit PFD Drawing"
            subtitle="Drawing properties, title block metadata, and linked asset"
            icon={<FileText className="h-5 w-5" />}
            size="lg"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-outline-secondary btn-sm px-4 rounded-lg font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="btn btn-primary btn-sm px-5 rounded-lg shadow-sm font-semibold"
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                {/* Title Block Status & Unified Re-scan Action */}
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200/80 dark:border-gray-700/60 bg-gray-50/70 dark:bg-gray-800/40">
                    <div className="flex items-center gap-2">
                        <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                titleDetected
                                    ? 'bg-success/15 text-success border border-success/20'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                            }`}
                        >
                            {titleDetected ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                                <AlertCircle className="h-3.5 w-3.5" />
                            )}
                            <span>{titleDetected ? 'Title Block Detected' : 'Manual Entry'}</span>
                        </span>
                        {editDocNumber && (
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
                                {editDocNumber}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleRescanTitleBlock}
                        disabled={rescanning}
                        className="btn btn-outline-primary btn-sm py-1 px-3 text-xs gap-1.5 shadow-none rounded-lg font-medium bg-white dark:bg-gray-800"
                        title="Re-scan PDF text layer to detect title block metadata"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${rescanning ? 'animate-spin' : ''}`} />
                        <span>{rescanning ? 'Scanning...' : 'Re-scan from PDF'}</span>
                    </button>
                </div>

                {/* PFD Name */}
                <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                        PFD Name <span className="text-danger">*</span>
                    </label>
                    <input
                        type="text"
                        className="form-input text-xs sm:text-sm rounded-lg"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                    />
                </div>

                {/* Linked Asset (Editable) */}
                <div>
                    <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                            <Link2 className="h-3.5 w-3.5 text-primary" />
                            <span>Linked Asset</span>
                        </label>
                        {editAsset ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
                                <span>Selected: {editAsset.asset_name}</span>
                            </span>
                        ) : (
                            <span className="text-xs text-amber-500 font-medium">No Asset Linked</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                className="form-input bg-gray-50 dark:bg-gray-800/80 text-xs sm:text-sm rounded-lg text-gray-800 dark:text-gray-200 font-medium pl-8"
                                value={editAsset ? `${editAsset.asset_name} (ID: ${editAsset.asset_id})` : 'No Asset Linked'}
                                readOnly
                            />
                            <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowAssetTree((prev) => !prev)}
                            className={`btn btn-sm h-9 px-3 text-xs font-semibold rounded-lg shrink-0 flex items-center gap-1.5 transition-all ${
                                showAssetTree
                                    ? 'btn-primary shadow-xs'
                                    : 'btn-outline-primary bg-white dark:bg-gray-800'
                            }`}
                        >
                            <FolderTree className="h-3.5 w-3.5" />
                            <span>{showAssetTree ? 'Hide Hierarchy' : 'Change Asset'}</span>
                        </button>
                        {editAsset && editAsset.asset_id !== pfd.asset_id && (
                            <button
                                type="button"
                                onClick={() =>
                                    setEditAsset(
                                        pfd.asset_id
                                            ? { asset_id: pfd.asset_id, asset_name: pfd.asset_name || `Asset #${pfd.asset_id}` }
                                            : null
                                    )
                                }
                                className="btn btn-outline-secondary btn-sm h-9 px-2 text-xs rounded-lg shrink-0"
                                title="Reset to original asset"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {showAssetTree && (
                        <div className="mt-2.5 rounded-xl border border-primary/25 bg-primary/5 dark:bg-primary/10 p-3 shadow-inner">
                            <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center justify-between">
                                <span>Click an asset below to link this drawing:</span>
                                {editAsset && (
                                    <span className="text-primary font-bold text-[11px]">
                                        Current: {editAsset.asset_name}
                                    </span>
                                )}
                            </div>
                            <div className="max-h-56 overflow-y-auto custom-scroll rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-900 p-2">
                                <ComponentTreeView
                                    initialSelectedAssetId={editAsset?.asset_id}
                                    showModelSelector={false}
                                    showTreeTypeToggle={false}
                                    onAssetSelect={(asset) => {
                                        if (asset) {
                                            setEditAsset(asset);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Auto-adjust tagged assets checkbox when linked asset changes */}
                    {editAsset && editAsset.asset_id !== pfd.asset_id && (
                        <div className="mt-2.5 rounded-xl border border-primary/25 bg-primary/5 dark:bg-primary/10 p-3 text-xs">
                            <label className="flex items-start gap-2.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    className="form-checkbox text-primary rounded mt-0.5 cursor-pointer"
                                    checked={adjustTags}
                                    onChange={(e) => setAdjustTags(e.target.checked)}
                                />
                                <div>
                                    <span className="font-bold text-gray-900 dark:text-white">
                                        Review &amp; adjust tagged assets for newly linked asset
                                    </span>
                                    <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 leading-relaxed">
                                        Opens the review modal after saving to inspect irrelevant tags to clean up outside <strong className="text-primary">{editAsset.asset_name}</strong>&apos;s hierarchy and confirm matching tags to add.
                                    </p>
                                </div>
                            </label>
                        </div>
                    )}
                </div>

                {/* Document Number & Revision */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Document Number (Doc #)
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. WW3-MP-61-0001"
                            className="form-input font-mono text-xs sm:text-sm rounded-lg"
                            value={editDocNumber}
                            onChange={(e) => setEditDocNumber(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Drawing Rev <span className="text-[10px] font-normal text-gray-400">(Manual)</span>
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. E"
                            className="form-input font-mono text-xs sm:text-sm text-center uppercase rounded-lg"
                            value={editRevision}
                            onChange={(e) => setEditRevision(e.target.value)}
                        />
                    </div>
                </div>

                {/* Drawing Title */}
                <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Drawing Title
                    </label>
                    <input
                        type="text"
                        placeholder="e.g. Scrubbing Pipeline Piping and Instrumentation Diagram"
                        className="form-input text-xs sm:text-sm rounded-lg"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                    />
                </div>

                {/* Project Name & Job No */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Project Name
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Geothermal Power Plant Project"
                            className="form-input text-xs sm:text-sm rounded-lg"
                            value={editProject}
                            onChange={(e) => setEditProject(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Job No.
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. 23246"
                            className="form-input font-mono text-xs sm:text-sm rounded-lg"
                            value={editJobNo}
                            onChange={(e) => setEditJobNo(e.target.value)}
                        />
                    </div>
                </div>

                {/* Company / Owner / Contractor */}
                <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Company / Owner / Contractor
                    </label>
                    <input
                        type="text"
                        placeholder="e.g. PT. Owner Company Limited"
                        className="form-input text-xs sm:text-sm rounded-lg"
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                    />
                </div>

                {/* Default Page & Default Risk Model */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Default Page
                        </label>
                        {pfd.page_count && pfd.page_count > 1 ? (
                            <select
                                className="form-select text-xs sm:text-sm rounded-lg"
                                value={editDefaultPage}
                                onChange={(e) => setEditDefaultPage(parseInt(e.target.value))}
                            >
                                {Array.from({ length: pfd.page_count }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                        Page {n}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="number"
                                min={1}
                                className="form-input text-xs sm:text-sm rounded-lg"
                                value={editDefaultPage}
                                onChange={(e) => setEditDefaultPage(parseInt(e.target.value) || 1)}
                            />
                        )}
                        <p className="mt-1 text-[11px] text-gray-400">
                            Primary drawing sheet for this PFD.
                        </p>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                            <span>Default Risk Model</span>
                        </label>
                        <select
                            className="form-select text-xs sm:text-sm rounded-lg"
                            value={editModelId ?? ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setEditModelId(val ? parseInt(val) : null);
                            }}
                            disabled={loadingModels}
                        >
                            <option value="">None (Use Viewer Default)</option>
                            {models.map((m) => (
                                <option key={m.rbim_id} value={m.rbim_id}>
                                    {m.name} {m.level ? `(Level ${m.level})` : ''}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-[11px] text-gray-400">
                            Persisted model used for risk calculations &amp; exports.
                        </p>
                    </div>
                </div>

                {/* Description */}
                <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Description
                    </label>
                    <textarea
                        className="form-textarea text-xs sm:text-sm rounded-lg"
                        rows={2}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Add drawing description or notes..."
                    />
                </div>

                {/* Compact File & Audit Metadata Ribbon */}
                <div className="rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/40 p-3 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-gray-500 dark:text-gray-400">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-700 dark:text-gray-300">File:</span>
                            <span className="font-mono text-gray-600 dark:text-gray-300 truncate max-w-[220px]" title={pfd.file_name || ''}>
                                {pfd.file_name || '-'}
                            </span>
                            <span>•</span>
                            <span>{pfd.page_count ? `${pfd.page_count} ${pfd.page_count === 1 ? 'page' : 'pages'}` : '1 page'}</span>
                            <span>•</span>
                            <span className="font-mono text-primary font-bold">v{pfd.version_no || 1}</span>
                            {pfd.storage_backend && (
                                <>
                                    <span>•</span>
                                    <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                            pfd.storage_backend === 'sharepoint'
                                                ? 'bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20'
                                                : pfd.storage_backend === 's3'
                                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                                        }`}
                                    >
                                        {pfd.storage_backend === 'sharepoint' && <Cloud className="h-3 w-3 shrink-0 text-[#0078D4]" />}
                                        {pfd.storage_backend === 's3' && <Database className="h-3 w-3 shrink-0 text-amber-500" />}
                                        {pfd.storage_backend === 'local' && <HardDrive className="h-3 w-3 shrink-0 text-gray-500" />}
                                        <span>
                                            {pfd.storage_backend === 'sharepoint' ? 'SharePoint' : pfd.storage_backend === 's3' ? 'S3' : 'Local'}
                                        </span>
                                    </span>
                                </>
                            )}
                        </div>
                        <div>
                            {(pfd.indexed_pages ?? 0) > 0 && (pfd.indexed_pages ?? 0) >= (pfd.page_count ?? 1) ? (
                                <span className="inline-flex items-center gap-1 text-success font-semibold text-[11px]">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>Indexed</span>
                                </span>
                            ) : (pfd.indexed_pages ?? 0) > 0 ? (
                                <span className="inline-flex items-center gap-1 text-amber-500 font-semibold text-[11px]">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span>{pfd.indexed_pages}/{pfd.page_count || 1} Indexed</span>
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-gray-400 font-semibold text-[11px]">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span>Not Indexed</span>
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-400 pt-1.5 border-t border-gray-200/50 dark:border-gray-700/40">
                        <span>
                            Uploaded by <strong className="text-gray-600 dark:text-gray-300">{pfd.created_by || '-'}</strong>
                        </span>
                        <span>{pfd.uploaded_at ? new Date(pfd.uploaded_at).toLocaleString('en-GB') : '-'}</span>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
