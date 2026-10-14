'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { DxfViewer as DxfViewerEngine, type LayerInfo } from 'dxf-viewer';
import { ArrowsOutSimple, Eye, EyeSlash, MagnifyingGlassPlus, MagnifyingGlassMinus } from '@phosphor-icons/react';

export interface DxfViewerProps {
  url: string;
  detections?: Array<{
    id: string;
    asset_tag: string | null;
    asset_type: string;
    confidence: number | null;
    bbox_x: number | null;
    bbox_y: number | null;
    bbox_w: number | null;
    bbox_h: number | null;
    detection_status: string;
    review_status: string;
  }>;
  selectedId?: string | null;
  onSelectAsset?: (id: string) => void;
  showAll?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function DxfViewer({
  url,
  detections = [],
  selectedId = null,
  onSelectAsset,
  showAll = true,
  className,
  style,
}: DxfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DxfViewerEngine | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadPhase, setLoadPhase] = useState<string>('Loading...');
  const [loadPercent, setLoadPercent] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showLayerPanel, setShowLayerPanel] = useState(false);

  // Initialize viewer on mount
  useEffect(() => {
    if (!containerRef.current) return;

    // Reset previous instance if any
    if (viewerRef.current) {
      try {
        viewerRef.current.Destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
    }

    setLoading(true);
    setError(null);
    setLoadPhase('Initializing WebGL CAD viewer...');
    setLoadPercent(0);

    let viewer: DxfViewerEngine | null = null;
    let isCancelled = false;

    try {
      viewer = new DxfViewerEngine(containerRef.current, {
        autoResize: true,
        clearColor: new THREE.Color(0x161719), // AutoCAD dark gray theme
        colorCorrection: true,
        antialias: true,
      });
      viewerRef.current = viewer;

      // Create group in scene for detection bbox overlays
      const overlayGroup = new THREE.Group();
      overlayGroup.name = '__detections_overlay__';
      viewer.GetScene().add(overlayGroup);
      overlayGroupRef.current = overlayGroup;

      viewer
        .Load({
          url,
          fonts: ['/fonts/default.ttf'],
          progressCbk: (phase, processed, total) => {
            if (isCancelled) return;
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            setLoadPhase(
              phase === 'fetch'
                ? 'Downloading CAD drawing...'
                : phase === 'parse'
                  ? 'Parsing CAD entities...'
                  : phase === 'prepare'
                    ? 'Preparing WebGL scene...'
                    : 'Loading fonts...'
            );
            setLoadPercent(pct);
          },
        })
        .then(() => {
          if (isCancelled || !viewer) return;
          setLoading(false);

          // Collect drawing layers for layer toggles
          const detectedLayers = Array.from(viewer.GetLayers(true));
          setLayers(detectedLayers);

          // Initial render
          viewer.Render();
        })
        .catch((err: unknown) => {
          if (isCancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[DxfViewer Load Error]', msg);
          setError(`Gagal memuat CAD DXF: ${msg}`);
          setLoading(false);
        });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DxfViewer Init Error]', msg);
      setError(`WebGL CAD Error: ${msg}`);
      setLoading(false);
    }

    return () => {
      isCancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.Destroy();
        } catch {
          /* ignore */
        }
        viewerRef.current = null;
      }
    };
  }, [url]);

  // Update detection overlays whenever detections, selection, or bounds change
  useEffect(() => {
    const viewer = viewerRef.current;
    const group = overlayGroupRef.current;
    if (!viewer || !group || loading) return;

    // Clear previous bbox objects
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if ('geometry' in child && child.geometry instanceof THREE.BufferGeometry) {
        child.geometry.dispose();
      }
      if ('material' in child && child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }

    const bounds = viewer.GetBounds();
    const origin = viewer.GetOrigin();
    if (!bounds || !origin) return;

    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    if (spanX <= 0 || spanY <= 0) return;

    const validDetections = (showAll ? detections : detections.filter((d) => d.id === selectedId)).filter(
      (d) =>
        d.detection_status !== 'REJECTED' &&
        d.review_status !== 'REJECTED' &&
        d.bbox_x !== null &&
        d.bbox_y !== null &&
        d.bbox_w !== null &&
        d.bbox_h !== null
    );

    for (const d of validDetections) {
      const isSelected = d.id === selectedId;

      // Convert 0-1000 normalized to DXF World coordinates
      const worldX = bounds.minX + ((d.bbox_x ?? 0) / 1000) * spanX;
      const worldY = bounds.maxY - ((d.bbox_y ?? 0) / 1000) * spanY;
      const worldW = ((d.bbox_w ?? 0) / 1000) * spanX;
      const worldH = ((d.bbox_h ?? 0) / 1000) * spanY;

      // Adjust relative to DxfViewer scene origin
      const sx = worldX - origin.x;
      const sy = worldY - origin.y;

      // 4 corners of rectangle (Z slightly elevated so it renders above drawing lines)
      const z = 0.05;
      const points = [
        new THREE.Vector3(sx, sy, z),
        new THREE.Vector3(sx + worldW, sy, z),
        new THREE.Vector3(sx + worldW, sy - worldH, z),
        new THREE.Vector3(sx, sy - worldH, z),
        new THREE.Vector3(sx, sy, z), // close loop
      ];

      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const color = isSelected ? 0x00ffff : 0x00e676; // Cyan for selected, Emerald for detected
      const lineMat = new THREE.LineBasicMaterial({
        color,
        linewidth: isSelected ? 3 : 1.5,
        depthTest: false,
      });

      const line = new THREE.Line(lineGeom, lineMat);
      line.userData = { detectionId: d.id };
      group.add(line);
    }

    viewer.Render();
  }, [detections, selectedId, showAll, loading]);

  // Control handlers
  const handleFitView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const bounds = viewer.GetBounds();
    const origin = viewer.GetOrigin();
    if (bounds && origin) {
      viewer.FitView(
        bounds.minX - origin.x,
        bounds.maxX - origin.x,
        bounds.minY - origin.y,
        bounds.maxY - origin.y
      );
      viewer.Render();
    }
  }, []);

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const cam = viewer.GetCamera();
    if (cam) {
      cam.zoom *= direction === 'in' ? 1.3 : 0.77;
      cam.updateProjectionMatrix();
      viewer.Render();
    }
  }, []);

  const toggleLayer = useCallback((layerName: string) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      const isHidden = next.has(layerName);
      if (isHidden) {
        next.delete(layerName);
        viewer.ShowLayer(layerName, true);
      } else {
        next.add(layerName);
        viewer.ShowLayer(layerName, false);
      }
      viewer.Render();
      return next;
    });
  }, []);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '480px',
        background: '#161719',
        overflow: 'hidden',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* WebGL Canvas Container */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0,
        }}
      />

      {/* Loading overlay */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(22, 23, 25, 0.85)',
            backdropFilter: 'blur(4px)',
            zIndex: 10,
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '3px solid rgba(255,255,255,0.1)',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <div style={{ color: '#f3f4f6', fontSize: '13px', fontWeight: 500 }}>
            {loadPhase} {loadPercent > 0 ? `(${loadPercent}%)` : ''}
          </div>
          <div style={{ color: '#9ca3af', fontSize: '11px' }}>
            Akselerasi GPU WebGL — Me-render CAD drawing asli
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(22, 23, 25, 0.9)',
            zIndex: 10,
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              background: '#2563eb',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
            }}
          >
            Muat Ulang
          </button>
        </div>
      )}

      {/* CAD Floating HUD Controls */}
      {!loading && !error && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            display: 'flex',
            gap: '6px',
            zIndex: 5,
            background: 'rgba(24, 27, 31, 0.85)',
            backdropFilter: 'blur(8px)',
            padding: '4px 6px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <button
            type="button"
            onClick={handleFitView}
            title="Fit to Screen"
            style={{
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#e5e7eb',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
            }}
          >
            <ArrowsOutSimple size={16} />
            <span>Fit</span>
          </button>

          <button
            type="button"
            onClick={() => handleZoom('in')}
            title="Zoom In"
            style={{
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#e5e7eb',
              cursor: 'pointer',
            }}
          >
            <MagnifyingGlassPlus size={16} />
          </button>

          <button
            type="button"
            onClick={() => handleZoom('out')}
            title="Zoom Out"
            style={{
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#e5e7eb',
              cursor: 'pointer',
            }}
          >
            <MagnifyingGlassMinus size={16} />
          </button>

          {layers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLayerPanel((v) => !v)}
              title="CAD Layers"
              style={{
                padding: '6px 10px',
                background: showLayerPanel ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                border: 'none',
                borderRadius: '5px',
                color: showLayerPanel ? '#60a5fa' : '#e5e7eb',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
              }}
            >
              <span>Layers ({layers.length})</span>
            </button>
          )}
        </div>
      )}

      {/* Layers Panel Flyout */}
      {showLayerPanel && (
        <div
          style={{
            position: 'absolute',
            top: '52px',
            right: '12px',
            width: '240px',
            maxHeight: '320px',
            background: 'rgba(24, 27, 31, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '10px',
            zIndex: 6,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#9ca3af',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px',
              paddingBottom: '6px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            CAD Layers Visibility
          </div>
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {layers.map((l) => {
              const isHidden = hiddenLayers.has(l.name);
              const colorHex = '#' + l.color.toString(16).padStart(6, '0');
              return (
                <button
                  key={l.name}
                  type="button"
                  onClick={() => toggleLayer(l.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    background: isHidden ? 'transparent' : 'rgba(255, 255, 255, 0.04)',
                    border: 'none',
                    color: isHidden ? '#6b7280' : '#e5e7eb',
                    fontSize: '11px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '2px',
                        backgroundColor: colorHex,
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ textDecoration: isHidden ? 'line-through' : 'none' }}>
                      {l.displayName || l.name}
                    </span>
                  </span>
                  {isHidden ? <EyeSlash size={14} /> : <Eye size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CAD Model status badge */}
      {!loading && !error && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '12px',
            background: 'rgba(20, 22, 25, 0.75)',
            backdropFilter: 'blur(4px)',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#9ca3af',
            pointerEvents: 'none',
            zIndex: 5,
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          AutoCAD Model Space • WebGL Hardware Accelerated
        </div>
      )}
    </div>
  );
}
