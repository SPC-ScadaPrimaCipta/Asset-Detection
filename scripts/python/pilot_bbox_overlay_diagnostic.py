"""
Pilot diagnostic: overlay Gemini v3 bbox under three coordinate hypotheses
onto sheet-1-p1 image to determine which transform is visually consistent.

Hypotheses:
  A: bbox is already source-pixel (as claimed in discovery-result.json)
  B: bbox is normalized 0–1000, convert: x_px = x/1000*W, y_px = y/1000*H
  C: bbox is normalized 0–1000 with x/y axes swapped: x_px = y/1000*W, y_px = x/1000*H

Output: one PNG per hypothesis, written exclusively (skip if exists).
No API calls, no inference, no file modification of existing artefacts.
"""

import json
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ─── paths ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
IMAGE_PATH = REPO_ROOT / "fixtures" / "pid-eval" / "sheet-1" / "page_1.png"
DISCOVERY_PATH = REPO_ROOT / "fixtures" / "diagnostics" / "pilot-sheet-1-p1-v3" / "discovery-result.json"
OUT_DIR = REPO_ROOT / "fixtures" / "diagnostics" / "pilot-sheet-1-p1-v3" / "bbox-overlay-diagnostic"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ─── candidates selected for overlay (varied types, spread across image) ──────
# Chosen: V-001 (Vessel), V-002 (Vessel), T-012 (Tank), P-006 (Pump),
#         PCV-001 (Pressure Control Valve), PCV-002 (PCV),
#         PSV-001 (PSV), LCV-001 (Level Control Valve),
#         TI-001 (Temp Indicator), PI-001 (Pressure Indicator)
SELECTED_IDS = {
    "discovery-001-001",  # Vessel V-001
    "discovery-001-002",  # Vessel V-002
    "discovery-001-003",  # Tank T-012
    "discovery-001-004",  # Pump P-006
    "discovery-001-013",  # PSV-001
    "discovery-001-014",  # PSV-002
    "discovery-001-015",  # LCV-001
    "discovery-001-017",  # PCV-001
    "discovery-001-018",  # PCV-002
    "discovery-001-021",  # TI-001
    "discovery-001-022",  # PI-001
    "discovery-001-025",  # LIC-001
}

COLORS = {
    "Vessel": (255, 50, 50, 180),
    "Tank": (255, 150, 0, 180),
    "Positive Displacement Pump": (0, 200, 50, 180),
    "Pressure Safety Valve": (200, 0, 255, 180),
    "Level Control Valve": (0, 150, 255, 180),
    "Pressure Control Valve": (0, 200, 200, 180),
    "Temperature Indicator": (255, 200, 0, 180),
    "Pressure Indicator": (200, 200, 0, 180),
    "Level Controller": (100, 100, 255, 180),
    "_default": (180, 180, 180, 180),
}

def get_color(asset_type):
    return COLORS.get(asset_type, COLORS["_default"])

def draw_bbox(draw, x1, y1, x2, y2, label, color, scale=1.0):
    sx1, sy1, sx2, sy2 = x1*scale, y1*scale, x2*scale, y2*scale
    draw.rectangle([sx1, sy1, sx2, sy2], outline=color[:3], width=3)
    # draw label
    try:
        font = ImageFont.truetype("arial.ttf", max(12, int(14*scale)))
    except Exception:
        font = ImageFont.load_default()
    draw.text((sx1+2, sy1+2), label, fill=color[:3], font=font)

def transform_A(x, y, W, H):
    """Source-pixel as-is"""
    return x, y

def transform_B(x, y, W, H):
    """Normalized 0-1000 → source-pixel"""
    return x / 1000.0 * W, y / 1000.0 * H

def transform_C(x, y, W, H):
    """Normalized 0-1000, axes swapped: raw_x→Y, raw_y→X"""
    return y / 1000.0 * W, x / 1000.0 * H

HYPOTHESES = {
    "A_source_pixel": (transform_A, "Hypothesis A: bbox as source-pixel (claimed)"),
    "B_normalized_0_1000": (transform_B, "Hypothesis B: bbox normalized 0-1000 → source-pixel"),
    "C_normalized_swapped": (transform_C, "Hypothesis C: normalized 0-1000, x/y axes swapped"),
}

