'use client';

import React, { useState } from 'react';
import { Card, CardHeader } from '@/components/ui';

interface DataPoint {
  day: string;
  count: number;
}

const DEFAULT_DATA: DataPoint[] = [
  { day: 'Mon', count: 120 },
  { day: 'Tue', count: 180 },
  { day: 'Wed', count: 150 },
  { day: 'Thu', count: 320 },
  { day: 'Fri', count: 260 },
  { day: 'Sat', count: 380 },
  { day: 'Sun', count: 290 },
];

export default function ActivityChart({
  data = DEFAULT_DATA,
  title = 'Latest Detections Activity',
}: {
  data?: DataPoint[];
  title?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(3); // Default hover on peak

  const svgWidth = 640;
  const svgHeight = 220;
  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartW = svgWidth - paddingLeft - paddingRight;
  const chartH = svgHeight - paddingTop - paddingBottom;

  const yMax = 400;
  const yTicks = [0, 100, 200, 300, 400];

  const points = data.map((d, i) => {
    const x = paddingLeft + (i / (data.length - 1)) * chartW;
    const y = paddingTop + chartH - (d.count / yMax) * chartH;
    return { ...d, x, y };
  });

  // Generate smooth monotone curve path
  const linePath = points.reduce((acc, curr, idx, arr) => {
    if (idx === 0) return `M ${curr.x} ${curr.y}`;
    const prev = arr[idx - 1];
    const cpX = (prev.x + curr.x) / 2;
    return `${acc} C ${cpX} ${prev.y}, ${cpX} ${curr.y}, ${curr.x} ${curr.y}`;
  }, '');

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartH} L ${points[0].x} ${paddingTop + chartH} Z`;

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <Card padding={24}>
      <CardHeader title={title} subtitle="Asset extraction & pipeline volume over the past 7 days" />

      <div style={{ width: '100%', position: 'relative', overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id="activity-chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines */}
          {yTicks.map((tick) => {
            const y = paddingTop + chartH - (tick / yMax) * chartH;
            return (
              <g key={tick}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontFamily="inherit"
                  className="tabular-nums"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Area gradient fill */}
          <path d={areaPath} fill="url(#activity-chart-grad)" />

          {/* Monotone curve line */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Active point vertical dotted line & indicator */}
          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={paddingTop}
                x2={activePoint.x}
                y2={paddingTop + chartH}
                stroke="var(--primary)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.6"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="6"
                fill="var(--surface)"
                stroke="var(--primary)"
                strokeWidth="3"
                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}
              />
            </g>
          )}

          {/* X Axis Labels and Hover Hitboxes */}
          {points.map((p, i) => (
            <g key={p.day}>
              <text
                x={p.x}
                y={svgHeight - 8}
                textAnchor="middle"
                fill={hoveredIdx === i ? 'var(--primary)' : 'var(--text-muted)'}
                fontSize="11"
                fontWeight={hoveredIdx === i ? '600' : '400'}
                fontFamily="inherit"
              >
                {p.day}
              </text>
              {/* Invisible interactive hover rect */}
              <rect
                x={p.x - chartW / (data.length * 2)}
                y={0}
                width={chartW / data.length}
                height={svgHeight}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIdx(i)}
              />
            </g>
          ))}
        </svg>

        {/* Hover Tooltip Overlay */}
        {activePoint && (
          <div
            style={{
              position: 'absolute',
              left: `${(activePoint.x / svgWidth) * 100}%`,
              top: `${(activePoint.y / svgHeight) * 100}%`,
              transform: 'translate(-50%, -130%)',
              background: 'var(--info)',
              color: '#FFFFFF',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 12px rgba(59, 143, 232, 0.35)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {activePoint.count} assets
            {/* Tooltip arrow */}
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '5px solid var(--info)',
              }}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
