'use client';

import React, { useState } from 'react';
import { X, FloppyDisk, Plus, Tag, Info } from '@phosphor-icons/react';

export interface ManualAssetFormData {
  assetTag: string;
  assetType: string;
  description: string;
  service: string;
  size: string;
  equipmentClass: string;
}

export interface BoundingBoxCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AddManualAssetModalProps {
  isOpen: boolean;
  documentId: string;
  pidPage: number;
  bbox: BoundingBoxCoords;
  onClose: () => void;
  onSuccess: (newDetection: any) => void;
}

const COMMON_ASSET_TYPES = [
  'Pump',
  'Centrifugal Pump',
  'Positive Displacement Pump',
  'Vessel',
  'Horizontal Vessel',
  'Vertical Vessel',
  'Separator',
  'Tank',
  'Storage Tank',
  'Heat Exchanger',
  'Shell & Tube Heat Exchanger',
  'Air Cooler',
  'Compressor',
  'Filter',
  'Strainer',
  'Valve',
  'Gate Valve',
  'Globe Valve',
  'Ball Valve',
  'Check Valve',
  'Butterfly Valve',
  'Control Valve',
  'Safety Valve (PSV)',
  'Instrument',
  'Flow Meter',
  'Pressure Transmitter',
  'Temperature Gauge',
];

export default function AddManualAssetModal({
  isOpen,
  documentId,
  pidPage,
  bbox,
  onClose,
  onSuccess,
}: AddManualAssetModalProps) {
  const [assetTag, setAssetTag] = useState('');
  const [assetType, setAssetType] = useState('Pump');
  const [description, setDescription] = useState('');
  const [service, setService] = useState('');
  const [size, setSize] = useState('');
  const [equipmentClass, setEquipmentClass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetTag.trim()) {
      setError('Asset Tag wajib diisi (contoh: P-101A)');
      return;
    }
    if (!assetType.trim()) {
      setError('Asset Type wajib dipilih');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/detections/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          pidPage,
          assetTag: assetTag.trim().toUpperCase(),
          assetType: assetType.trim(),
          description: description.trim(),
          service: service.trim(),
          size: size.trim(),
          equipmentClass: equipmentClass.trim() || assetType.trim(),
          bbox,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan asset manual');
      }

      onSuccess(data.data);
      onClose();
    } catch (err: any) {
      console.error('[AddManualAssetModal] submit error:', err);
      setError(err.message || 'Terjadi kesalahan sistem');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 38,
    padding: '0 12px',
    borderRadius: 'var(--radius-button, 10px)',
    border: '1px solid var(--border)',
    background: 'var(--surface-muted, rgba(255,255,255,0.04))',
    color: 'var(--foreground)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--foreground)',
    marginBottom: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card, 20px)',
          boxShadow: 'var(--shadow-card, 0 16px 40px rgba(0,0,0,0.4))',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-muted)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--primary-soft, rgba(37,99,235,0.15))',
                color: 'var(--primary, #2563eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Plus size={18} weight="bold" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>
                Add Asset Manually
              </h3>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--foreground-muted)' }}>
                Page {pidPage} • BBox [{Math.round(bbox.x)}, {Math.round(bbox.y)}, {Math.round(bbox.width)}x{Math.round(bbox.height)}]
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--foreground-muted)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: 20, overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--danger-soft, rgba(239,68,68,0.15))',
                border: '1px solid var(--danger, #ef4444)',
                color: 'var(--danger, #ef4444)',
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Asset Tag & Type Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>
                  Asset Tag <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. P-101A"
                  value={assetTag}
                  onChange={(e) => setAssetTag(e.target.value)}
                  style={{ ...inputStyle, textTransform: 'uppercase', fontWeight: 600 }}
                  autoFocus
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Asset Type <span style={{ color: 'var(--danger, #ef4444)' }}>*</span>
                </label>
                <input
                  type="text"
                  list="common-asset-types-list"
                  required
                  placeholder="e.g. Pump"
                  value={assetType}
                  onChange={(e) => setAssetType(e.target.value)}
                  style={inputStyle}
                />
                <datalist id="common-asset-types-list">
                  {COMMON_ASSET_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={labelStyle}>Description</label>
              <input
                type="text"
                placeholder="e.g. Crude Oil Booster Pump"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Service & Size */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Service</label>
                <input
                  type="text"
                  placeholder="e.g. Hydrocarbon"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Size / Rating</label>
                <input
                  type="text"
                  placeholder="e.g. 4 inch / 150#"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Notice info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border)',
                fontSize: 11,
                color: 'var(--foreground-muted)',
                lineHeight: 1.4,
              }}
            >
              <Info size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--primary, #2563eb)' }} />
              <span>
                Asset yang ditambahkan manual otomatis disetujui (Approved) dengan confidence 100% dan akan langsung diikutsertakan saat memproses <strong>MDO Flow</strong>.
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-button, 10px)',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--foreground)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-button, 10px)',
                border: 'none',
                background: 'var(--primary, #2563eb)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
              }}
            >
              <FloppyDisk size={14} weight="bold" />
              {loading ? 'Saving Asset...' : 'Save Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