def main():
    print(f"Loading image: {IMAGE_PATH}")
    img = Image.open(IMAGE_PATH).convert("RGBA")
    W, H = img.size
    print(f"Image size: {W}x{H}")

    print(f"Loading discovery: {DISCOVERY_PATH}")
    with open(DISCOVERY_PATH) as f:
        discovery = json.load(f)

    candidates = discovery.get("candidates", [])
    selected = [c for c in candidates if c["candidateId"] in SELECTED_IDS]
    print(f"Selected candidates: {len(selected)} of {len(candidates)}")

    # Scale down for output (1/3 size for readability)
    SCALE = 0.333
    out_w, out_h = int(W * SCALE), int(H * SCALE)

    results = {}

    for hyp_key, (transform_fn, hyp_label) in HYPOTHESES.items():
        out_path = OUT_DIR / f"overlay_{hyp_key}.png"
        if out_path.exists():
            print(f"SKIP (exists): {out_path}")
            results[hyp_key] = {"status": "skipped_exists", "path": str(out_path)}
            continue

        base = img.copy().resize((out_w, out_h), Image.LANCZOS)
        overlay = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        bbox_info = []
        for c in selected:
            raw_bbox = c.get("sourcePixelBbox") or {}
            rx1 = raw_bbox.get("x1", 0)
            ry1 = raw_bbox.get("y1", 0)
            rx2 = raw_bbox.get("x2", 0)
            ry2 = raw_bbox.get("y2", 0)

            px1, py1 = transform_fn(rx1, ry1, W, H)
            px2, py2 = transform_fn(rx2, ry2, W, H)

            asset_type = c.get("assetType", "?")
            tag = c.get("assetTag") or "?"
            label = f"{tag}({asset_type[:6]})"
            color = get_color(asset_type)

            draw_bbox(draw, px1, py1, px2, py2, label, color, scale=SCALE)
            bbox_info.append({
                "candidateId": c["candidateId"],
                "assetType": asset_type,
                "tag": tag,
                "raw_bbox": {"x1": rx1, "y1": ry1, "x2": rx2, "y2": ry2},
                "transformed_px": {"x1": round(px1, 1), "y1": round(py1, 1), "x2": round(px2, 1), "y2": round(py2, 1)},
                "as_fraction_of_image": {
                    "x1_pct": round(px1/W*100, 1),
                    "y1_pct": round(py1/H*100, 1),
                    "x2_pct": round(px2/W*100, 1),
                    "y2_pct": round(py2/H*100, 1),
                }
            })

        composite = Image.alpha_composite(base.convert("RGBA"), overlay)
        composite = composite.convert("RGB")
        composite.save(str(out_path), "PNG")
        print(f"Written: {out_path}")
        results[hyp_key] = {
            "status": "written",
            "path": str(out_path),
            "hypothesis": hyp_label,
            "candidates_drawn": len(selected),
            "bbox_details": bbox_info,
        }

    # Write summary JSON
    summary_path = OUT_DIR / "overlay-diagnostic-summary.json"
    if not summary_path.exists():
        summary = {
            "schemaVersion": "pilot-overlay-diagnostic-v1",
            "pageId": "sheet-1-p1",
            "imageSha256": "e691c8a1101ee40d1056e9f37fd2bb4e2c222f35c314eabbb552e3f76d42892d",
            "imageDimensions": {"width": W, "height": H},
            "outputScale": SCALE,
            "hypotheses": {
                "A": "bbox used as source-pixel directly (as claimed in discovery)",
                "B": "bbox treated as normalized 0-1000, converted: x_px = x/1000*W, y_px = y/1000*H",
                "C": "bbox treated as normalized 0-1000 with axes swapped: x_px = y/1000*W, y_px = x/1000*H",
            },
            "selectedCandidates": list(SELECTED_IDS),
            "results": results,
            "disclaimer": (
                "This overlay does not modify discovery-result.json or comparison artefacts. "
                "It is a read-only diagnostic to determine which coordinate transform is visually consistent. "
                "No API calls or inference performed."
            ),
        }
        with open(summary_path, "w") as f:
            json.dump(summary, f, indent=2)
        print(f"Summary: {summary_path}")
    else:
        print(f"Summary exists: {summary_path}")

    # Print bbox positions for manual inspection
    print("\n=== BBOX POSITIONS PER HYPOTHESIS ===")
    for hyp_key, (transform_fn, hyp_label) in HYPOTHESES.items():
        print(f"\n--- {hyp_label} ---")
        for c in selected:
            raw_bbox = c.get("sourcePixelBbox") or {}
            rx1, ry1, rx2, ry2 = raw_bbox.get("x1",0), raw_bbox.get("y1",0), raw_bbox.get("x2",0), raw_bbox.get("y2",0)
            px1, py1 = transform_fn(rx1, ry1, W, H)
            px2, py2 = transform_fn(rx2, ry2, W, H)
            tag = c.get("assetTag") or "?"
            atype = c.get("assetType","?")
            print(f"  {c['candidateId']} {tag:8s} {atype:30s}: px ({px1:.0f},{py1:.0f})-({px2:.0f},{py2:.0f}) | {px1/W*100:.1f}%-{px2/W*100:.1f}% x, {py1/H*100:.1f}%-{py2/H*100:.1f}% y")

if __name__ == "__main__":
    main()
