'use client';

import { Loader2, Trash2, Check, Scan, CheckCircle2, AlertTriangle, Info, Tag, Layers, CheckCheck } from 'lucide-react';
import Modal from '@/components/ui/Modal';

export interface AutoMatch {
    key: string;
    asset_id: number;
    asset_name: string;
    page_no: number;
    rect_x: number;
    rect_y: number;
    rect_width: number;
    rect_height: number;
    matched_text: string;
    map_id?: number;
    detection_mode?: string;
}

export interface AutoDetectReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    autoMatches: AutoMatch[] | null;
    irrelevantTags: AutoMatch[] | null;
    activeTab: 'cleanup' | 'matches';
    onTabChange: (tab: 'cleanup' | 'matches') => void;
    previewMatch: AutoMatch | null;
    onPreviewMatch: (match: AutoMatch, type: 'match' | 'irrelevant') => void;
    onConfirmMatch: (match: AutoMatch) => void;
    onDiscardMatch: (match: AutoMatch) => void;
    onConfirmAllMatches: () => void;
    onRemoveIrrelevant: (tag: AutoMatch) => void;
    onKeepIrrelevant: (tag: AutoMatch) => void;
    onUndoKeepIrrelevant: (tag: AutoMatch) => void;
    onRemoveAllIrrelevant: () => void;
    onApplyAllChanges: () => void;
    keptMapIds: Set<number>;
    confirmingMatchKey?: string | null;
    confirmingAll?: boolean;
    removingMapId?: number | null;
    removingAll?: boolean;
}

