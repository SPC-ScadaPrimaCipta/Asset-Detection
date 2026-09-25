"""
Detection V2 — accuracy evaluation harness (Phase 8, measurement only).

Reads pipeline predictions + human GT, produces metrics. NEVER modifies
production thresholds or pipeline code. Reproducible: every report records
dataset version, pipeline version, matcher settings, timestamp.
"""
from __future__ import annotations

import unicodedata
from dataclasses import asdict, dataclass, field


def iou(a: dict, b: dict) -> float:
    ix0, iy0 = max(a["x"], b["x"]), max(a["y"], b["y"])
    ix1 = min(a["x"] + a["width"], b["x"] + b["width"])
    iy1 = min(a["y"] + a["height"], b["y"] + b["height"])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    if inter <= 0:
        return 0.0
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / union if union > 0 else 0.0


def norm_label(s: str | None) -> str:
    t = unicodedata.normalize("NFKC", s or "").strip().upper()
    return " ".join(t.split())


def labels_equal(pred: str | None, gt: str | None) -> bool:
    return bool(pred) and norm_label(pred) == norm_label(gt)


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if not la:
        return lb
    if not lb:
        return la
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        for j in range(1, lb + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1,
                         prev[j - 1] + (a[i - 1] != b[i - 1]))
        prev = cur
    return prev[lb]


@dataclass
class MatchResult:
    tp: list = field(default_factory=list)   # (pred, gt, iou)
    fp: list = field(default_factory=list)   # pred (no GT)
    fn: list = field(default_factory=list)   # gt positives unmatched
    duplicate: list = field(default_factory=list)  # extra preds on matched GT


def match_predictions(preds: list, gt_positives: list,
                      iou_thr: float = 0.5) -> MatchResult:
    """Greedy by confidence: each pred claims best unmatched GT (label must match)."""
    res = MatchResult()
    claimed: set[str] = set()
    for p in sorted(preds, key=lambda x: x.get("confidence", 0), reverse=True):
        best, best_iou = None, 0.0
        for g in gt_positives:
            if g["id"] in claimed:
                continue
            if not labels_equal(p.get("label"), g.get("symbolLabel")):
                continue
            v = iou(p["bbox"], g["bbox"])
            if v > best_iou:
                best, best_iou = g, v
        if best is not None and best_iou >= iou_thr:
            if best["id"] in claimed:
                res.duplicate.append((p, best, best_iou))
            else:
                claimed.add(best["id"])
                res.tp.append((p, best, best_iou))
        else:
            # Second chance: right place, wrong label → still FP here, but
            # taxonomy (below) records WRONG_SYMBOL_CLASS instead of plain FP.
            res.fp.append(p)
    res.fn = [g for g in gt_positives if g["id"] not in claimed]
    return res


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "tp": tp, "fp": fp, "fn": fn}


# ── Error taxonomy ────────────────────────────────────────────────────────────
# Deterministic rules per unmatched/wrong item (not vibes).

def classify_fp(pred: dict, gt_positives: list, negatives: list) -> str:
    for g in gt_positives:
        v = iou(pred["bbox"], g["bbox"])
        if v >= 0.5 and not labels_equal(pred.get("label"), g.get("symbolLabel")):
            return "WRONG_SYMBOL_CLASS"
        if 0.1 <= v < 0.5 and labels_equal(pred.get("label"), g.get("symbolLabel")):
            return "BAD_BBOX"
    for n in negatives:
        if iou(pred["bbox"], n["bbox"]) >= 0.3:
            return {"pipe-spec": "FALSE_POSITIVE_PIPE_SPEC",
                    "title-text": "FALSE_POSITIVE_TITLE_TEXT",
                    "marker": "FALSE_POSITIVE_MARKER"}.get(n.get("kind", ""), "FALSE_POSITIVE_KNOWN_NEGATIVE")
    if (pred.get("bbox", {}).get("width", 0) * pred.get("bbox", {}).get("height", 0)) < 900:
        return "SMALL_SYMBOL_FP"
    return "FALSE_POSITIVE"


def classify_fn(gt: dict, preds: list) -> str:
    for p in preds:
        v = iou(p["bbox"], gt["bbox"])
        if v >= 0.5:
            return "WRONG_SYMBOL_CLASS"  # close but labeled otherwise (or dup)
        if v >= 0.1:
            return "BAD_BBOX"
    area = gt["bbox"]["width"] * gt["bbox"]["height"]
    if area < 900:
        return "SMALL_SYMBOL"
    return "FALSE_NEGATIVE"


