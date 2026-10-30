'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BookOpenCheck,
  FolderKanban,
  BookOpen,
  FileText,
  ScanSearch,
  CheckCircle2,
  GitFork,
  HelpCircle,
  ArrowRight,
  ChevronUp,
  Share2,
  Copy,
  Eye,
  Lock,
  Layers,
  Sparkles,
  AlertCircle,
  Check,
  ExternalLink,
} from 'lucide-react';

const SECTIONS = [
  { id: 'overview', title: '1. Ikhtisar & Prinsip Dasar', icon: BookOpenCheck },
  { id: 'project-management', title: '2. Manajemen Project & Kolaborasi', icon: FolderKanban },
  { id: 'legend-library', title: '3. Standar Legend Library', icon: BookOpen },
  { id: 'document-management', title: '4. Manajemen Dokumen (PDF/DXF)', icon: FileText },
  { id: 'ai-detection', title: '5. Menjalankan Deteksi AI', icon: ScanSearch },
  { id: 'interactive-review', title: '6. Workspace Review Kanvas P&ID', icon: CheckCircle2 },
  { id: 'mdo-flow', title: '7. MDO Flow & Export MDO', icon: GitFork },
  { id: 'troubleshooting', title: '8. Tips & Troubleshooting', icon: HelpCircle },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #FFFFFF)',
  border: '1px solid var(--border, #E2E8F0)',
  borderRadius: 'var(--radius-card, 16px)',
  boxShadow: 'var(--shadow-card, 0 2px 8px rgba(0,0,0,0.04))',
  padding: '28px',
  marginBottom: '28px',
};

const badgeStyle = (color: string, bg: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '11px',
  fontWeight: '600',
  color,
  background: bg,
  padding: '3px 8px',
  borderRadius: '6px',
});

const calloutStyle = (border: string, bg: string): React.CSSProperties => ({
  borderLeft: `4px solid ${border}`,
  background: bg,
  borderRadius: '0 8px 8px 0',
  padding: '14px 18px',
  marginTop: '16px',
  marginBottom: '16px',
  fontSize: '13px',
  lineHeight: 1.6,
});

