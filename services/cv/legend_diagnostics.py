"""
Stage 2 — Legend Reference diagnostics (quality assessment, NOT detection).

For each legend reference crop, measures (all deterministic, OpenCV-only):
  inkDensity      fraction of ink pixels in crop
  borderScore     fraction of ink touching the outer border (table-border contamination)
  textScore       likelihood the crop is mostly text (many small components)
  whitespaceScore fraction of crop outside the ink bounding box (excessive margin/blank)
  geometry        aspect ratio / area sanity

Status (initial engineering gates, documented — NOT tuned to detection counts):
  rejected: blank (ink < 0.005), invalid geometry, or page-sized region
  review:   border contamination, text-dominant, excessive whitespace, tiny area
  validated: otherwise

Duplicates are clustered conservatively (template NCC >= 0.95 AND same
normalized label) for REPORTING only — no class/grouping is created here
(grouping is Stage 3).

Nothing is deleted or overwritten. Raw crops are always preserved; this
module only READS crops and RETURNS assessments + visual artifacts.
"""
from __future__ import annotations

import base64
from dataclasses import asdict, dataclass, field

import cv2
import numpy as np


# Initial gates (Stage 2) — documented, conservative, not tuned to detection.
BLANK_INK = 0.005
MIN_AREA_PX = 100
MIN_ASPECT = 0.1
MAX_ASPECT = 10.0
BORDER_CONTAMINATION = 0.30
TEXT_DOMINANT = 0.60
WHITESPACE_EXCESS = 0.85
TINY_AREA = 400
DUPLICATE_NCC = 0.95


@dataclass
class ReferenceQuality:
    symbolId: str = ""
    label: str = ""
    inkDensity: float = 0.0
    borderScore: float = 0.0
    textScore: float = 0.0
    whitespaceScore: float = 0.0
    aspectRatio: float = 0.0
    area: float = 0.0
    inkBBox: dict = field(default_factory=dict)   # tight ink box, crop-local px
    textRegion: dict | None = None                # estimated text area, crop-local
    status: str = "review"                        # validated | review | rejected
    reasons: list = field(default_factory=list)
    duplicateGroup: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _decode(b64: str) -> np.ndarray | None:
    try:
        raw = base64.b64decode(b64)
        img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        return img
    except Exception:
        return None


def analyze_crop(symbol_id: str, label: str, crop_b64: str) -> ReferenceQuality:
    q = ReferenceQuality(symbolId=symbol_id, label=label)
    gray = _decode(crop_b64)
    if gray is None or gray.size == 0:
        q.status = "rejected"
        q.reasons.append("undecodable crop image")
        return q
    h, w = gray.shape[:2]
    q.area = float(w * h)
    q.aspectRatio = round(w / h, 4) if h > 0 else 0.0
    if w <= 0 or h <= 0 or q.area < MIN_AREA_PX:
        q.status = "rejected"
        q.reasons.append(f"invalid geometry {w}x{h}")
        return q
    if not (MIN_ASPECT <= q.aspectRatio <= MAX_ASPECT):
        q.status = "rejected"
        q.reasons.append(f"aspect ratio out of range: {q.aspectRatio}")
        return q

    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink = (bw > 0)
    q.inkDensity = round(float(ink.mean()), 4)
    if q.inkDensity < BLANK_INK:
        q.status = "rejected"
        q.reasons.append(f"blank crop (ink {q.inkDensity})")
        return q

    # Tight ink bbox (crop-local).
    ys, xs = np.nonzero(ink)
    ix0, iy0, ix1, iy1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    q.inkBBox = {"x": ix0, "y": iy0, "width": ix1 - ix0 + 1, "height": iy1 - iy0 + 1}
    ink_area = float((ix1 - ix0 + 1) * (iy1 - iy0 + 1))
    q.whitespaceScore = round(1.0 - ink_area / q.area, 4)

    # Border contamination: ink touching the outer 2px frame.
    frame = np.zeros_like(bw)
    frame[:2, :] = bw[:2, :]
    frame[-2:, :] = bw[-2:, :]
    frame[:, :2] = bw[:, :2]
    frame[:, -2:] = bw[:, -2:]
    ink_px = float(ink.sum())
    q.borderScore = round(float((frame > 0).sum()) / ink_px, 4) if ink_px > 0 else 0.0

    # Text heuristic: many similarly-small connected components (glyphs).
    # Measured separation: text "GATE VALVE PUMP" → 12 comps, each ~1% of
    # crop; symbol box → 2 comps with a dominant blob. Small = <2% of area.
    num, _, stats, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    areas = [float(stats[i, cv2.CC_STAT_AREA]) for i in range(1, num)]
    small = [a for a in areas if a < 0.02 * q.area]
    small_ink = sum(small)
    q.textScore = round(min(1.0, (len(small) / 40.0) * 0.5 + (small_ink / ink_px) * 0.5), 4) \
        if ink_px > 0 and areas else 0.0
    if small and small_ink > 0.3 * ink_px:
        # Union box of small components = estimated text region.
        tx0 = ty0 = None
        tx1 = ty1 = 0
        for i in range(1, num):
            a = float(stats[i, cv2.CC_STAT_AREA])
            if a < 0.02 * q.area:
                x, y = int(stats[i, cv2.CC_STAT_LEFT]), int(stats[i, cv2.CC_STAT_TOP])
                ww, hh = int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT])
                tx0 = x if tx0 is None else min(tx0, x)
                ty0 = y if ty0 is None else min(ty0, y)
                tx1, ty1 = max(tx1, x + ww), max(ty1, y + hh)
        if tx0 is not None:
            q.textRegion = {"x": tx0, "y": ty0, "width": tx1 - tx0, "height": ty1 - ty0}

    # Status gating (conservative; honest about uncertainty).
    reasons: list[str] = []
    if q.borderScore >= BORDER_CONTAMINATION:
        reasons.append(f"border contamination {q.borderScore} (table lines?)")
    if q.textScore >= TEXT_DOMINANT:
        reasons.append(f"text-dominant crop {q.textScore}")
    if q.whitespaceScore >= WHITESPACE_EXCESS:
        reasons.append(f"excessive whitespace {q.whitespaceScore}")
    if q.area < TINY_AREA:
        reasons.append(f"tiny crop area {q.area:.0f}px")
    if reasons:
        q.status = "review"
        q.reasons = reasons
    else:
        q.status = "validated"
        q.reasons = ["ink/geometry/text checks passed"]
    return q