@dataclass
class EvalReport:
    dataset: str = ""
    datasetVersion: str = ""
    pipelineVersion: str = ""
    iouThreshold: float = 0.5
    detection: dict = field(default_factory=dict)
    iou: dict = field(default_factory=dict)
    perClass: dict = field(default_factory=dict)
    confusion: dict = field(default_factory=dict)  # gt -> {pred: n}
    ocr: dict = field(default_factory=dict)
    association: dict = field(default_factory=dict)
    taxonomy: dict = field(default_factory=dict)
    conditions: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate(preds: list, gt_page: dict, iou_thr: float = 0.5,
             pipeline_version: str = "") -> EvalReport:
    positives = [a for a in gt_page.get("assets", []) if a.get("status") == "positive"]
    negatives = gt_page.get("negatives", [])
    m = match_predictions(preds, positives, iou_thr)

    rep = EvalReport(
        dataset=str(gt_page.get("source", "")),
        datasetVersion=str(gt_page.get("version", "")),
        pipelineVersion=pipeline_version,
        iouThreshold=iou_thr,
        conditions=dict(gt_page.get("conditions", {})),
    )
    rep.detection = prf(len(m.tp), len(m.fp), len(m.fn))

    # IoU @thr and @0.75 + mean over TPs.
    ious = [v for _, _, v in m.tp]
    m75 = match_predictions(preds, positives, 0.75)
    rep.iou = {
        f"meanIoU@{iou_thr}": round(sum(ious) / len(ious), 4) if ious else 0.0,
        "meanIoU@0.75": round(sum(v for _, _, v in m75.tp) / len(m75.tp), 4) if m75.tp else 0.0,
        "tpCount": len(m.tp),
    }

    # Per-class + confusion (GT rows, pred columns, UNMATCHED for FN).
    classes = sorted({norm_label(g["symbolLabel"]) for g in positives})
    per, conf = {}, {}
    for c in classes:
        g_c = [g for g in positives if norm_label(g["symbolLabel"]) == c]
        tp_c = [t for t in m.tp if norm_label(t[1]["symbolLabel"]) == c]
        fp_c = [p for p in m.fp if norm_label(p.get("label")) == c]
        fn_c = [g for g in m.fn if norm_label(g["symbolLabel"]) == c]
        per[c] = prf(len(tp_c), len(fp_c), len(fn_c))
        row: dict[str, int] = {}
        for _, g, _ in tp_c:
            row[norm_label(g["symbolLabel"])] = row.get(norm_label(g["symbolLabel"]), 0) + 1
        for p in m.fp:
            # FP predicted as c but matched no GT of class c — record top confusion.
            if norm_label(p.get("label")) == c:
                row["FALSE_ALARM"] = row.get("FALSE_ALARM", 0) + 1
        if fn_c:
            row["UNMATCHED"] = len(fn_c)
        conf[c] = row
    rep.perClass, rep.confusion = per, conf

    # OCR: exact / normalized / char accuracy / false tag rate.
    exact: list = []
    norm_match: list = []
    ch_acc: list = []
    for p, g, _ in m.tp:
        pt, gt = (p.get("tag") or ""), (g.get("tag") or "")
        if not gt:
            continue  # tagless GT asset — correctly detected without tag
        exact.append(1 if pt == gt else 0)
        norm_match.append(1 if norm_label(pt).replace(" ", "") == norm_label(gt).replace(" ", "") else 0)
        denom = max(1, len(gt))
        ch_acc.append(max(0.0, 1.0 - levenshtein(pt, gt) / denom))
    fp_tags = sum(1 for p in m.fp if p.get("tag"))
    rep.ocr = {
        "tagExactMatch": round(sum(exact) / len(exact), 4) if exact else 0.0,
        "tagNormalizedMatch": round(sum(norm_match) / len(norm_match), 4) if norm_match else 0.0,
        "charAccuracy": round(sum(ch_acc) / len(ch_acc), 4) if ch_acc else 0.0,
        "falseTagRate": round(fp_tags / max(1, len(m.fp)), 4),
        "n": len(exact),
    }

    # Association: TPs with GT tags — pred tag must equal GT tag.
    assoc_ok = assoc_wrong = assoc_none = 0
    for p, g, _ in m.tp:
        if not g.get("tag"):
            continue
        if not p.get("tag"):
            assoc_none += 1
        elif p["tag"] == g["tag"]:
            assoc_ok += 1
        else:
            assoc_wrong += 1
    tot = assoc_ok + assoc_wrong + assoc_none
    rep.association = {"correct": assoc_ok, "wrong": assoc_wrong,
                       "unassociated": assoc_none,
                       "accuracy": round(assoc_ok / tot, 4) if tot else 0.0}

    # Taxonomy counts.
    tax: dict[str, int] = {}
    for p in m.fp:
        k = classify_fp(p, positives, negatives)
        tax[k] = tax.get(k, 0) + 1
    for g in m.fn:
        k = classify_fn(g, preds)
        tax[k] = tax.get(k, 0) + 1
    for _, _, _ in m.duplicate:
        tax["DUPLICATE"] = tax.get("DUPLICATE", 0) + 1
    rep.taxonomy = dict(sorted(tax.items(), key=lambda kv: -kv[1]))
    return rep


def gemini_delta(det_matched: MatchResult, plus_matched: MatchResult,
                gt_positives: list) -> dict:
    """Per-GT comparison: corrected / harmed / unchanged / uncertain."""
    def status(gid: str) -> str:
        d = any(g["id"] == gid for _, g, _ in det_matched.tp)
        return "ok" if d else "miss"

    # verdicts need transport from caller; here compare TP sets + label changes.
    out = {"corrected": 0, "harmed": 0, "unchanged": 0, "uncertain": 0, "detail": []}
    det_ok = {g["id"] for _, g, _ in det_matched.tp}
    plus_ok = {g["id"] for _, g, _ in plus_matched.tp}
    for g in gt_positives:
        d, p = g["id"] in det_ok, g["id"] in plus_ok
        if not d and p:
            k = "corrected"
        elif d and not p:
            k = "harmed"
        else:
            k = "unchanged"
        out[k] += 1
        out["detail"].append({"gt": g["id"], "det": d, "plus": p, "class": k})
    return out
