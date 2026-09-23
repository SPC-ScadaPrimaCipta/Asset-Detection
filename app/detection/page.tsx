"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
}
interface Document {
  id: string;
  filename: string;
  page_count: number;
  status: string;
}
interface Legend {
  id: string;
  name: string;
}
interface DetectionJob {
  id: string;
  status: string;
  progress_pct: number;
  document_id: string;
  legend_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_detail?: string | null;
}
interface Detection {
  id: string;
  asset_tag: string | null;
  asset_type: string;
  description: string | null;
  equipment_class: string | null;
  pid_page: number | null;
  confidence: number | null;
  detection_status: string;
  review_status: string;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  evidence: string[] | string | null;
  service: string | null;
  location: string | null;
  unit: string | null;
  area: string | null;
  legend_id: string | null;
  legend_symbol_id: string | null;
  detection_source: string | null;
  validation_status: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: "600",
  color: "var(--foreground-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const selectStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  fontSize: "14px",
  fontFamily: "inherit",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "13px",
  fontWeight: "500",
  cursor: "pointer",
  transition: "all 150ms ease-out",
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "var(--primary)",
  color: "var(--surface)",
  border: "1px solid var(--primary)",
};

const badgeBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "9999px",
  fontSize: "12px",
  fontWeight: "500",
  lineHeight: "1.5",
};

const toolButtonStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: "12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--foreground-muted)",
  cursor: "pointer",
  transition: "all 150ms ease-out",
};

const legendItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "12px",
  color: "var(--foreground-muted)",
};

