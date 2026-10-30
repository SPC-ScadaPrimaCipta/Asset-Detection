'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UploadSimple, FilePdf, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui';

interface UploadLegendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UploadLegendModal({ isOpen, onClose }: UploadLegendModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ pct: number; message: string } | null>(null);
  const [error, setError] = useState('');

  const resetForm = () => {
    setName('');
    setFile(null);
    setPageCount(null);
    setIsDragging(false);
    setUploading(false);
    setUploadProgress(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleModalClose = () => {
    if (uploading) return;
    resetForm();
    onClose();
  };

  const inspectPdfFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setError('');
    setPageCount(null);

    if (!selectedFile.name.toLowerCase().endsWith('.pdf') && selectedFile.type !== 'application/pdf') {
      setError('File harus berformat dokumen PDF (.pdf).');
      return;
    }

    try {
      const pdfjsLib = await import('pdfjs-dist');
      if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      }
      const arrayBuffer = await selectedFile.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPageCount(doc.numPages);
      if (doc.numPages !== 1) {
        setError(`File Legend harus tepat 1 halaman. File yang dipilih memiliki ${doc.numPages} halaman.`);
      }
    } catch (err: unknown) {
      console.warn('[UploadLegendModal] PDF inspection warning:', err);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      await inspectPdfFile(droppedFile);
      if (!name.trim()) {
        const cleanName = droppedFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setName(cleanName);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim() || uploading) return;
    if (pageCount !== null && pageCount !== 1) {
      setError(`File Legend harus tepat 1 halaman. File yang dipilih memiliki ${pageCount} halaman.`);
      return;
    }

    setUploading(true);
    setError('');
    setUploadProgress({ pct: 5, message: 'Mengunggah file PDF Legend...' });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name.trim());

      const res = await fetch('/api/legends/upload?stream=true', {
        method: 'POST',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        let errMsg = text.slice(0, 200);
        try {
          const j = JSON.parse(text);
          errMsg = j.error || j.detail || errMsg;
        } catch {}
        throw new Error(errMsg || `Upload failed (${res.status})`);
      }

      let createdId: string | null = null;
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.stage === 'error') {
                throw new Error(data.error || data.message || 'Ekstraksi simbol gagal');
              }
              if (typeof data.pct === 'number') {
                setUploadProgress({ pct: data.pct, message: data.message || 'Memproses...' });
              }
              if (data.stage === 'done' && data.result?.id) {
                createdId = data.result.id;
              }
            } catch (jsonErr: unknown) {
              const errObj = jsonErr as { message?: string };
              if (errObj.message && errObj.message !== 'Unexpected end of JSON input') {
                throw jsonErr;
              }
            }
          }
        }
      }

      if (createdId) {
        handleModalClose();
        router.push(`/legends/${createdId}/review`);
      } else {
        handleModalClose();
        router.push('/legends');
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj.message || 'Terjadi kesalahan saat memproses legend');
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const isFormValid = Boolean(name.trim() && file && (pageCount === null || pageCount === 1));

  return (
    <Modal isOpen={isOpen} onClose={handleModalClose} title="Upload Legend Standar" maxWidth="560px">
      <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Unggah dokumen P&amp;ID Legend (PDF tepat 1 halaman). AI akan mengekstraksi simbol komponen, tipe aset, deskripsi, dan singkatan secara otomatis.
        </p>

        {/* Input Nama Legend */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
            Nama Standar Legend <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <input
            type="text"
            required
            disabled={uploading}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Pertamina Hulu Energi P&ID Standard Rev 2"
            style={{
              width: '100%',
              fontSize: 14,
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm, 8px)',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
          />
        </div>

        {/* Dropzone PDF */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>
            Berkas PDF Legend (1 Halaman) <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => {
              if (!uploading) fileInputRef.current?.click();
            }}
            style={{
              border: `2px dashed ${isDragging ? 'var(--primary)' : 'var(--border)'}`,
              background: isDragging ? 'var(--primary-subtle, rgba(0, 102, 204, 0.05))' : 'var(--background)',
              borderRadius: 'var(--radius-md, 12px)',
              padding: '24px 16px',
              textAlign: 'center',
              cursor: uploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) {
                  inspectPdfFile(selected);
                  if (!name.trim()) {
                    setName(selected.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '));
                  }
                }
              }}
            />

            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FilePdf size={32} weight="duotone" style={{ color: 'var(--primary)' }} />
                <div style={{ textAlign: 'left' }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                    {file.name}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--foreground-muted)' }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB {pageCount !== null && `• ${pageCount} halaman`}
                  </p>
                </div>
                {pageCount === 1 && (
                  <CheckCircle size={20} weight="fill" style={{ color: 'var(--success, #10b981)', marginLeft: 8 }} />
                )}
              </div>
            ) : (
              <>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'var(--surface-hover, rgba(0,0,0,0.04))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--primary)',
                  }}
                >
                  <UploadSimple size={24} />
                </div>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>
                    Pilih Berkas PDF
                  </span>{' '}
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>atau seret ke sini</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Hanya berkas .pdf satu halaman (maks 25 MB)
                </span>
              </>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm, 8px)',
              background: 'var(--danger-soft, #fef2f2)',
              border: '1px solid var(--danger, #ef4444)',
              color: 'var(--danger, #b91c1c)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <WarningCircle size={18} weight="fill" style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Progress Tracker saat upload & scanning */}
        {uploading && uploadProgress && (
          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-sm, 8px)',
              background: 'var(--background)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }}>
                {uploadProgress.message}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                {uploadProgress.pct}%
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: 6,
                background: 'var(--surface-hover, #e2e8f0)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${uploadProgress.pct}%`,
                  height: '100%',
                  background: 'var(--primary)',
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Mohon tunggu, AI sedang membaca dan mengidentifikasi simbol legend...
            </span>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <Button
            type="button"
            variant="secondary"
            disabled={uploading}
            onClick={handleModalClose}
            style={{ fontSize: 13 }}
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={!isFormValid || uploading}
            style={{
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              opacity: !isFormValid || uploading ? 0.6 : 1,
            }}
          >
            {uploading ? (
              <>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span>Memproses Legend...</span>
              </>
            ) : (
              <>
                <UploadSimple size={16} weight="bold" />
                <span>Upload &amp; Ekstraksi Simbol</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
