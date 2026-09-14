'use client';

import { useState } from 'react';
import { Loader2, Scan, Layers, Search, CheckCircle2, Info, ChevronDown, ChevronUp } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import ComponentTreeView from '@/components/risk-analysis/ComponentTreeView';

export interface AssetData {
    asset_id: number;
    asset_name: string;
    [key: string]: any;
}

export interface AutoTagConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    targetAsset: AssetData | null;
    onTargetAssetChange: (asset: AssetData | null) => void;
    onScan: (assetId?: number) => void | Promise<void>;
    isScanning?: boolean;
}

export default function AutoTagConfirmModal({
    isOpen,
    onClose,
    targetAsset,
    onTargetAssetChange,
    onScan,
    isScanning = false,
}: AutoTagConfirmModalProps) {
    const [showAssetTree, setShowAssetTree] = useState(false);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Auto-Detect Assets"
            subtitle="Scan drawing text layer for untagged assets"
            icon={<Scan className="h-5 w-5 text-primary" />}
            size="lg"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-outline-secondary btn-sm px-4"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={!targetAsset || isScanning}
                        className="btn btn-primary btn-sm px-5 gap-1.5"
                        onClick={() => onScan(targetAsset?.asset_id)}
                    >
                        {isScanning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Search className="h-3.5 w-3.5" />
                        )}
                        Scan Drawing
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                {/* Linked Asset */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5" />
                            Target Asset Hierarchy
                        </span>
                        <button
                            type="button"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => setShowAssetTree((p) => !p)}
                        >
                            {showAssetTree ? (
                                <>
                                    <span>Collapse</span>
                                    <ChevronUp className="h-3 w-3" />
                                </>
                            ) : (
                                <>
                                    <span>Change Asset</span>
                                    <ChevronDown className="h-3 w-3" />
                                </>
                            )}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {targetAsset?.asset_name || <span className="text-gray-400 font-normal">No linked asset</span>}
                        </span>
                        {targetAsset && (
                            <span className="text-[11px] text-gray-400 font-mono">#{targetAsset.asset_id}</span>
                        )}
                    </div>
                    {showAssetTree && (
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-900 custom-scroll mt-1">
                            <ComponentTreeView
                                initialSelectedAssetId={targetAsset?.asset_id}
                                showModelSelector={false}
                                showTreeTypeToggle={false}
                                onAssetSelect={(a) => {
                                    if (a) onTargetAssetChange(a);
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Scan Scope & Rules */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-xs text-gray-600 dark:text-gray-400 space-y-2">
                    <div className="font-medium text-gray-700 dark:text-gray-300">Scan Scope:</div>
                    <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                            <Search className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                            <span>Search PDF vector text for untagged equipment and piping under the linked asset</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
                            <span>Identify existing tags outside this hierarchy for clean-up review</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500 pt-1 border-t border-gray-100 dark:border-gray-800">
                        <Info className="h-3 w-3 shrink-0" />
                        <span>No changes are applied until you review and confirm the matches.</span>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