export default function UserGuidePage() {
  const [activeSection, setActiveSection] = useState('overview');
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 140;
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const copySampleCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', paddingBottom: '80px' }}>
      {/* Header Banner */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'var(--primary-soft, rgba(74, 102, 222, 0.1))',
              color: 'var(--primary, #3451D1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BookOpenCheck size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
              Pedoman Penggunaan Sistem (User Guide)
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
              Panduan lengkap langkah demi langkah pengoperasian sistem Automatic Asset Detection dan MDO Flow.
            </p>
          </div>
        </div>
      </div>

      {/* Main Two-Column Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: '32px',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Documentation Content */}
        <div style={{ minWidth: 0 }}>
          {/* ============================================================== */}
          {/* BAB 1: IKHTISAR & PRINSIP DASAR                                */}
          {/* ============================================================== */}
          <section id="overview" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 1</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Ikhtisar &amp; Prinsip Dasar Sistem
              </h2>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--foreground)', marginBottom: '16px' }}>
              Aplikasi <strong>Automatic Asset Detection</strong> adalah sistem rekayasa industri yang mengotomatisasi
              ekstraksi peralatan fisik (seperti <em>Pump, Vessel, Heat Exchanger, Valve,</em> dan instrumen) dari gambar
              teknik P&amp;ID (Piping and Instrumentation Diagram) maupun PFD, baik yang berformat berkas <strong>PDF</strong>{' '}
              maupun <strong>AutoCAD DXF</strong>.
            </p>

            {/* Visual Workflow Steps */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
                padding: '16px',
                background: 'var(--surface-2, #F8FAFC)',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                marginBottom: '20px',
              }}
            >
              {[
                { no: '1', title: 'Projects', desc: 'Private / Public' },
                { no: '2', title: 'Legends', desc: 'Standar Simbol' },
                { no: '3', title: 'Documents', desc: 'Upload PDF / DXF' },
                { no: '4', title: 'Detection', desc: 'AI Vision Engine' },
                { no: '5', title: 'Review', desc: 'Kanvas & Tabel' },
                { no: '6', title: 'MDO Flow', desc: 'Export MDO Final' },
              ].map((step, idx) => (
                <div key={step.no} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'var(--primary)',
                          color: '#FFFFFF',
                          fontSize: '11px',
                          fontWeight: '700',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {step.no}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--foreground)' }}>
                        {step.title}
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--foreground-muted)', display: 'block', marginLeft: '26px' }}>
                      {step.desc}
                    </span>
                  </div>
                  {idx < 5 && (
                    <ArrowRight size={14} style={{ color: 'var(--foreground-muted)', flexShrink: 0 }} />
                  )}
                </div>
              ))}
            </div>

            <div style={calloutStyle('var(--primary)', 'var(--primary-soft, rgba(74, 102, 222, 0.08))')}>
              <strong>Prinsip Human-in-the-Loop:</strong> AI bertindak sebagai asisten pembacaan cepat dengan menyajikan
              bukti spasial (koordinat bounding box dan potongan simbol). Hasil deteksi <em>tidak langsung</em> menjadi data
              final, melainkan diverifikasi terlebih dahulu oleh reviewer manusia untuk memastikan akurasi data 100%.
            </div>
          </section>

          {/* ============================================================== */}
          {/* BAB 2: MANAJEMEN PROJECT & KOLABORASI                          */}
          {/* ============================================================== */}
          <section id="project-management" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 2</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Manajemen Project &amp; Kolaborasi Tim
              </h2>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--foreground)', marginBottom: '16px' }}>
              Modul <strong>Projects</strong> digunakan untuk mengelompokkan dokumen P&amp;ID, standar legend, deteksi,
              serta relasi MDO ke dalam satu unit kerja fasilitas atau area kilang.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Lock size={16} style={{ color: 'var(--warning, #EAB308)' }} />
                  <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>Private Project</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.5, margin: 0 }}>
                  Hanya Anda sebagai pemilik (dan admin) yang dapat melihat, mengunggah dokumen, dan menjalankan deteksi.
                  Sangat cocok untuk pekerjaan analisis yang masih dalam tahap draf.
                </p>
              </div>

              <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Eye size={16} style={{ color: 'var(--success, #2FB584)' }} />
                  <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>Public Project</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.5, margin: 0 }}>
                  Terbuka untuk seluruh pengguna di dalam sistem pada tab <em>Public Projects</em>. Pengguna lain dapat
                  melihat dokumen dan menyalinnya menjadi project privat mereka sendiri.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginBottom: '8px' }}>
              1. Berbagi Project Private Menggunakan Sharing Code
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', lineHeight: 1.6, marginBottom: '12px' }}>
              Anda dapat berkolaborasi pada project berstatus <em>Private</em> tanpa harus mengubahnya menjadi publik:
            </p>
            <ul style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.8, paddingLeft: '20px', marginBottom: '16px' }}>
              <li>
                Setiap project memiliki <strong>Share Code</strong> unik (misal: <code>PRJ-9X2K8L</code>).
              </li>
              <li>
                Pemilik project dapat menyalin kode ini dari kartu project atau panel detail dan membagikannya ke rekan kerja.
              </li>
              <li>
                Rekan kerja cukup menekan tombol <strong>Join via Code</strong> di halaman Projects dan memasukkan kode tersebut.
                Sistem akan secara instan meng-clone project ke dalam workspace rekan kerja Anda.
              </li>
            </ul>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginBottom: '8px' }}>
              2. Meng-clone Project Public Menjadi Private Copy
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', lineHeight: 1.6, marginBottom: '12px' }}>
              Jika Anda menemukan project di tab <em>Public Projects</em> dan ingin melakukan anotasi atau pengujian sendiri:
            </p>
            <ul style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.8, paddingLeft: '20px', margin: 0 }}>
              <li>
                Klik tombol <strong>Clone to Private</strong> pada project publik yang diinginkan.
              </li>
              <li>
                Sistem akan menyalin seluruh dokumen, legend, deteksi, dan data MDO menjadi salinan <em>Private Copy</em> baru
                milik Anda. Modifikasi yang Anda lakukan tidak akan mengubah data pada project publik aslinya.
              </li>
            </ul>
          </section>

          {/* ============================================================== */}
          {/* BAB 3: STANDAR LEGEND LIBRARY                                  */}
          {/* ============================================================== */}
          <section id="legend-library" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 3</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Menyiapkan Standar Legend Library
              </h2>
            </div>

            <div style={calloutStyle('var(--warning, #EAB308)', 'rgba(234, 179, 8, 0.08)')}>
              <strong>Mengapa Legend Adalah Fondasi Utama?</strong> Setiap pabrik memiliki gambar simbol berbeda (misal:
              bentuk arsiran Pompa Sentrifugal atau simbol Valve). AI menggunakan Legend yang Anda pilih sebagai
              kamus acuan utama untuk mengartikan bentuk grafis dan pola nomor tag.
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginTop: '20px', marginBottom: '8px' }}>
              Tahapan Penyiapan Legend:
            </h3>
            <ol style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.8, paddingLeft: '20px', marginBottom: '16px' }}>
              <li>
                <strong>Buat Legend Baru:</strong> Buka menu <em>Legends</em> ➔ klik <em>+ New Legend</em> ➔ masukkan nama standar fasilitas.
              </li>
              <li>
                <strong>AI Scan Legend:</strong> Unggah lembar PDF standar simbol ➔ klik <em>AI Scan Legend</em>. AI akan otomatis
                memotong setiap simbol, mengenali nama alat, dan menyusun daftarnya.
              </li>
              <li>
                <strong>Konfigurasi Pola Tag (Tag Pattern):</strong> Tentukan format penomoran tag per tipe alat.
                Contoh:
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                  <span style={badgeStyle('var(--primary)', 'var(--surface-2)')}>Pump: P-###</span>
                  <span style={badgeStyle('var(--primary)', 'var(--surface-2)')}>Vessel: V-### / T-###</span>
                  <span style={badgeStyle('var(--primary)', 'var(--surface-2)')}>Heat Exchanger: E-###</span>
                  <span style={badgeStyle('var(--primary)', 'var(--surface-2)')}>Valve: XV-### / FV-###</span>
                </div>
              </li>
              <li>
                <strong>Validasi Potongan Simbol (Validated Crops):</strong> Periksa hasil potongan simbol di halaman review legend,
                kemudian klik <em>Validate</em>. Simbol yang tervalidasi akan dikirim sebagai referensi gambar visual kepada AI
                saat deteksi P&amp;ID berjalan.
              </li>
            </ol>
          </section>

          {/* ============================================================== */}
          {/* BAB 4: MANAJEMEN DOKUMEN (PDF & AUTOCAD DXF)                   */}
          {/* ============================================================== */}
          <section id="document-management" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 4</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Manajemen Dokumen (PDF &amp; AutoCAD DXF)
              </h2>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--foreground)', marginBottom: '16px' }}>
              Sistem mendukung dua format berkas gambar teknik utama dengan alur pemrosesan yang dioptimalkan:
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', color: 'var(--foreground)' }}>Format Berkas</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', color: 'var(--foreground)' }}>Karakteristik</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', color: 'var(--foreground)' }}>Metode Deteksi AI</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: '600', color: 'var(--foreground)' }}>PDF (Scan / Vector)</td>
                    <td style={{ padding: '12px 14px', color: 'var(--foreground-muted)' }}>Berkas gambar lembar P&amp;ID multi-halaman hasil scan atau plot PDF.</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>Tiled AI Vision</span>
                      <p style={{ fontSize: '11px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
                        Diproses per potongan region beresolusi tinggi agar tag 6pt tetap tajam.
                      </p>
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: '600', color: 'var(--foreground)' }}>AutoCAD DXF</td>
                    <td style={{ padding: '12px 14px', color: 'var(--foreground-muted)' }}>Berkas CAD digital murni berisi entitas garis, poligon, layer pipa, dan teks teks murni.</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={badgeStyle('var(--success)', 'var(--success-soft)')}>Vector Geometry Engine</span>
                      <p style={{ fontSize: '11px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
                        Ekstraksi koordinat instan dari geometri CAD + AI vision verifikasi.
                      </p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={calloutStyle('var(--info, #3B82F6)', 'rgba(59, 130, 246, 0.08)')}>
              <strong>Tips Kualitas Dokumen:</strong> Untuk file PDF scan, gunakan resolusi minimal 200–300 DPI. Dokumen yang
              buram atau teks tag yang pecah dapat menyebabkan AI melewatkan nomor tag dan menurunkan skor confidence.
            </div>
          </section>

          {/* ============================================================== */}
          {/* BAB 5: MENJALANKAN DETEKSI AI                                  */}
          {/* ============================================================== */}
          <section id="ai-detection" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 5</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Menjalankan Deteksi AI (Run Detection)
              </h2>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--foreground)', marginBottom: '16px' }}>
              Setelah dokumen dan legend disiapkan, Anda dapat mengeksekusi deteksi otomatis:
            </p>

            <ol style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.8, paddingLeft: '20px', marginBottom: '20px' }}>
              <li>Buka menu <strong>Detection</strong> atau halaman Dokumen ➔ klik tombol <strong>Run Detection</strong>.</li>
              <li>Pilih Dokumen P&amp;ID target serta Legend standar acuan yang sesuai.</li>
              <li>Klik konfirmasi <strong>Start Detection</strong>.</li>
            </ol>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginBottom: '10px' }}>
              Status Pemrosesan Latar Belakang (BullMQ Worker):
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
              {[
                { label: 'PENDING', desc: 'Menunggu antrean worker', color: 'var(--foreground-muted)', bg: 'var(--surface-2)' },
                { label: 'PROCESSING', desc: 'Sedang menganalisis halaman', color: 'var(--primary)', bg: 'var(--primary-soft)' },
                { label: 'COMPLETED', desc: 'Selesai & siap direview', color: 'var(--success)', bg: 'var(--success-soft)' },
                { label: 'FAILED', desc: 'Gagal / kuota limit', color: 'var(--danger)', bg: 'var(--danger-soft)' },
              ].map(st => (
                <div key={st.label} style={{ padding: '12px', borderRadius: '8px', background: st.bg, border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: st.color, display: 'block', marginBottom: '4px' }}>
                    {st.label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{st.desc}</span>
                </div>
              ))}
            </div>

            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0 }}>
              Deteksi berjalan secara asinkron di server. Anda dapat meninggalkan halaman atau membuka modul lain tanpa
              khawatir proses terhenti.
            </p>
          </section>

          {/* ============================================================== */}
          {/* BAB 6: WORKSPACE REVIEW INTERAKTIF                            */}
          {/* ============================================================== */}
          <section id="interactive-review" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 6</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Workspace Review Kanvas P&amp;ID &amp; Tabel
              </h2>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--foreground)', marginBottom: '16px' }}>
              Di halaman review deteksi, Anda akan melihat kanvas gambar interaktif di sisi kiri dan daftar tabel deteksi
              aset di sisi kanan dengan sinkronisasi dua arah.
            </p>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginBottom: '10px' }}>
              Arti Indikator Status Validasi:
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <span style={badgeStyle('var(--success)', 'var(--success-soft)')}>🟢 VALID</span>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '8px', lineHeight: 1.5, margin: '8px 0 0' }}>
                  Confidence tinggi, nomor tag terbaca tajam dan cocok persis dengan aturan pola legend.
                </p>
              </div>
              <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <span style={badgeStyle('var(--warning)', 'var(--warning-soft)')}>🟡 NEEDS REVIEW</span>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '8px', lineHeight: 1.5, margin: '8px 0 0' }}>
                  Perlu verifikasi mata manusia (misal nomor tag tidak terdeteksi atau simbol mirip beberapa jenis alat).
                </p>
              </div>
              <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <span style={badgeStyle('var(--danger)', 'var(--danger-soft)')}>🔴 CONFLICT</span>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '8px', lineHeight: 1.5, margin: '8px 0 0' }}>
                  Terjadi tumpang tindih kotak deteksi pada lokasi yang sama atau terdapat tag kembar.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginBottom: '10px' }}>
              4 Tindakan Utama Reviewer:
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--success)' }}>1. Confirm (Setuju)</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
                  Menyetujui aset hasil deteksi AI untuk dipromosikan ke tahap MDO Flow.
                </p>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>2. Edit (Koreksi)</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
                  Mengoreksi nomor tag yang salah ketik (misal <code>P-010</code> ➔ <code>P-0101A</code>) atau jenis tipe alat.
                </p>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--danger)' }}>3. Reject (Tolak)</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
                  Menolak deteksi salah (garis pipa, lingkaran teks, atau catatan yang keliru dibaca sebagai alat).
                </p>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>4. Add Manual (Tambah)</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
                  Menggambar kotak pembatas baru langsung di kanvas jika ada peralatan fisik yang terlewat oleh AI.
                </p>
              </div>
            </div>
          </section>

          {/* ============================================================== */}
          {/* BAB 7: MDO FLOW & EXPORT MDO                                   */}
          {/* ============================================================== */}
          <section id="mdo-flow" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 7</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                MDO Flow &amp; Export MDO (Master Data Object)
              </h2>
            </div>

            <div style={calloutStyle('var(--primary)', 'var(--primary-soft, rgba(74, 102, 222, 0.08))')}>
              <strong>Modul Penahapan Akhir:</strong> Modul ekspor utama dalam aplikasi ini adalah <strong>MDO Flow</strong>,
              yang memperkaya data deteksi mentah menjadi data Master Data Object standar rekayasa lengkap dengan relasi
              aliran proses pipa.
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--foreground)', marginTop: '20px', marginBottom: '8px' }}>
              Alur Kerja MDO Flow:
            </h3>
            <ol style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.8, paddingLeft: '20px', marginBottom: '16px' }}>
              <li>
                <strong>Buka Menu MDO Flow:</strong> Klik menu <em>MDO Flow</em> di sidebar, lalu pilih Dokumen P&amp;ID yang sudah direview.
              </li>
              <li>
                <strong>Pengayaan Data Otomatis (MDO Enrichment):</strong> Sistem secara otomatis menghasilkan atribut standar:
                <ul style={{ paddingLeft: '18px', margin: '6px 0' }}>
                  <li><code>Equipment Type</code> &amp; <code>Component Name</code></li>
                  <li><code>Tag No Proposed</code> (rekomendasi tag standar)</li>
                  <li><code>Size &amp; Dimension</code> (ukuran pipa / nozzle yang tersambung)</li>
                  <li><code>Relasi Aliran: From, To, Of, At</code> (arah aliran proses ke/dari peralatan lain)</li>
                  <li><code>Description Proposed</code> (deskripsi teknis siap impor sistem ERP/SAP)</li>
                </ul>
              </li>
              <li>
                <strong>Persetujuan Data MDO:</strong> Klik <em>Approve</em> pada baris yang valid atau gunakan tombol <strong>Approve All</strong>.
              </li>
              <li>
                <strong>Export MDO:</strong> Klik tombol <strong>Export MDO</strong> untuk mengunduh berkas spreadsheet <code>.xlsx</code> resmi.
                Data yang berstatus <em>Rejected</em> secara otomatis tidak disertakan ke dalam berkas ekspor.
              </li>
            </ol>
          </section>

          {/* ============================================================== */}
          {/* BAB 8: TIPS & TROUBLESHOOTING                                  */}
          {/* ============================================================== */}
          <section id="troubleshooting" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={badgeStyle('var(--primary)', 'var(--primary-soft)')}>BAB 8</span>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--foreground)', margin: 0 }}>
                Tips Praktis &amp; Pemecahan Masalah (Troubleshooting)
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>❓ Mengapa nomor tag kecil terlewat oleh AI?</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.6, margin: '6px 0 0' }}>
                  Sistem secara otomatis mengaktifkan mode <em>Tiled Region</em> untuk membagi dokumen menjadi potongan
                  resolusi tinggi. Jika tag tetap terlewat karena dokumen scan buram, Anda dapat menekan tombol <strong>Edit</strong>{' '}
                  pada aset atau menggunakan <strong>Add Manual</strong> untuk menambahkan tag yang benar.
                </p>
              </div>

              <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>❓ Bagaimana cara mengatasi deteksi ganda (duplikat)?</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.6, margin: '6px 0 0' }}>
                  Simbol yang berada di perbatasan garis potongan region terkadang terdeteksi dua kali. Buka tabel deteksi
                  dan gunakan tombol <strong>Deduplicate</strong> untuk menyatukan deteksi tumpang tindih secara otomatis.
                </p>
              </div>

              <div style={{ padding: '16px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>❓ Di mana saya dapat mengganti Model AI Visi?</strong>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.6, margin: '6px 0 0' }}>
                  Anda dapat berpindah antara <strong>Google Gemini</strong>, <strong>OpenAI ChatGPT (GPT-4o)</strong>, atau{' '}
                  <strong>Anthropic Claude</strong> kapan saja melalui halaman <strong>Settings</strong>.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Sticky Table of Contents */}
        <aside
          style={{
            position: 'sticky',
            top: '24px',
            background: 'var(--surface, #FFFFFF)',
            border: '1px solid var(--border, #E2E8F0)',
            borderRadius: 'var(--radius-card, 16px)',
            boxShadow: 'var(--shadow-card)',
            padding: '20px',
            maxHeight: 'calc(100vh - 48px)',
            overflowY: 'auto',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
            <BookOpenCheck size={16} style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--foreground)' }}>Daftar Bab Pedoman</span>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => scrollTo(sec.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isActive ? 'var(--primary-soft, rgba(74, 102, 222, 0.1))' : 'transparent',
                    color: isActive ? 'var(--primary, #3451D1)' : 'var(--foreground-muted)',
                    fontWeight: isActive ? '600' : '400',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 150ms ease-out',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--foreground)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--foreground-muted)';
                  }}
                >
                  <Icon size={14} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sec.title}
                  </span>
                </button>
              );
            })}
          </nav>

          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              marginTop: '18px',
              padding: '8px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--foreground)',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            <ChevronUp size={14} />
            <span>Kembali ke Atas</span>
          </button>
        </aside>
      </div>
    </div>
  );
}

