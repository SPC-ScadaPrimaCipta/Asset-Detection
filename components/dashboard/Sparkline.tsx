'use client';

import React from 'react';

interface SparklineProps {
  data?: number[];
  positive?: boolean;
  width?: number;
  height?: number;
}

export default function Sparkline({
  data = [12, 18, 14, 22, 28, 24, 34, 38],
  positive = true,
  width = 90,
  height = 42,
}: SparklineProps) {
  const color = positive ? 'var(--success, #2FB584)' : 'var(--danger, #E5677B)';
  const gradientId = `spark-grad-${positive ? 'pos' : 'neg'}-${Math.random().toString(36).substr(2, 5)}`;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Compute points
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (width - 4) + 2;
    const y = height - ((d - min) / range) * (height - 8) - 4;
    return { x, y };
  });

  // SVG path for line
  const linePath = points.reduce((acc, curr, idx, arr) => {
    if (idx === 0) return `M ${curr.x} ${curr.y}`;
    const prev = arr[idx - 1];
    const cpX = (prev.x + curr.x) / 2;
    return `${acc} C ${cpX} ${prev.y}, ${cpX} ${curr.y}, ${curr.x} ${curr.y}`;
  }, '');

  // Closed path for gradient fill
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
