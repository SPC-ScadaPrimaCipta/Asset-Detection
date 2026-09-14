'use client';

import React from 'react';
import Link from 'next/link';

export default function RiskMappingListLoading() {
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
                    <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Risk Mapping</span>
                </li>
            </ul>

            <div className="panel p-4 sm:p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0e1726] shadow-sm">
                {/* Header Row Skeleton */}
                <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
                    <div className="space-y-2">
                        <div className="h-6 w-48 sm:w-64 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
                        <div className="h-3.5 w-72 sm:w-96 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="h-9 w-28 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
                        <div className="h-9 w-36 rounded-lg bg-primary/30 animate-pulse" />
                    </div>
                </div>

                {/* Filter / Search Bar Skeleton */}
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="h-9 w-64 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse" />
                    <div className="flex items-center gap-2">
                        <div className="h-9 w-24 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse" />
                    </div>
                </div>

                {/* Table Rows Skeleton */}
                <div className="space-y-2.5">
                    {/* Table Header */}
                    <div className="h-10 w-full rounded-lg bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 animate-pulse" />
                    {/* Table Data Rows */}
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div
                            key={i}
                            className="h-14 w-full rounded-lg bg-gray-50/80 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 flex items-center justify-between px-4 animate-pulse"
                        >
                            <div className="flex items-center gap-3">
                                <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded" />
                                <div className="space-y-1.5">
                                    <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
                                    <div className="h-2.5 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="h-5 w-16 bg-primary/10 rounded-full" />
                                <div className="h-5 w-24 bg-emerald-500/10 rounded-full" />
                                <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