def _norm_thumb(gray: np.ndarray, size: int = 64) -> np.ndarray:
    h, w = gray.shape[:2]
    s = size / max(h, w)
    small = cv2.resize(gray, (max(1, int(w * s)), max(1, int(h * s))),
                       interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size), 255, dtype=np.uint8)
    canvas[:small.shape[0], :small.shape[1]] = small
    return canvas


def cluster_duplicates(crops: dict[str, np.ndarray],
                       labels: dict[str, str]) -> dict[str, str]:
    """Conservative duplicate grouping: NCC >= 0.95 AND same normalized label.

    Returns {symbolId: groupId}. Groups named g001... in first-seen order.
    Reporting only — creates no classes.
    """
    from text_normalization import base_normalize  # local import: no cycle
    thumbs = {sid: _norm_thumb(g) for sid, g in crops.items()}
    norm = {sid: base_normalize(labels.get(sid, "")).normalized for sid in crops}
    group_of: dict[str, str] = {}
    groups: list[list[str]] = []
    for sid in crops:
        placed = False
        for gi, members in enumerate(groups):
            rep = members[0]
            if norm[sid] != norm.get(rep, None):
                continue
            res = cv2.matchTemplate(thumbs[sid], thumbs[rep], cv2.TM_CCOEFF_NORMED)
            if float(res.max()) >= DUPLICATE_NCC:
                members.append(sid)
                group_of[sid] = f"g{gi + 1:03d}"
                placed = True
                break
        if not placed:
            groups.append([sid])
            group_of[sid] = f"g{len(groups):03d}"
    return group_of


def draw_contact_sheet(items: list[dict], cols: int = 6,
                       cell: int = 220) -> np.ndarray:
    """Grid: crop | ref id + label + status + key scores. Debug artifact."""
    import math
    rows = max(1, math.ceil(len(items) / cols))
    sheet = np.full((rows * cell, cols * cell, 3), 255, dtype=np.uint8)
    colors = {"validated": (60, 140, 60), "review": (200, 150, 20),
              "rejected": (200, 60, 60)}
    for idx, it in enumerate(items):
        r, c = divmod(idx, cols)
        x0, y0 = c * cell, r * cell
        thumb = it.get("_thumb")
        if thumb is not None:
            th = cv2.resize(thumb, (cell - 8, 120), interpolation=cv2.INTER_AREA)
            if len(th.shape) == 2:
                th = cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)
            sheet[y0 + 4:y0 + 124, x0 + 4:x0 + cell - 4] = th
        color = colors.get(it.get("status", ""), (90, 90, 90))
        cv2.rectangle(sheet, (x0 + 2, y0 + 2), (x0 + cell - 3, y0 + cell - 3), color, 2)
        cv2.putText(sheet, str(it.get("ref", ""))[:26], (x0 + 6, y0 + 142),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(sheet, str(it.get("label", ""))[:26], (x0 + 6, y0 + 160),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
        cv2.putText(sheet, f"{it.get('status','')} ink={it.get('ink',0):.3f} "
                           f"brd={it.get('border',0):.2f} txt={it.get('text',0):.2f}",
                    (x0 + 6, y0 + 178), cv2.FONT_HERSHEY_SIMPLEX, 0.36, color, 1, cv2.LINE_AA)
        cv2.putText(sheet, f"grp={it.get('group','-')}", (x0 + 6, y0 + 196),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.36, (90, 90, 90), 1, cv2.LINE_AA)
    return sheet


def draw_page_overlay(page_bgr: np.ndarray, boxes: list[dict]) -> np.ndarray:
    """Overlay distinguishing REFERENCE (white), SYMBOL (green),
    TEXT (blue), ROW (yellow, when known). Debug artifact, not UI."""
    out = page_bgr.copy()
    colors = {"ROW": (0, 255, 255), "REFERENCE": (255, 255, 255),
              "SYMBOL": (60, 200, 60), "TEXT": (220, 120, 40)}
    for b in boxes:
        kind = str(b.get("kind", "REFERENCE")).upper()
        box = b.get("bbox", {})
        x, y = int(box.get("x", 0)), int(box.get("y", 0))
        w, h = int(box.get("width", 0)), int(box.get("height", 0))
        if w <= 0 or h <= 0:
            continue
        color = colors.get(kind, (200, 200, 200))
        cv2.rectangle(out, (x, y), (x + w, y + h), color, 2)
        cv2.putText(out, f"{kind} {b.get('ref','')}"[:28], (x + 3, max(12, y - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    return out