// M3: Normalize asset type casing — Title Case, trim whitespace, collapse internal spaces
function normalizeType(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function confBadge(c: number | null) {
  if (c === null)
    return (
      <span style={{ fontSize: "12px", color: "var(--foreground-subtle)" }}>
        —
      </span>
    );
  const pct = Math.round(c * 100);
  const style: React.CSSProperties =
    c >= 0.9
      ? { background: "var(--success-soft)", color: "var(--success)" }
      : c >= 0.7
        ? { background: "var(--warning-soft)", color: "var(--warning)" }
        : { background: "var(--danger-soft)", color: "var(--danger)" };
  // M2: warn low confidence
  const warn = c < 0.7 ? " ⚠" : "";
  return (
    <span style={{ ...badgeBase, ...style }}>
      {pct}%{warn}
    </span>
  );
}

// M5: Source indicator badge — LEGEND-confirmed vs VISION-only
function sourceBadge(source: string | null) {
  if (!source) return null;
  const isLegend =
    source === "LEGEND" ||
    source === "CACHE" ||
    source === "COMPANY_KB" ||
    source === "ISA" ||
    source === "ISO";
  const style: React.CSSProperties = isLegend
    ? {
        background: "rgba(0,120,80,0.10)",
        color: "var(--success)",
        border: "1px solid rgba(0,120,80,0.20)",
      }
    : {
        background: "rgba(180,120,0,0.10)",
        color: "var(--warning)",
        border: "1px solid rgba(180,120,0,0.20)",
      };
  const label = isLegend ? "✓ Legend" : "~ Vision";
  return (
    <span style={{ ...badgeBase, fontSize: "10px", ...style }}>{label}</span>
  );
}

function statusBadge(ds: string, rs: string) {
  const label =
    ds === "MANUAL"
      ? "Manual"
      : rs === "APPROVED"
        ? "Confirmed"
        : rs === "REJECTED"
          ? "Rejected"
          : ds === "DETECTED"
            ? "Detected"
            : ds;
  const style: React.CSSProperties =
    rs === "APPROVED"
      ? { background: "var(--success-soft)", color: "var(--success)" }
      : rs === "REJECTED"
        ? { background: "var(--danger-soft)", color: "var(--danger)" }
        : {
            background: "var(--surface-muted)",
            color: "var(--foreground-muted)",
          };
  return <span style={{ ...badgeBase, ...style }}>{label}</span>;
}

function parseEvidence(ev: string[] | string | null): string[] {
  if (!ev) return [];
  if (Array.isArray(ev)) return ev;
  try {
    const p = JSON.parse(ev);
    return Array.isArray(p) ? p : [String(p)];
  } catch {
    return [String(ev)];
  }
}

// ─── ManualAddModal ───────────────────────────────────────────────────────────

function ManualAddModal({
  open,
  onClose,
  onSave,
  documentId,
  legendId,
  jobId,
  initialBbox,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  documentId: string;
  legendId: string;
  jobId: string | null;
  initialBbox?: { x: number; y: number; w: number; h: number } | null;
}) {
  const [assetType, setAssetType] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [description, setDescription] = useState("");
  const [pidPage, setPidPage] = useState("");
  // BBox — 0-1000 normalized coordinate space (same as AI detections)
  const [bboxX, setBboxX] = useState("0");
  const [bboxY, setBboxY] = useState("0");
  const [bboxW, setBboxW] = useState("100");
  const [bboxH, setBboxH] = useState("100");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset form when modal opens — prefill bbox dari hasil draw di viewer
  useEffect(() => {
    if (open) {
      setAssetType("");
      setAssetTag("");
      setDescription("");
      setPidPage("");
      setBboxX(String(initialBbox?.x ?? 0));
      setBboxY(String(initialBbox?.y ?? 0));
      setBboxW(String(initialBbox?.w ?? 100));
      setBboxH(String(initialBbox?.h ?? 100));
      setError("");
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetType.trim()) {
      setError("Asset Type is required.");
      return;
    }
    const bx = Math.max(0, Math.min(1000, parseInt(bboxX, 10) || 0));
    const by = Math.max(0, Math.min(1000, parseInt(bboxY, 10) || 0));
    const bw = Math.max(1, Math.min(1000 - bx, parseInt(bboxW, 10) || 100));
    const bh = Math.max(1, Math.min(1000 - by, parseInt(bboxH, 10) || 100));

    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/detections/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_type: assetType.trim(),
          asset_tag: assetTag.trim() || null,
          description: description.trim() || null,
          pid_page: pidPage ? parseInt(pidPage, 10) : null,
          document_id: documentId,
          legend_id: legendId || null,
          job_id: jobId,
          bbox_x: bx,
          bbox_y: by,
          bbox_w: bw,
          bbox_h: bh,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Error ${res.status}`);
        setSubmitting(false);
        return;
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflowY: "auto",
        paddingTop: "80px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...cardStyle,
          padding: "24px",
          maxWidth: "420px",
          width: "100%",
          margin: "0 auto",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <h2
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: "var(--foreground)",
              margin: 0,
            }}
          >
            Add Asset Manually
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "20px",
              color: "var(--foreground-muted)",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {/* Asset Type (required) */}
          <label style={{ display: "block" }}>
            <span style={{ ...fieldLabelStyle, marginBottom: "4px" }}>
              Asset Type <span style={{ color: "var(--danger)" }}>*</span>
            </span>
            <input
              type="text"
              required
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
              placeholder="e.g. PUMP, VALVE, COMPRESSOR"
              style={selectStyle}
            />
          </label>

          {/* Asset Tag */}
          <label style={{ display: "block" }}>
            <span style={fieldLabelStyle}>Asset Tag</span>
            <input
              type="text"
              value={assetTag}
              onChange={(e) => setAssetTag(e.target.value)}
              placeholder="e.g. P-101A"
              style={selectStyle}
            />
          </label>

          {/* Description */}
          <label style={{ display: "block" }}>
            <span style={fieldLabelStyle}>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              style={{ ...selectStyle, resize: "none" }}
            />
          </label>

          {/* P&ID Page */}
          <label style={{ display: "block" }}>
            <span style={fieldLabelStyle}>P&amp;ID Page</span>
            <input
              type="number"
              min={1}
              value={pidPage}
              onChange={(e) => setPidPage(e.target.value)}
              placeholder="Page number"
              style={selectStyle}
            />
          </label>

          {/* Bounding Box */}
          <div>
            <span
              style={{
                ...fieldLabelStyle,
                display: "block",
                marginBottom: "4px",
              }}
            >
              Bounding Box
              <span
                style={{
                  color: "var(--foreground-subtle)",
                  textTransform: "none",
                  fontWeight: "normal",
                  marginLeft: "4px",
                }}
              >
                — 0–1000 normalized coordinate space
              </span>
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "12px",
              }}
            >
              {[
                { val: bboxX, set: setBboxX, label: "X", hint: "(left edge)" },
                { val: bboxY, set: setBboxY, label: "Y", hint: "(top edge)" },
                { val: bboxW, set: setBboxW, label: "Width", hint: "" },
                { val: bboxH, set: setBboxH, label: "Height", hint: "" },
              ].map(({ val, set, label, hint }) => (
                <label key={label} style={{ display: "block" }}>
                  <span style={{ ...fieldLabelStyle }}>{label}</span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--foreground-subtle)",
                      marginLeft: "4px",
                    }}
                  >
                    {hint}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    style={{ ...selectStyle, marginTop: "4px" }}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p
              style={{
                fontSize: "12px",
                color: "var(--danger)",
                background: "var(--danger-soft)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 12px",
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", paddingTop: "4px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--foreground)",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
                transition: "all 150ms ease-out",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 1,
                ...primaryButtonStyle,
                opacity: submitting ? 0.5 : 1,
              }}
            >
              {submitting ? "Saving…" : "Save Asset"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── JobProgress ─────────────────────────────────────────────────────────────

function JobProgress({
  jobId,
  onComplete,
}: {
  jobId: string;
  onComplete: () => void;
}) {
  const [job, setJob] = useState<DetectionJob | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    doneRef.current = false;
    const poll = async () => {
      const r = await fetch(`/api/detection/jobs/${jobId}`);
      if (!r.ok) return;
      const j: DetectionJob = await r.json();
      setJob(j);
      if (
        (j.status === "COMPLETED" ||
          j.status === "FAILED" ||
          j.status === "CANCELLED") &&
        !doneRef.current
      ) {
        doneRef.current = true;
        onComplete();
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [jobId, onComplete]);

  if (!job) return null;

  const statusColor =
    job.status === "COMPLETED"
      ? "var(--success)"
      : job.status === "FAILED"
        ? "var(--danger)"
        : job.status === "CANCELLED"
          ? "var(--foreground-muted)"
          : "var(--info)";

  const statusBg =
    job.status === "COMPLETED"
      ? "var(--success-soft)"
      : job.status === "FAILED"
        ? "var(--danger-soft)"
        : job.status === "CANCELLED"
          ? "rgba(0, 43, 78, 0.04)"
          : "var(--info-soft)";

  return (
    <div
      style={{
        ...cardStyle,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: "500",
            color: "var(--foreground)",
          }}
        >
          Detection Job
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: "600",
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            color: "white",
            background: statusColor,
          }}
        >
          {job.status}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "100%",
          height: "6px",
          borderRadius: "3px",
          background: "var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "6px",
            borderRadius: "3px",
            background: statusColor,
            width: `${job.progress_pct ?? 0}%`,
            transition: "width 500ms ease-out",
          }}
        />
      </div>
      <p
        style={{
          fontSize: "12px",
          color: "var(--foreground-muted)",
          margin: 0,
        }}
      >
        {job.progress_pct ?? 0}% complete
      </p>

      {job.status === "PROCESSING" && (
        <p
          style={{
            fontSize: "12px",
            color: "var(--info)",
            margin: 0,
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        >
          Analyzing P&ID with AI…
        </p>
      )}
      {job.status === "FAILED" && job.error_detail && (
        <p
          style={{
            fontSize: "12px",
            color: "var(--danger)",
            background: statusBg,
            borderRadius: "var(--radius-sm)",
            padding: "8px",
            margin: 0,
            fontFamily: "monospace",
          }}
        >
          {job.error_detail.slice(0, 300)}
        </p>
      )}

      {/* Cancel button */}
      {(job.status === "PENDING" || job.status === "PROCESSING") && (
        <button
          onClick={async () => {
            await fetch(`/api/detection/jobs/${jobId}/cancel`, {
              method: "POST",
            });
          }}
          style={{
            fontSize: "12px",
            color: "var(--danger)",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
            padding: 0,
            textAlign: "left",
          }}
        >
          Cancel job
        </button>
      )}
    </div>
  );
}

// ─── PidViewer ───────────────────────────────────────────────────────────────

function PidViewer({
  documentId,
  detections,
  selectedId,
  onSelect,
  page,
  totalPages,
  onPageChange,
  onBboxChange,
  drawMode,
  onDrawComplete,
  onDrawCancel,
}: {
  documentId: string;
  detections: Detection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onBboxChange?: (id: string, bbox: { x: number; y: number; w: number; h: number }) => void;
  drawMode?: boolean;
  onDrawComplete?: (bbox: { x: number; y: number; w: number; h: number }) => void;
  onDrawCancel?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [fullscreen, setFullscreen] = useState(false);
  // Natural image dimensions — used to map bbox coords to display space
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [imgLoading, setImgLoading] = useState(!!documentId);
  const [imgError, setImgError] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // ── BBox drag/scale meniru halaman legend (review/page.tsx) ──────────────
  // dragBbox dalam koordinat 0-1000 (SVG viewBox linear dengan natural px,
  // jadi 0-1000 bisa dipakai langsung untuk math lalu dirender ulang).
  // Editing & draw dinonaktifkan saat rotation !== 0 (sumbu tidak valid).
  const suppressClickRef = useRef(false);
  const [dragBbox, setDragBbox] = useState<null | {
    id: string;
    x: number; y: number; w: number; h: number;
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
    mode: string;
  }>(null);
  const [bboxSavedFlash, setBboxSavedFlash] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Draw-new-box state (koordinat SVG px = natural px)
  const [drawStart, setDrawStart] = useState<{ sx: number; sy: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Reset drag/draw saat ganti seleksi / halaman / dokumen / mode
  useEffect(() => {
    setDragBbox(null);
    setDrawStart(null);
    setDrawRect(null);
  }, [selectedId, page, documentId, drawMode]);

  const imgSrc = documentId
    ? `/api/documents/${documentId}/pages/${page}/image`
    : null;

  // Reset image state on page or document change
  useEffect(() => {
    setImgNatural(null);
    setImgLoading(!!documentId);
    setImgError(false);
  }, [documentId, page]);

  // Prefetch halaman tetangga agar navigasi ◀/▶ instan (browser cache 1 jam)
  useEffect(() => {
    if (!documentId) return;
    for (const p of [page - 1, page + 1]) {
      if (p < 1 || p > totalPages) continue;
      const img = new Image();
      img.src = `/api/documents/${documentId}/pages/${p}/image`;
    }
  }, [documentId, page, totalPages]);

  // Reset pan/zoom/rotation when page changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [page]);

  // ESC exits fullscreen / cancels draw mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawMode) {
          setDrawStart(null);
          setDrawRect(null);
          onDrawCancel?.();
        } else {
          setFullscreen(false);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawMode, onDrawCancel]);

  // Only the selected detection's bbox is shown — everything else stays hidden
  const visible = selectedId
    ? detections.filter(
        (d) =>
          d.id === selectedId &&
          d.detection_status !== "REJECTED" &&
          d.review_status !== "REJECTED" &&
          d.bbox_x !== null &&
          d.bbox_y !== null &&
          d.bbox_w !== null &&
          d.bbox_h !== null,
      )
    : [];

  // wheel must be non-passive to allow preventDefault (React onWheel is passive in Chrome)
  // Re-bind when `fullscreen` toggles: viewerContent remounts under a new parent,
  // so viewerRef.current points to a new DOM node.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((p) => Math.max(0.2, Math.min(6, p + d)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullscreen]);

  // Konversi client px → koordinat SVG (natural px). SVG viewBox = natural,
  // jadi rect (displayed, sudah termasuk zoom/pan) diskalakan linear.
  const clientToSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const nat = imgNatural;
    if (!svg || !nat) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      sx: ((clientX - rect.left) / rect.width) * nat.w,
      sy: ((clientY - rect.top) / rect.height) * nat.h,
    };
  };
  const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const handleMouseDown = (e: React.MouseEvent) => {
    // Draw mode: mousedown di area kosong mulai gambar kotak baru
    if (drawMode && rotation === 0) {
      if ((e.target as HTMLElement).closest("[data-bbox]")) return;
      const p = clientToSvg(e.clientX, e.clientY);
      if (!p) return;
      e.stopPropagation();
      setDrawStart(p);
      setDrawRect({ x: p.sx, y: p.sy, w: 0, h: 0 });
      return;
    }
    if ((e.target as HTMLElement).closest("[data-bbox]")) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (drawStart) {
      const p = clientToSvg(e.clientX, e.clientY);
      if (!p || !imgNatural) return;
      const x = clampNum(Math.min(drawStart.sx, p.sx), 0, imgNatural.w);
      const y = clampNum(Math.min(drawStart.sy, p.sy), 0, imgNatural.h);
      const w = clampNum(Math.abs(p.sx - drawStart.sx), 0, imgNatural.w - x);
      const h = clampNum(Math.abs(p.sy - drawStart.sy), 0, imgNatural.h - y);
      setDrawRect({ x, y, w, h });
      return;
    }
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => {
    // Selesaikan draw → normalisasi ke 0-1000, panggil parent untuk konfirmasi
    if (drawStart && drawRect && imgNatural) {
      const nx = Math.round((drawRect.x / imgNatural.w) * 1000);
      const ny = Math.round((drawRect.y / imgNatural.h) * 1000);
      const nw = Math.round((drawRect.w / imgNatural.w) * 1000);
      const nh = Math.round((drawRect.h / imgNatural.h) * 1000);
      setDrawStart(null);
      setDrawRect(null);
      if (nw >= 10 && nh >= 10) {
        onDrawComplete?.({
          x: clampNum(nx, 0, 1000 - nw),
          y: clampNum(ny, 0, 1000 - nh),
          w: Math.min(nw, 1000),
          h: Math.min(nh, 1000),
        });
      }
      return;
    }
    setDragging(false);
  };

  const rotate = () => setRotation((r) => (r + 90) % 360);
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  // ── BBox drag/resize meniru legend: 1 handler di <g>, mode dari ─────────
  // data-handle ("e|w|n|s|ne|nw|se|sw") atau "move". Math dalam 0-1000.
  const beginBboxDrag = (
    e: React.MouseEvent,
    id: string,
    mode: string,
    orig: { x: number; y: number; w: number; h: number },
  ) => {
    if (rotation !== 0 || !onBboxChange) return; // sumbu tidak valid saat dirotasi
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = false;
    setDragBbox({
      id,
      ...orig,
      startX: e.clientX,
      startY: e.clientY,
      origX: orig.x, origY: orig.y, origW: orig.w, origH: orig.h,
      mode,
    });
  };

  // Window listeners meniru legend: mousemove update dragBbox, mouseup autosave.
  useEffect(() => {
    if (!dragBbox) return;
    const svg = svgRef.current;
    if (!svg) return;
    const onMove = (e: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // client px → 0-1000 (rect sudah termasuk zoom/pan transform)
      const ndx = ((e.clientX - dragBbox.startX) / rect.width) * 1000;
      const ndy = ((e.clientY - dragBbox.startY) / rect.height) * 1000;
      if (Math.abs(e.clientX - dragBbox.startX) > 3 || Math.abs(e.clientY - dragBbox.startY) > 3) {
        suppressClickRef.current = true;
      }
      const o = dragBbox;
      if (o.mode === 'move') {
        const nx = clampNum(o.origX + ndx, 0, 1000 - o.origW);
        const ny = clampNum(o.origY + ndy, 0, 1000 - o.origH);
        setDragBbox((p) => (p ? { ...p, x: Math.round(nx), y: Math.round(ny) } : p));
      } else {
        // Resize — mode kombinasi e/w/n/s (mis. 'e', 'nw', 'se')
        const m: string = o.mode;
        const right = o.origX + o.origW;
        const bottom = o.origY + o.origH;
        let nx = o.origX, ny = o.origY, nw = o.origW, nh = o.origH;
        if (m.includes('e')) nw = clampNum(o.origW + ndx, 10, 1000 - o.origX);
        if (m.includes('s')) nh = clampNum(o.origH + ndy, 10, 1000 - o.origY);
        if (m.includes('w')) { nx = clampNum(o.origX + ndx, 0, right - 10); nw = right - nx; }
        if (m.includes('n')) { ny = clampNum(o.origY + ndy, 0, bottom - 10); nh = bottom - ny; }
        setDragBbox((p) => (p ? { ...p, x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) } : p));
      }
    };
    const onUp = async () => {
      const cur = dragBbox;
      setDragBbox(null);
      if (!cur || !onBboxChange) return;
      const d = detections.find((x) => x.id === cur.id);
      const norm = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
      if (
        d &&
        (norm.x !== (d.bbox_x ?? 0) ||
          norm.y !== (d.bbox_y ?? 0) ||
          norm.w !== (d.bbox_w ?? 0) ||
          norm.h !== (d.bbox_h ?? 0))
      ) {
        try {
          await onBboxChange(cur.id, norm);
          setBboxSavedFlash(true);
          if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
          savedFlashTimer.current = setTimeout(() => setBboxSavedFlash(false), 2500);
        } catch {
          /* parent menampilkan error via reload; abaikan di sini */
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // Re-bind saat dragBbox berubah (pola legend) agar closure selalu baca state terbaru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragBbox]);

  // Build CSS transform: rotation applied first, then zoom+pan
  const imgTransform = `rotate(${rotation}deg)`;
  const containerTransform = `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`;

  const viewerContent = (
    <>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          flexWrap: "wrap",
        }}
      >
        {/* Page nav */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              style={{ ...toolButtonStyle, opacity: page <= 1 ? 0.4 : 1 }}
            >
              ◀
            </button>
            <span
              style={{
                fontSize: "12px",
                color: "var(--foreground-muted)",
                padding: "0 8px",
                fontWeight: "500",
              }}
            >
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              style={{
                ...toolButtonStyle,
                opacity: page >= totalPages ? 0.4 : 1,
              }}
            >
              ▶
            </button>
          </div>
        )}

        <div style={{ width: 1, height: 16, background: "var(--border)" }} />

        {/* Zoom */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={() => setZoom((z) => Math.max(0.2, +(z - 0.2).toFixed(1)))}
            style={{ ...toolButtonStyle, fontWeight: "600" }}
          >
            −
          </button>
          <span
            style={{
              fontSize: "12px",
              color: "var(--foreground-muted)",
              width: 48,
              textAlign: "center",
              fontFamily: "var(--font-geist-mono, monospace)",
            }}
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(6, +(z + 0.2).toFixed(1)))}
            style={{ ...toolButtonStyle, fontWeight: "600" }}
          >
            +
          </button>
        </div>

        {/* Rotate button */}
        <button
          onClick={rotate}
          title="Rotate 90°"
          style={{
            ...toolButtonStyle,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <svg
            style={{ width: 14, height: 14 }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Rotate{rotation > 0 ? ` (${rotation}°)` : ""}
        </button>

        {/* Reset */}
        <button onClick={resetView} title="Reset view" style={toolButtonStyle}>
          Reset
        </button>

        {/* Phase 5/legend-style: autosave saat mouseup — indikator sukses */}
        {bboxSavedFlash && selectedId && (
          <span style={{ fontSize: "11px", color: "var(--success)", fontWeight: "600" }}>
            ✓ BBox saved
          </span>
        )}
        {drawMode && (
          <span style={{ fontSize: "11px", color: "var(--info)", fontWeight: "600" }}>
            ⊞ Draw mode — drag di gambar untuk buat kotak (Esc batal)
          </span>
        )}
        {(selectedId || drawMode) && rotation !== 0 && (
          <span style={{ fontSize: "11px", color: "var(--warning)" }}>
            Reset rotation ke 0° untuk edit bbox
          </span>
        )}

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--foreground-subtle)" }}>
            {visible.length > 0
              ? `Showing: ${(visible[0].asset_tag ?? visible[0].asset_type).slice(0, 24)}`
              : "Bbox hidden — select an asset to show"}
          </span>
          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            style={{
              ...toolButtonStyle,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {fullscreen ? (
              <svg
                style={{ width: 14, height: 14 }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                style={{ width: 14, height: 14 }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            )}
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* Viewer area */}
      <div
        style={{
          position: "relative",
          background: "var(--surface-muted)",
          overflow: "hidden",
          userSelect: "none",
          flex: 1,
          minHeight: fullscreen ? "calc(100vh - 80px)" : 600,
          cursor: drawMode ? "crosshair" : dragging ? "grabbing" : "grab",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        ref={viewerRef}
      >
        {/* Transformed container — zoom + pan, centered */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Inner wrapper takes zoom+pan transform */}
          <div
            style={{
              transform: containerTransform,
              transformOrigin: "center center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              maxWidth: "100%",
              maxHeight: "100%",
              flexShrink: 0,
            }}
          >
            {imgSrc && (
              <div
                style={{
                  transform: imgTransform,
                  transformOrigin: "center center",
                  lineHeight: 0,
                  position: "relative",
                  display: "inline-block",
                  flexShrink: 0,
                  maxWidth: "100%",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={imgSrc}
                  src={imgSrc}
                  alt={`P&ID page ${page}`}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImgNatural({
                      w: img.naturalWidth,
                      h: img.naturalHeight,
                    });
                    setImgLoading(false);
                    setImgError(false);
                  }}
                  onError={() => {
                    setImgLoading(false);
                    setImgError(true);
                  }}
                  style={{
                    display: "block",
                    width: "auto",
                    height: "auto",
                    maxWidth: fullscreen ? "88vw" : "100%",
                    maxHeight: fullscreen ? "calc(100vh - 200px)" : "560px",
                    opacity: imgLoading ? 0 : 1,
                    transition: "opacity 0.2s ease",
                  }}
                  draggable={false}
                />

                {/* SVG bbox overlay — Phase 5: selected bbox bisa drag + resize */}
                {imgNatural && !imgError && (
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      overflow: "visible",
                      pointerEvents: "none",
                    }}
                  >
                    {visible.map((d) => {
                      const isSel = d.id === selectedId;
                      // Drag aktif (legend-style): pakai dragBbox, bukan nilai DB
                      const drag = dragBbox && dragBbox.id === d.id ? dragBbox : null;
                      const nx = drag ? drag.x : (d.bbox_x ?? 0);
                      const ny = drag ? drag.y : (d.bbox_y ?? 0);
                      const nw = drag ? drag.w : (d.bbox_w ?? 50);
                      const nh = drag ? drag.h : (d.bbox_h ?? 50);
                      const x = (nx / 1000) * imgNatural.w;
                      const y = (ny / 1000) * imgNatural.h;
                      const w = (nw / 1000) * imgNatural.w;
                      const h = (nh / 1000) * imgNatural.h;
                      const selected = d.id === selectedId;
                      const editable = isSel && rotation === 0 && !!onBboxChange;
                      const color =
                        d.review_status === "APPROVED"
                          ? getComputedStyle(document.documentElement)
                              .getPropertyValue("--success")
                              .trim()
                          : (d.confidence ?? 0) >= 0.95
                            ? getComputedStyle(document.documentElement)
                                .getPropertyValue("--info")
                                .trim()
                            : (d.confidence ?? 0) >= 0.8
                              ? getComputedStyle(document.documentElement)
                                  .getPropertyValue("--warning")
                                  .trim()
                              : getComputedStyle(document.documentElement)
                                  .getPropertyValue("--danger")
                                  .trim();
                      const labelW = Math.max(w, 80);
                      const labelY = y > 22 ? y - 22 : y + h + 4;
                      // Handle resize 8-titik (koordinat pixel SVG)
                      const hs = Math.max(10, imgNatural.w * 0.008);
                      const hh = hs / 2;
                      const handles: Array<{ mode: string; cx: number; cy: number; cursor: string }> = editable
                        ? [
                            { mode: "nw", cx: x, cy: y, cursor: "nwse-resize" },
                            { mode: "n", cx: x + w / 2, cy: y, cursor: "ns-resize" },
                            { mode: "ne", cx: x + w, cy: y, cursor: "nesw-resize" },
                            { mode: "e", cx: x + w, cy: y + h / 2, cursor: "ew-resize" },
                            { mode: "se", cx: x + w, cy: y + h, cursor: "nwse-resize" },
                            { mode: "s", cx: x + w / 2, cy: y + h, cursor: "ns-resize" },
                            { mode: "sw", cx: x, cy: y + h, cursor: "nesw-resize" },
                            { mode: "w", cx: x, cy: y + h / 2, cursor: "ew-resize" },
                          ]
                        : [];
                      const effNorm = { x: nx, y: ny, w: nw, h: nh };
                      return (
                        <g
                          key={d.id}
                          data-bbox="true"
                          onClick={() => {
                            // Abaikan klik yang merupakan akhir dari drag (pola legend)
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false;
                              return;
                            }
                            onSelect(d.id);
                          }}
                          onMouseDown={(e) => {
                            // 1 handler meniru legend: baca data-handle dari target
                            if (!editable) return;
                            e.stopPropagation();
                            const handle = (e.target as Element).getAttribute?.("data-handle");
                            if (handle) {
                              beginBboxDrag(e, d.id, handle, effNorm);
                            } else if (isSel) {
                              beginBboxDrag(e, d.id, "move", effNorm);
                            }
                          }}
                          style={{ pointerEvents: "all", cursor: editable ? "move" : "pointer" }}
                        >
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill="transparent"
                          />
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill={selected ? `${color}18` : "none"}
                            stroke={color}
                            strokeWidth={selected ? 3 : 2}
                            strokeDasharray={selected ? undefined : "8 4"}
                            rx={3}
                            opacity={selected ? 1 : 0.85}
                          />
                          {/* Resize handles — drag untuk scale bbox manual */}
                          {handles.map((hd) => (
                            <rect
                              key={hd.mode}
                              data-handle={hd.mode}
                              x={hd.cx - hh}
                              y={hd.cy - hh}
                              width={hs}
                              height={hs}
                              fill="white"
                              stroke={color}
                              strokeWidth={2}
                              rx={2}
                              style={{ cursor: hd.cursor }}
                            />
                          ))}
                          <rect
                            x={x}
                            y={labelY}
                            width={labelW}
                            height={20}
                            fill={color}
                            rx={3}
                            opacity={selected ? 1 : 0.85}
                          />
                          <text
                            x={x + 5}
                            y={labelY + 14}
                            fill="white"
                            fontSize={13}
                            fontFamily="ui-monospace, monospace"
                            fontWeight={selected ? 700 : 400}
                          >
                            {(d.asset_tag ?? d.asset_type).slice(0, 16)}
                          </text>
                        </g>
                      );
                    })}
                    {/* Preview kotak baru saat draw mode */}
                    {drawMode && drawRect && imgNatural && (
                      <rect
                        x={drawRect.x}
                        y={drawRect.y}
                        width={Math.max(drawRect.w, 2)}
                        height={Math.max(drawRect.h, 2)}
                        fill="rgba(59,130,246,0.15)"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        strokeDasharray="8 4"
                        rx={3}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </svg>
                )}
              </div>
            )}

            {/* Loading */}
            {imgLoading && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    textAlign: "center",
                    color: "var(--foreground-muted)",
                  }}
                >
                  <svg
                    style={{
                      width: 32,
                      height: 32,
                      margin: "0 auto 8px",
                      animation: "spin 1s linear infinite",
                    }}
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      opacity="0.25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      opacity="0.75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  <p style={{ fontSize: 12 }}>Rendering page {page}…</p>
                </div>
              </div>
            )}

            {/* Error / empty */}
            {(imgError || !imgSrc) && !imgLoading && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    textAlign: "center",
                    color: "var(--foreground-subtle)",
                  }}
                >
                  <svg
                    style={{ width: 56, height: 56, margin: "0 auto 8px" }}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p style={{ fontSize: 13 }}>
                    {imgError
                      ? "Failed to load page"
                      : "Select document to view"}
                  </p>
                  <p style={{ fontSize: 11, marginTop: 4 }}>
                    {imgError
                      ? "Check server logs"
                      : "Run detection to see bounding boxes"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend bar */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          alignItems: "center",
          padding: "8px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <span style={legendItemStyle}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 2,
              background: "var(--info)",
              borderRadius: 1,
            }}
          />
          ≥90% High
        </span>
        <span style={legendItemStyle}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 2,
              background: "var(--warning)",
              borderRadius: 1,
            }}
          />
          ≥70% Medium
        </span>
        <span style={legendItemStyle}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 2,
              background: "var(--danger)",
              borderRadius: 1,
            }}
          />
          Review
        </span>
        <span style={legendItemStyle}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 2,
              background: "var(--success)",
              borderRadius: 1,
            }}
          />
          Confirmed
        </span>
        <span style={{ marginLeft: "auto", color: "var(--foreground-subtle)" }}>
          {drawMode
            ? "Draw mode: drag di gambar untuk buat kotak · Esc batal"
            : "Scroll to zoom · Drag to pan · Drag bbox/handle untuk koreksi · Select asset untuk tampilkan bbox"}
        </span>
      </div>
    </>
  );

  // Fullscreen overlay
  if (fullscreen) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: "var(--background)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {viewerContent}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...cardStyle,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 480,
      }}
    >
      {viewerContent}
    </div>
  );
}

// ─── AssetDetail ─────────────────────────────────────────────────────────────

function AssetDetail({
  detection,
  onClose,
  onConfirm,
  onReject,
  onEdit,
}: {
  detection: Detection;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onEdit: (id: string, fields: Partial<Detection>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editTag, setEditTag] = useState(detection.asset_tag ?? "");
  const [editType, setEditType] = useState(detection.asset_type);
  const [editDesc, setEditDesc] = useState(detection.description ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onEdit(detection.id, {
      asset_tag: editTag || null,
      asset_type: editType,
      description: editDesc || null,
    } as Partial<Detection>);
    setSaving(false);
    setEditing(false);
  };

  const ev = parseEvidence(detection.evidence);
  const pct =
    detection.confidence !== null
      ? Math.round(detection.confidence * 100)
      : null;

  const successBtn: React.CSSProperties = {
    flex: 1,
    padding: "6px 8px",
    borderRadius: "var(--radius-sm)",
    background: "var(--success)",
    color: "white",
    fontSize: "12px",
    fontWeight: "600",
    border: "none",
    cursor: "pointer",
    transition: "all 150ms ease-out",
  };
  const infoBtn: React.CSSProperties = {
    flex: 1,
    padding: "6px 8px",
    borderRadius: "var(--radius-sm)",
    background: "var(--info)",
    color: "white",
    fontSize: "12px",
    fontWeight: "600",
    border: "none",
    cursor: "pointer",
    transition: "all 150ms ease-out",
  };
  const dangerBtn: React.CSSProperties = {
    flex: 1,
    padding: "6px 8px",
    borderRadius: "var(--radius-sm)",
    background: "var(--danger)",
    color: "white",
    fontSize: "12px",
    fontWeight: "600",
    border: "none",
    cursor: "pointer",
    transition: "all 150ms ease-out",
  };

  return (
    <div
      style={{
        ...cardStyle,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontWeight: "600",
            color: "var(--foreground)",
            fontSize: "14px",
          }}
        >
          {detection.asset_tag ?? detection.asset_type}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "20px",
            color: "var(--foreground-muted)",
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          fontSize: "14px",
        }}
      >
        {!editing ? (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "8px 16px",
              margin: 0,
            }}
          >
            {[
              ["Asset Tag", detection.asset_tag ?? "—"],
              ["Asset Type", detection.asset_type],
              ["Equipment Class", detection.equipment_class ?? "—"],
              ["Description", detection.description ?? "—"],
              [
                "P&ID Page",
                detection.pid_page !== null ? String(detection.pid_page) : "—",
              ],
              ["Service", detection.service ?? "—"],
              ["Location", detection.location ?? "—"],
              ["Unit", detection.unit ?? "—"],
              ["Area", detection.area ?? "—"],
              ["Confidence", pct !== null ? `${pct}%` : "—"],
              ["Detection Status", detection.detection_status],
              ["Review Status", detection.review_status],
            ].map(([k, v]) => (
              <div key={k}>
                <dt
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    color: "var(--foreground-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {k}
                </dt>
                <dd style={{ margin: "2px 0 0", color: "var(--foreground)" }}>
                  {v}
                </dd>
              </div>
            ))}

            {/* BBox */}
            <div style={{ gridColumn: "1 / -1" }}>
              <dt
                style={{
                  fontSize: "11px",
                  fontWeight: "600",
                  color: "var(--foreground-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Bounding Box
              </dt>
              <dd
                style={{
                  margin: "2px 0 0",
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "12px",
                  color: "var(--foreground-muted)",
                }}
              >
                x={detection.bbox_x} y={detection.bbox_y} w={detection.bbox_w}{" "}
                h={detection.bbox_h}
              </dd>
            </div>

            {/* Evidence */}
            {ev.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    color: "var(--foreground-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: "4px",
                  }}
                >
                  Evidence
                </dt>
                <ul
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                  }}
                >
                  {ev.map((e, i) => (
                    <li
                      key={i}
                      style={{
                        fontSize: "12px",
                        color: "var(--foreground-muted)",
                        display: "flex",
                        gap: "6px",
                      }}
                    >
                      <span style={{ color: "var(--info)", marginTop: "2px" }}>
                        •
                      </span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </dl>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <label style={{ display: "block" }}>
              <span style={fieldLabelStyle}>Asset Tag</span>
              <input
                style={{ ...selectStyle, marginTop: "4px" }}
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabelStyle}>Asset Type</span>
              <input
                style={{ ...selectStyle, marginTop: "4px" }}
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabelStyle}>Description</span>
              <textarea
                style={{ ...selectStyle, marginTop: "4px", resize: "none" }}
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "12px 16px",
          display: "flex",
          gap: "8px",
        }}
      >
        {detection.review_status !== "APPROVED" &&
          detection.review_status !== "REJECTED" && (
            <>
              <button
                onClick={() => onConfirm(detection.id)}
                style={successBtn}
              >
                Confirm
              </button>
              {!editing ? (
                <button onClick={() => setEditing(true)} style={infoBtn}>
                  Edit
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ ...infoBtn, opacity: saving ? 0.5 : 1 }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
              <button onClick={() => onReject(detection.id)} style={dangerBtn}>
                Reject
              </button>
            </>
          )}
        {editing && (
          <button
            onClick={() => setEditing(false)}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              fontSize: "12px",
              color: "var(--foreground-muted)",
              background: "var(--surface)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
        {(detection.review_status === "APPROVED" ||
          detection.review_status === "REJECTED") && (
          <span
            style={{
              fontSize: "12px",
              color: "var(--foreground-subtle)",
              fontStyle: "italic",
            }}
          >
            Reviewed — {detection.review_status.toLowerCase()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── DetectionsTable ─────────────────────────────────────────────────────────

const STATUS_OPTS = ["", "DETECTED", "CONFIRMED", "REJECTED", "MANUAL"];
const CONF_OPTS = [
  { label: "All", value: "" },
  { label: "≥95% High", value: "high" },
  { label: "≥80% Medium", value: "medium" },
  { label: "<80% Review", value: "low" },
];

function DetectionsTable({
  detections,
  selectedId,
  onSelect,
}: {
  detections: Detection[];
  selectedId: string | null;
  onSelect: (d: Detection) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [conf, setConf] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<
    "tag" | "type" | "page" | "conf" | "status"
  >("tag");
  const [sortAsc, setSortAsc] = useState(true);
  // M1: Hide duplicates by default — show only highest-confidence detection per normalized tag+type combo
  const [hideDupes, setHideDupes] = useState(true);
  const PAGE_SIZE = 15;

  // M1: Build dedup map — for each normalized key keep highest-confidence detection
  const dedupMap = useMemo(() => {
    const map = new Map<string, Detection>();
    const countMap = new Map<string, number>();
    for (const d of detections) {
      const key = `${(d.asset_tag ?? "").toUpperCase().trim()}|${normalizeType(d.asset_type)}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      const existing = map.get(key);
      if (!existing || (d.confidence ?? 0) > (existing.confidence ?? 0)) {
        map.set(key, d);
      }
    }
    return { map, countMap };
  }, [detections]);

  const filtered = (() => {
    // M1: Apply dedup first if enabled
    const base = hideDupes ? Array.from(dedupMap.map.values()) : detections;
    return base.filter((d) => {
      const tag = d.asset_tag ?? "";
      const type = normalizeType(d.asset_type);
      if (
        q &&
        !tag.toLowerCase().includes(q.toLowerCase()) &&
        !type.toLowerCase().includes(q.toLowerCase())
      )
        return false;
      if (status) {
        const matchStatus =
          status === "CONFIRMED"
            ? d.review_status === "APPROVED"
            : status === "REJECTED"
              ? d.review_status === "REJECTED"
              : d.detection_status === status;
        if (!matchStatus) return false;
      }
      if (conf === "high" && (d.confidence ?? 0) < 0.95) return false;
      if (
        conf === "medium" &&
        ((d.confidence ?? 0) < 0.8 || (d.confidence ?? 0) >= 0.95)
      )
        return false;
      if (conf === "low" && (d.confidence ?? 0) >= 0.8) return false;
      return true;
    });
  })();

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "tag")
      cmp = (a.asset_tag ?? "").localeCompare(b.asset_tag ?? "");
    else if (sortBy === "type")
      cmp = (a.asset_type ?? "").localeCompare(b.asset_type ?? "");
    else if (sortBy === "page") cmp = (a.pid_page ?? 0) - (b.pid_page ?? 0);
    else if (sortBy === "conf") cmp = (a.confidence ?? 0) - (b.confidence ?? 0);
    else if (sortBy === "status")
      cmp = (a.review_status ?? "").localeCompare(b.review_status ?? "");
    return sortAsc ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (col: "tag" | "type" | "page" | "conf" | "status") => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else {
      setSortBy(col);
      setSortAsc(true);
    }
    setPage(1);
  };

  const SortHeader = ({
    col,
    label,
  }: {
    col: "tag" | "type" | "page" | "conf" | "status";
    label: string;
  }) => (
    <th
      onClick={() => toggleSort(col)}
      style={{
        textAlign: "left",
        padding: "8px 12px",
        fontWeight: "600",
        color: "var(--foreground-muted)",
        cursor: "pointer",
        background: "var(--surface-muted)",
        transition: "background 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(0, 43, 78, 0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface-muted)";
      }}
    >
      {label} {sortBy === col && (sortAsc ? "↑" : "↓")}
    </th>
  );

  const cellBase: React.CSSProperties = { padding: "8px 12px" };

  return (
    <div
      style={{
        ...cardStyle,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Filters */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <input
          type="text"
          placeholder="Search tag / type…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          style={{
            ...selectStyle,
            width: 176,
            fontSize: "12px",
            padding: "6px 10px",
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          style={{ ...selectStyle, fontSize: "12px", padding: "6px 10px" }}
        >
          {STATUS_OPTS.map((s) => (
            <option key={s} value={s}>
              {s || "All Status"}
            </option>
          ))}
        </select>
        <select
          value={conf}
          onChange={(e) => {
            setConf(e.target.value);
            setPage(1);
          }}
          style={{ ...selectStyle, fontSize: "12px", padding: "6px 10px" }}
        >
          {CONF_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* M1: Dedup toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "12px",
            color: "var(--foreground-muted)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={hideDupes}
            onChange={(e) => {
              setHideDupes(e.target.checked);
              setPage(1);
            }}
            style={{ cursor: "pointer" }}
          />
          Hide duplicates
        </label>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "12px",
            color: "var(--foreground-subtle)",
            alignSelf: "center",
          }}
        >
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          {hideDupes && detections.length !== filtered.length
            ? ` (${detections.length} total)`
            : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table
          style={{
            width: "100%",
            fontSize: "12px",
            borderCollapse: "collapse",
          }}
        >
          <thead
            style={{
              background: "var(--surface-muted)",
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            <tr>
              <th
                style={{
                  textAlign: "left",
                  ...cellBase,
                  fontWeight: "600",
                  color: "var(--foreground-muted)",
                }}
              >
                No
              </th>
              <SortHeader col="tag" label="Asset Tag" />
              <SortHeader col="type" label="Asset Type" />
              <SortHeader col="page" label="Page" />
              <SortHeader col="conf" label="Conf." />
              <SortHeader col="status" label="Status" />
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: "48px 12px",
                    textAlign: "center",
                    color: "var(--foreground-subtle)",
                  }}
                >
                  No detections found.
                </td>
              </tr>
            ) : (
              slice.map((d, i) => (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d)}
                  style={{
                    borderTop: "1px solid var(--border)",
                    cursor: "pointer",
                    background:
                      d.id === selectedId
                        ? "var(--primary-soft)"
                        : "transparent",
                    transition: "background 150ms ease-out",
                  }}
                  onMouseEnter={(e) => {
                    if (d.id !== selectedId)
                      e.currentTarget.style.background =
                        "rgba(0, 43, 78, 0.04)";
                  }}
                  onMouseLeave={(e) => {
                    if (d.id !== selectedId)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td
                    style={{ ...cellBase, color: "var(--foreground-subtle)" }}
                  >
                    {(page - 1) * PAGE_SIZE + i + 1}
                  </td>
                  {/* M4: No-tag indicator */}
                  <td
                    style={{
                      ...cellBase,
                      fontWeight: "500",
                      fontFamily: "var(--font-geist-mono, monospace)",
                    }}
                  >
                    {d.asset_tag ? (
                      <span style={{ color: "var(--foreground)" }}>
                        {d.asset_tag}
                      </span>
                    ) : (
                      <span
                        style={{
                          color: "var(--foreground-subtle)",
                          fontStyle: "italic",
                          fontSize: "11px",
                          background: "var(--surface-muted)",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          border: "1px dashed var(--border)",
                        }}
                      >
                        no tag
                      </span>
                    )}
                  </td>
                  {/* M3: Normalized type + source badge */}
                  <td style={{ ...cellBase, color: "var(--foreground)" }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <span>{normalizeType(d.asset_type)}</span>
                      {sourceBadge(d.detection_source)}
                    </div>
                  </td>
                  <td style={{ ...cellBase, color: "var(--foreground-muted)" }}>
                    {d.pid_page ?? "—"}
                  </td>
                  <td style={cellBase}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      {confBadge(d.confidence)}
                      {/* M1: Show duplicate count */}
                      {(() => {
                        const key = `${(d.asset_tag ?? "").toUpperCase().trim()}|${normalizeType(d.asset_type)}`;
                        const cnt = dedupMap.countMap.get(key) ?? 1;
                        return cnt > 1 ? (
                          <span
                            style={{
                              fontSize: "10px",
                              color: "var(--warning)",
                              fontWeight: "500",
                            }}
                          >
                            {cnt}× dup
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  <td style={cellBase}>
                    {statusBadge(d.detection_status, d.review_status)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "var(--foreground-muted)",
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ ...toolButtonStyle, opacity: page === 1 ? 0.4 : 1 }}
          >
            ←
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              ...toolButtonStyle,
              opacity: page === totalPages ? 0.4 : 1,
            }}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function DetectionWorkspace() {
  const searchParams = useSearchParams();
  const initProjectId = searchParams.get("project_id") ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [legends, setLegends] = useState<Legend[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);

  const [projectId, setProjectId] = useState(initProjectId);
  const [documentId, setDocumentId] = useState("");
  const [legendId, setLegendId] = useState("");

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  // Draw-to-add: tekan Add Assets Manually → mode draw di viewer → konfirmasi kotak → modal
  const [drawMode, setDrawMode] = useState(false);
  const [pendingDrawBbox, setPendingDrawBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [confirmingDraw, setConfirmingDraw] = useState(false);

  const maxPage = detections.length
    ? Math.max(1, ...detections.map((d) => d.pid_page ?? 1))
    : 1;

  // Detections filtered to current page (null means all pages)
  const pageDetections = currentPage
    ? detections.filter((d) => d.pid_page === currentPage)
    : detections;

  // Stats (over all detections, not just current page)
  const total = detections.length;
  const confirmed = detections.filter(
    (d) => d.review_status === "APPROVED",
  ).length;
  const pending = detections.filter(
    (d) => d.review_status === "PENDING",
  ).length;
  const rejected = detections.filter(
    (d) => d.review_status === "REJECTED",
  ).length;
  const avgConf = detections.length
    ? Math.round(
        (detections.reduce((s, d) => s + (d.confidence ?? 0), 0) /
          detections.length) *
          100,
      )
    : null;

  // Load reference data
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []));
    fetch("/api/legends")
      .then((r) => r.json())
      .then((d) => setLegends(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setDocuments([]);
      setDocumentId("");
      return;
    }
    fetch(`/api/documents?project_id=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setDocuments(arr);
        // Only auto-select first doc when no doc selected yet
        setDocumentId((prev) => prev || (arr.length ? arr[0].id : ""));
      });
  }, [projectId]);

  // Auto-load last completed job (with detections) when document is selected
  useEffect(() => {
    if (!documentId) {
      setCurrentJobId(null);
      setDetections([]);
      return;
    }
    // Load most recent completed job for status display
    fetch(
      `/api/detection/jobs?document_id=${documentId}&limit=1&status=COMPLETED`,
    )
      .then((r) => r.json())
      .then((d) => {
        const jobs = Array.isArray(d) ? d : Array.isArray(d.data) ? d.data : [];
        if (jobs[0]) setCurrentJobId(jobs[0].id);
      })
      .catch(() => {});
  }, [documentId]);

  const loadDetections = useCallback(async () => {
    if (!documentId) return;
    // Query by document_id — works regardless of which job produced the detections
    const r = await fetch(
      `/api/detections?document_id=${documentId}&limit=500`,
    );
    const d = await r.json();
    setDetections(Array.isArray(d.data) ? d.data : []);
  }, [documentId]);

  const handleRunDetection = async () => {
    if (!documentId) return;
    setRunning(true);
    setDetections([]);
    setSelectedDetection(null);
    const r = await fetch("/api/detection/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_id: documentId,
        legend_id: legendId || null,
        project_id: projectId || null,
      }),
    });
    const j = await r.json();
    setCurrentJobId(j.id);
    setRunning(false);
  };

  const handleJobComplete = useCallback(async () => {
    await loadDetections();
  }, [loadDetections]);

  // Load detections when document selected; poll while job is running
  useEffect(() => {
    if (!documentId) return;
    loadDetections();
    const t = setInterval(loadDetections, 5000);
    return () => clearInterval(t);
  }, [documentId, loadDetections]);

  const handleConfirm = async (id: string) => {
    await fetch(`/api/detections/${id}/confirm`, { method: "POST" });
    await loadDetections();
    setSelectedDetection((prev) =>
      prev?.id === id
        ? { ...prev, detection_status: "CONFIRMED", review_status: "APPROVED" }
        : prev,
    );
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/detections/${id}/reject`, { method: "POST" });
    await loadDetections();
    setSelectedDetection(null);
  };

  const handleEdit = async (id: string, fields: Partial<Detection>) => {
    const body: Record<string, unknown> = {};
    if (fields.asset_tag !== undefined) body.asset_tag = fields.asset_tag;
    if (fields.asset_type !== undefined) body.asset_type = fields.asset_type;
    if (fields.description !== undefined) body.description = fields.description;
    await fetch(`/api/detections/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadDetections();
    setSelectedDetection((prev) =>
      prev?.id === id ? { ...prev, ...fields } : prev,
    );
  };

  // Phase 5: persist koreksi bbox manual dari PidViewer (drag/resize)
  const handleBboxChange = async (
    id: string,
    bbox: { x: number; y: number; w: number; h: number },
  ) => {
    await fetch(`/api/detections/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bbox_x: bbox.x,
        bbox_y: bbox.y,
        bbox_w: bbox.w,
        bbox_h: bbox.h,
      }),
    });
    await loadDetections();
    setSelectedDetection((prev) =>
      prev?.id === id
        ? { ...prev, bbox_x: bbox.x, bbox_y: bbox.y, bbox_w: bbox.w, bbox_h: bbox.h }
        : prev,
    );
  };

  const selectedId = selectedDetection?.id ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        gap: "24px",
        paddingBottom: "24px",
      }}
    >
      {/* Manual Add Modal */}
      <ManualAddModal
        open={showManualAdd}
        onClose={() => {
          setShowManualAdd(false);
          setPendingDrawBbox(null);
          setConfirmingDraw(false);
        }}
        onSave={loadDetections}
        documentId={documentId}
        legendId={legendId}
        jobId={currentJobId}
        initialBbox={pendingDrawBbox}
      />

      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "600",
            color: "var(--foreground)",
            margin: "0 0 8px",
          }}
        >
          Automatic Asset Detection
        </h1>
        <p
          style={{
            fontSize: "14px",
            color: "var(--foreground-muted)",
            margin: 0,
          }}
        >
          Select document and legend, then run detection.
        </p>
      </div>

      {/* Controls */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "16px",
            alignItems: "flex-end",
            padding: "20px",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minWidth: "160px",
            }}
          >
            <span style={fieldLabelStyle}>Project</span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setDocumentId("");
                setCurrentJobId(null);
                setDetections([]);
              }}
              style={selectStyle}
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minWidth: "224px",
            }}
          >
            <span style={fieldLabelStyle}>Document</span>
            <select
              value={documentId}
              onChange={(e) => {
                setDocumentId(e.target.value);
                setCurrentJobId(null);
                setDetections([]);
              }}
              disabled={!projectId}
              style={selectStyle}
            >
              <option value="">Select document…</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename} ({d.page_count}p)
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minWidth: "192px",
            }}
          >
            <span style={fieldLabelStyle}>Legend</span>
            <select
              value={legendId}
              onChange={(e) => setLegendId(e.target.value)}
              style={selectStyle}
            >
              <option value="">No legend (auto-detect)</option>
              {legends.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={handleRunDetection}
            disabled={running || !documentId}
            style={
              running || !documentId
                ? { ...primaryButtonStyle, opacity: 0.5, cursor: "not-allowed" }
                : primaryButtonStyle
            }
          >
            {running ? "Starting…" : "Run Detection"}
          </button>

          {/* Manual Add button — masuk draw mode di viewer (bukan langsung modal) */}
          <button
            onClick={() => {
              if (drawMode) {
                setDrawMode(false);
              } else {
                setDrawMode(true);
                setConfirmingDraw(false);
                setPendingDrawBbox(null);
                setSelectedDetection(null);
              }
            }}
            disabled={!documentId}
            style={
              !documentId
                ? { ...buttonStyle, opacity: 0.4, cursor: "not-allowed" }
                : drawMode
                  ? { ...primaryButtonStyle }
                  : buttonStyle
            }
          >
            {drawMode ? "✕ Cancel Drawing" : "+ Add Asset Manually"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {detections.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "12px",
          }}
        >
          {[
            { label: "Detected", value: total, color: "var(--foreground)" },
            { label: "Confirmed", value: confirmed, color: "var(--success)" },
            {
              label: "Pending Review",
              value: pending,
              color: "var(--warning)",
            },
            { label: "Rejected", value: rejected, color: "var(--danger)" },
            {
              label: "Avg Confidence",
              value: avgConf !== null ? `${avgConf}%` : "—",
              color: "var(--info)",
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{ ...cardStyle, padding: "12px", textAlign: "center" }}
            >
              <p
                style={{
                  fontSize: "20px",
                  fontWeight: "600",
                  color: s.color,
                  margin: 0,
                }}
              >
                {s.value}
              </p>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--foreground-muted)",
                  margin: "4px 0 0",
                }}
              >
                {s.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Main workspace: Viewer (left, wide) + Table+Detail (right, narrower) */}
      {detections.length > 0 || currentJobId ? (
        <div style={{ display: "flex", gap: "12px", flex: 1, minHeight: 700 }}>
          {/* Left: Viewer — takes most of the width (~75%) */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {/* Job progress inline above viewer — compact, doesn't push viewer down */}
            {currentJobId && (
              <div style={{ flexShrink: 0 }}>
                <JobProgress
                  jobId={currentJobId}
                  onComplete={handleJobComplete}
                />
              </div>
            )}
            {/* Confirm bar: tampil setelah user selesai gambar kotak */}
            {confirmingDraw && pendingDrawBbox && (
              <div
                style={{
                  ...cardStyle,
                  flexShrink: 0,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  border: "1px solid var(--info)",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--foreground)" }}>
                  Use this box?
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--foreground-muted)",
                    fontFamily: "var(--font-geist-mono, monospace)",
                  }}
                >
                  x={pendingDrawBbox.x} y={pendingDrawBbox.y} w={pendingDrawBbox.w} h={pendingDrawBbox.h}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => {
                      setConfirmingDraw(false);
                      setShowManualAdd(true);
                    }}
                    style={{ ...primaryButtonStyle, padding: "6px 14px", fontSize: "12px" }}
                  >
                    Use this box
                  </button>
                  <button
                    onClick={() => {
                      setPendingDrawBbox(null);
                      setConfirmingDraw(false);
                      setDrawMode(true);
                    }}
                    style={{ ...buttonStyle, padding: "6px 14px", fontSize: "12px" }}
                  >
                    Redraw
                  </button>
                  <button
                    onClick={() => {
                      setPendingDrawBbox(null);
                      setConfirmingDraw(false);
                      setDrawMode(false);
                    }}
                    style={{ ...buttonStyle, padding: "6px 14px", fontSize: "12px" }}
                  >
                    Cancel
                  </button>
                </span>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 640 }}>
              <PidViewer
                documentId={documentId}
                detections={pageDetections}
                selectedId={selectedId}
                onSelect={(id) => {
                  const d = detections.find((x) => x.id === id);
                  if (d) setSelectedDetection(d);
                }}
                page={currentPage || 1}
                totalPages={maxPage}
                onPageChange={setCurrentPage}
                onBboxChange={handleBboxChange}
                drawMode={drawMode}
                onDrawComplete={(rect) => {
                  setPendingDrawBbox(rect);
                  setConfirmingDraw(true);
                  setDrawMode(false);
                }}
                onDrawCancel={() => setDrawMode(false)}
              />
            </div>
          </div>

          {/* Right panel: Detail on top (when selected) + Table below */}
          <div
            style={{
              width: 320,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              overflowY: "auto",
            }}
          >
            {selectedDetection && (
              <div style={{ flexShrink: 0 }}>
                <AssetDetail
                  detection={selectedDetection}
                  onClose={() => setSelectedDetection(null)}
                  onConfirm={handleConfirm}
                  onReject={handleReject}
                  onEdit={handleEdit}
                />
              </div>
            )}
            <div style={{ flex: 1, minHeight: 300 }}>
              <DetectionsTable
                detections={detections}
                selectedId={selectedId}
                onSelect={(d) => {
                  setSelectedDetection(d);
                  // Jump viewer to the selected symbol's page so its bbox becomes visible
                  if (d.pid_page !== null && d.pid_page !== currentPage)
                    setCurrentPage(d.pid_page);
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        !currentJobId && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px dashed var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--foreground-muted)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <svg
                style={{ width: 48, height: 48, margin: "0 auto 12px" }}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              <p style={{ fontSize: "14px", fontWeight: "500" }}>
                Select a document and run detection
              </p>
              <p style={{ fontSize: "12px", marginTop: "4px" }}>
                AI will analyze your P&ID and detect assets
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// Need Suspense for useSearchParams
export default function DetectionPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 24, color: "var(--foreground-muted)" }}>
          Loading...
        </div>
      }
    >
      <DetectionWorkspace />
    </Suspense>
  );
}