export default function AutoDetectReviewModal({
    isOpen,
    onClose,
    autoMatches,
    irrelevantTags,
    activeTab,
    onTabChange,
    previewMatch,
    onPreviewMatch,
    onConfirmMatch,
    onDiscardMatch,
    onConfirmAllMatches,
    onRemoveIrrelevant,
    onKeepIrrelevant,
    onUndoKeepIrrelevant,
    onRemoveAllIrrelevant,
    onApplyAllChanges,
    keptMapIds,
    confirmingMatchKey,
    confirmingAll = false,
    removingMapId,
    removingAll = false,
}: AutoDetectReviewModalProps) {
    if (!isOpen) return null;

    const unkeptIrrelevant = (irrelevantTags || []).filter((t) => t.map_id != null && !keptMapIds.has(t.map_id));
    const unkeptCount = unkeptIrrelevant.length;
    const matchesCount = autoMatches?.length || 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Auto-Detect Review"
            subtitle="Review matched text tags and cleanup suggestions"
            icon={<Scan className="h-5 w-5 text-primary" />}
            size="2xl"
            footer={
                <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-gray-400" />
                        {unkeptCount} irrelevant · {matchesCount} new
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-outline-secondary btn-sm px-4"
                            disabled={confirmingAll || removingAll}
                        >
                            Close
                        </button>
                        {unkeptCount > 0 && matchesCount > 0 && (
                            <button
                                type="button"
                                onClick={onApplyAllChanges}
                                className="btn btn-primary btn-sm px-4 gap-1.5"
                                disabled={confirmingAll || removingAll}
                            >
                                {(confirmingAll || removingAll) ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <CheckCheck className="h-3.5 w-3.5" />
                                )}
                                Apply All
                            </button>
                        )}
                        {activeTab === 'cleanup' && unkeptCount > 0 && (
                            <button
                                type="button"
                                onClick={onRemoveAllIrrelevant}
                                className="btn btn-danger btn-sm px-4 gap-1.5"
                                disabled={removingAll}
                            >
                                {removingAll ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                )}
                                Remove All ({unkeptCount})
                            </button>
                        )}
                        {activeTab === 'matches' && matchesCount > 0 && (
                            <button
                                type="button"
                                onClick={onConfirmAllMatches}
                                className="btn btn-primary btn-sm px-4 gap-1.5"
                                disabled={confirmingAll}
                            >
                                {confirmingAll ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                Confirm All ({matchesCount})
                            </button>
                        )}
                    </div>
                </div>
            }
        >
            {/* Tabs */}
            <div className="-mx-5 -mt-4 mb-4 flex border-b border-gray-100 dark:border-gray-800 px-1">
                <button
                    type="button"
                    className={`flex items-center gap-2 py-2.5 px-4 text-xs font-medium border-b-2 transition-colors ${
                        activeTab === 'cleanup'
                            ? 'border-danger text-danger'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                    onClick={() => onTabChange('cleanup')}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    Irrelevant Tags
                    {(irrelevantTags?.length ?? 0) > 0 && (
                        <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger tabular-nums">
                            {irrelevantTags?.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    className={`flex items-center gap-2 py-2.5 px-4 text-xs font-medium border-b-2 transition-colors ${
                        activeTab === 'matches'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                    onClick={() => onTabChange('matches')}
                >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    New Matches
                    {(autoMatches?.length ?? 0) > 0 && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                            {autoMatches?.length}
                        </span>
                    )}
                </button>
            </div>

            {activeTab === 'cleanup' ? (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>These tags belong to assets outside the linked hierarchy. Click a row to preview on canvas.</span>
                    </div>

                    {!irrelevantTags || irrelevantTags.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-400 dark:text-gray-500 flex flex-col items-center gap-1.5">
                            <CheckCircle2 className="h-6 w-6 text-gray-300 dark:text-gray-600" />
                            <span>No irrelevant tags found.</span>
                        </div>
                    ) : (
                        <ul className="space-y-1.5">
                            {irrelevantTags.map((tag) => {
                                const isKept = tag.map_id != null && keptMapIds.has(tag.map_id);
                                const isPreview =
                                    (previewMatch?.map_id && previewMatch.map_id === tag.map_id) ||
                                    previewMatch?.key === tag.key;
                                return (
                                    <li
                                        key={tag.key}
                                        className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 text-xs transition-colors ${
                                            isPreview
                                                ? 'border-danger/50 bg-danger/5'
                                                : isKept
                                                ? 'border-gray-200 dark:border-gray-700 opacity-60'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                        onClick={() => onPreviewMatch(tag, 'irrelevant')}
                                    >
                                        <div className="min-w-0 flex-1 mr-3">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-900 dark:text-white truncate">
                                                    {tag.asset_name}
                                                </span>
                                                {isKept && (
                                                    <span className="badge badge-outline-success text-[10px] py-0 px-1.5">
                                                        Kept
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                                                <span className="font-mono text-danger">p.{tag.page_no}</span>
                                                {tag.matched_text && (
                                                    <>
                                                        <span>·</span>
                                                        <span className="font-mono">&quot;{tag.matched_text}&quot;</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isKept ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-outline-secondary btn-xs px-2.5"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onUndoKeepIrrelevant(tag);
                                                    }}
                                                >
                                                    Undo
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-danger btn-xs px-2.5"
                                                        disabled={removingMapId === tag.map_id || removingAll}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onRemoveIrrelevant(tag);
                                                        }}
                                                    >
                                                        {removingMapId === tag.map_id ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            'Remove'
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-secondary btn-xs px-2.5"
                                                        disabled={removingAll}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onKeepIrrelevant(tag);
                                                        }}
                                                    >
                                                        Keep
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                        <Info className="h-3.5 w-3.5 shrink-0" />
                        <span>Asset tag text found matching equipment under hierarchy. Click a row to preview, then confirm or discard.</span>
                    </div>

                    {!autoMatches || autoMatches.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-400 dark:text-gray-500 flex flex-col items-center gap-1.5">
                            <CheckCircle2 className="h-6 w-6 text-gray-300 dark:text-gray-600" />
                            <span>No untagged matches remaining.</span>
                        </div>
                    ) : (
                        <ul className="space-y-1.5">
                            {autoMatches.map((m) => {
                                const isPreview = previewMatch?.key === m.key;
                                return (
                                    <li
                                        key={m.key}
                                        className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 text-xs transition-colors ${
                                            isPreview
                                                ? 'border-primary/50 bg-primary/5'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                        onClick={() => onPreviewMatch(m, 'match')}
                                    >
                                        <div className="min-w-0 flex-1 mr-3">
                                            <div className="font-medium text-gray-900 dark:text-white truncate">
                                                {m.asset_name}
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                                                <span className="font-mono text-primary">p.{m.page_no}</span>
                                                <span>·</span>
                                                <span className="font-mono">&quot;{m.matched_text}&quot;</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                className="btn btn-outline-primary btn-xs px-2.5"
                                                disabled={confirmingMatchKey === m.key || confirmingAll}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onConfirmMatch(m);
                                                }}
                                            >
                                                {confirmingMatchKey === m.key ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    'Confirm'
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-outline-secondary btn-xs px-2.5"
                                                disabled={confirmingAll}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDiscardMatch(m);
                                                }}
                                            >
                                                Discard
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </Modal>
    );
}
