'use client';

import React from 'react';
import Link from 'next/link';
import { FileText, AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

interface RiskMappingViewerSkeletonProps {
    error?: {
        title?: string;
        message?: string;
        details?: string;
        onRetry?: () => void;
    } | null;
}

export default function RiskMappingViewerSkeleton({ error }: RiskMappingViewerSkeletonProps) {
    return (
        <div className="animate-in fade-in duration-300">
            {/* Breadcrumb Skeleton */}
            <ul className="mb-6 flex items-center space-x-2 rtl:space-x-reverse">
                <li>
                    <Link href="#" className="text-gray-400 dark:text-gray-500 text-sm hover:underline">
                        Risk Analysis
                    </Link>
                </li>
                <li className="before:content-['/'] ltr:before:mr-2 rtl:before:ml-2 text-gray-400">
                    <Link href="/risk-analysis/risk-mapping" className="text-gray-400 dark:text-gray-500 text-sm hover:underline">
                        Risk Mapping
                    </Link>
                </li>
                <li className="before:content-['/'] ltr:before:mr-2 rtl:before:ml-2">
                    {error ? (
                        <span className="text-danger font-medium text-sm">Not Found</span>
                    ) : (
                        <div className="h-4 w-40 sm:w-56 bg-gray-200 dark:bg-gray-700 rounded-md animate-pulse inline-block align-middle" />
                    )}
                </li>
            </ul>

            <div className="relative">
                <div className="panel p-4 sm:p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0e1726] shadow-sm">
                    {/* Tier 1: Document Header & Selectors Skeleton */}
                    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-gray-100 dark:border-gray-800/80 pb-3">
                        {/* Left: Title & Badges */}
                        <div className="min-w-0 max-w-full lg:max-w-[65%] space-y-2.5">
                            {/* Main Title bar */}
                            <div className="h-6 w-64 sm:w-96 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
                            {/* Badges row */}
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="h-5 w-28 rounded-full bg-primary/15 border border-primary/20 animate-pulse" />
                                <div className="h-5 w-16 rounded-full bg-primary/10 border border-primary/20 animate-pulse" />
                                <div className="h-5 w-36 rounded-full bg-emerald-500/15 border border-emerald-500/20 animate-pulse" />
                                <div className="h-5 w-24 rounded-full bg-indigo-500/15 border border-indigo-500/20 animate-pulse" />
                                <div className="h-5 w-32 rounded-full bg-amber-500/15 border border-amber-500/20 animate-pulse" />
                            </div>
                        </div>

                        {/* Right: Selectors & Edit Button */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <div className="flex flex-wrap items-center gap-2">
                                {/* Model Selector Skeleton */}
                                <div className="h-9 w-44 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse" />
                                {/* Version Selector Skeleton */}
                                <div className="h-9 w-32 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse" />
                            </div>
                            {/* Edit Drawing skeleton */}
                            <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                        </div>
                    </div>

                    {/* Tier 2: Studio Toolbar Skeleton */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-gray-200/90 dark:border-gray-700/80 bg-gray-50/60 dark:bg-gray-800/50 p-2">
                        {/* Left: Nav & Zoom */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Page Nav */}
                            <div className="h-8 w-28 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 animate-pulse" />
                            {/* Zoom controls */}
                            <div className="h-8 w-36 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 animate-pulse" />
                        </div>

                        {/* Right: Tools & Export */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Mode Switcher */}
                            <div className="h-8 w-40 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 animate-pulse" />
                            {/* Tagged assets drawer button */}
                            <div className="h-8 w-28 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 animate-pulse" />
                            {/* Tools dropdown */}
                            <div className="h-8 w-20 rounded-lg bg-gray-200/80 dark:bg-gray-700/80 animate-pulse" />
                            {/* Layout & Export */}
                            <div className="h-8 w-36 rounded-lg bg-primary/25 border border-primary/30 animate-pulse" />
                        </div>
                    </div>

                    {/* Canvas Viewport Skeleton */}
                    <div className="relative h-[calc(100vh-270px)] min-h-[520px] rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100/70 dark:bg-gray-900/60 flex items-center justify-center overflow-hidden">
                        {/* Engineering Blueprint Grid Pattern */}
                        <div
                            className="absolute inset-0 opacity-40 dark:opacity-20"
                            style={{
                                backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
                                backgroundSize: '24px 24px',
                            }}
                        />

                        {/* Simulated Tag Highlight Box Skeletons on Canvas */}
                        <div className="absolute top-[22%] left-[18%] w-32 h-14 rounded border border-dashed border-primary/40 bg-primary/10 animate-pulse flex items-center justify-center">
                            <div className="h-2.5 w-16 bg-primary/30 rounded" />
                        </div>
                        <div className="absolute top-[48%] left-[55%] w-40 h-16 rounded border border-dashed border-emerald-500/40 bg-emerald-500/10 animate-pulse flex items-center justify-center">
                            <div className="h-2.5 w-20 bg-emerald-500/30 rounded" />
                        </div>
                        <div className="absolute top-[35%] right-[15%] w-36 h-12 rounded border border-dashed border-amber-500/40 bg-amber-500/10 animate-pulse flex items-center justify-center">
                            <div className="h-2.5 w-18 bg-amber-500/30 rounded" />
                        </div>

                        {/* Bottom-Right Title Block Skeleton */}
                        <div className="absolute bottom-4 right-4 w-56 h-20 rounded-lg border border-gray-300 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 p-2.5 shadow-sm space-y-1.5 backdrop-blur-xs">
                            <div className="h-2.5 w-24 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                            <div className="h-2 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                            <div className="h-2 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                        </div>

                        {/* Center Card: Error State or Loading Shimmer */}
                        {error ? (
                            <div className="relative z-10 flex flex-col items-center gap-3.5 p-6 sm:p-8 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white/95 dark:bg-[#0e1726]/95 shadow-2xl backdrop-blur-md max-w-md text-center animate-in fade-in zoom-in-95 duration-200">
                                <div className="h-14 w-14 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400">
                                    <AlertTriangle className="h-7 w-7" />
                                </div>
                                <div className="space-y-1.5">
                                    <h5 className="text-base font-bold text-gray-900 dark:text-white">
                                        {error.title || 'Process Flow Diagram Not Found'}
                                    </h5>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {error.message || 'The requested drawing could not be found or has been deleted from the database.'}
                                    </p>
                                    {error.details && (
                                        <p className="text-[11px] font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded mt-2">
                                            {error.details}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                                    {error.onRetry && (
                                        <button
                                            type="button"
                                            onClick={error.onRetry}
                                            className="btn btn-primary btn-sm gap-1.5 rounded-lg shadow-sm"
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            <span>Retry</span>
                                        </button>
                                    )}
                                    <Link
                                        href="/risk-analysis/risk-mapping"
                                        className="btn btn-outline-secondary btn-sm gap-1.5 rounded-lg"
                                    >
                                        <ArrowLeft className="h-3.5 w-3.5" />
                                        <span>Back to Drawings</span>
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <div className="relative z-10 flex flex-col items-center gap-3.5 p-6 sm:p-8 rounded-2xl border border-gray-200/90 dark:border-gray-700/80 bg-white/85 dark:bg-[#0e1726]/85 shadow-2xl backdrop-blur-md max-w-sm text-center">
                                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                                    <FileText className="h-6 w-6 animate-pulse" />
                                </div>
                                <div className="space-y-1">
                                    <h6 className="text-sm font-bold text-gray-900 dark:text-white">
                                        Loading Process Flow Diagram
                                    </h6>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Fetching drawing layers, tags, and risk analysis models...
                                    </p>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                    <div className="bg-primary h-full w-2/3 rounded-full animate-pulse" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
