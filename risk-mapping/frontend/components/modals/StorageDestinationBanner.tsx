'use client';

import React from 'react';
import { Cloud, Database, HardDrive, Loader2 } from 'lucide-react';
import { useStorageInfo, StorageBackendType } from '@/lib/hooks/useStorageInfo';

export interface StorageDestinationBannerProps {
    compact?: boolean;
    className?: string;
}

export function getStorageLabel(backend: StorageBackendType): string {
    switch (backend) {
        case 'sharepoint':
            return 'SharePoint';
        case 's3':
            return 'S3 Storage';
        case 'local':
        default:
            return 'Local Disk (VPS)';
    }
}

export default function StorageDestinationBanner({ compact = false, className = '' }: StorageDestinationBannerProps) {
    const { backend, loading } = useStorageInfo();

    if (loading) {
        return (
            <div className={`inline-flex items-center gap-1.5 text-[11px] text-gray-400 animate-pulse ${className}`}>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Checking storage destination...</span>
            </div>
        );
    }

    const currentBackend = backend || 'local';

    if (compact) {
        return (
            <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    currentBackend === 'sharepoint'
                        ? 'bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20'
                        : currentBackend === 's3'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                } ${className}`}
                title={`Uploaded files will be saved to ${getStorageLabel(currentBackend)}`}
            >
                {currentBackend === 'sharepoint' && <Cloud className="h-3 w-3 shrink-0 text-[#0078D4]" />}
                {currentBackend === 's3' && <Database className="h-3 w-3 shrink-0 text-amber-500" />}
                {currentBackend === 'local' && <HardDrive className="h-3 w-3 shrink-0 text-gray-500" />}
                <span>{getStorageLabel(currentBackend)}</span>
            </span>
        );
    }

    return (
        <div
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border ${
                currentBackend === 'sharepoint'
                    ? 'border-[#0078D4]/25 bg-[#0078D4]/5 text-[#0078D4]'
                    : currentBackend === 's3'
                    ? 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                    : 'border-gray-200 bg-gray-50/80 text-gray-700 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-300'
            } ${className}`}
        >
            {currentBackend === 'sharepoint' && <Cloud className="h-4 w-4 shrink-0 text-[#0078D4]" />}
            {currentBackend === 's3' && <Database className="h-4 w-4 shrink-0 text-amber-500" />}
            {currentBackend === 'local' && <HardDrive className="h-4 w-4 shrink-0 text-gray-500" />}

            <div className="flex flex-wrap items-center gap-1">
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">Destination:</span>
                <span className="font-bold">{getStorageLabel(currentBackend)}</span>
                <span className="text-[10px] text-gray-400 ml-1">
                    {currentBackend === 'sharepoint' && '· Files will sync to Microsoft SharePoint drive'}
                    {currentBackend === 's3' && '· Files will upload directly to S3-compatible cloud bucket'}
                    {currentBackend === 'local' && '· Files stored on local server storage volume'}
                </span>
            </div>
        </div>
    );
}
