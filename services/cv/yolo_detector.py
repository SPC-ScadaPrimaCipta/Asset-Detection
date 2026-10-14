"""
YOLOv8 ONNX inference module — no PyTorch / Ultralytics dependency.

Environment variables
---------------------
CV_YOLO_MODEL_PATH   Path to the .onnx model file.
                     Default: ./models/yolo-pid.onnx  (relative to this file)
CV_YOLO_INPUT_SIZE   Square input resolution sent to the model.  Default: 640
CV_YOLO_NMS_IOU     IoU threshold for NMS.  Default: 0.45

Model expectations
------------------
The module assumes a standard YOLOv8 export layout:
  - Input  : NCHW float32  (1, 3, 640, 640)  values in [0, 1]
  - Output : (1, num_classes+4, num_anchors) — the transposed detection head
             produced by ``model.export(format='onnx')`` with opset ≥ 12.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Class-name discovery
# ---------------------------------------------------------------------------

_DEFAULT_CLASS_NAMES: List[str] = [
    "instrument",
    "valve",
    "pump",
    "vessel",
    "heat_exchanger",
    "compressor",
    "filter",
    "tank",
    "motor",
    "fan",
    "psv",
    "control_valve",
    "reducer",
    "nozzle",
    "pipe",
    "tee",
    "elbow",
    "flange",
    "symbol",
    "tag",
]


def _load_class_names(model_path: str) -> List[str]:
    """
    Try to load class names from a ``data.yaml`` co-located with the model.
    Falls back to ``_DEFAULT_CLASS_NAMES`` if not found or unparseable.
    """
    try:
        import yaml  # PyYAML — optional

        candidates = [
            Path(model_path).parent / "data.yaml",
            Path(model_path).parent / "classes.yaml",
            Path(model_path).with_suffix(".yaml"),
        ]
        for p in candidates:
            if p.is_file():
                with open(p, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                names = data.get("names")
                if isinstance(names, list) and names:
                    logger.info("Loaded %d class names from %s", len(names), p)
                    return [str(n) for n in names]
                if isinstance(names, dict):
                    # {0: 'cat', 1: 'dog', ...}
                    return [str(names[k]) for k in sorted(names)]
    except Exception as exc:  # noqa: BLE001
        logger.debug("data.yaml not loaded: %s", exc)

    logger.debug("Using default class names (%d classes)", len(_DEFAULT_CLASS_NAMES))
    return list(_DEFAULT_CLASS_NAMES)


# ---------------------------------------------------------------------------
# Model singleton
# ---------------------------------------------------------------------------

_session = None
_class_names: List[str] = []
_input_size: int = 640
_model_path: str = ""


def _get_session():
    """Lazy-load the ONNX Runtime session (called once per process)."""
    global _session, _class_names, _input_size, _model_path

    if _session is not None:
        return _session

    import onnxruntime as ort

    _input_size = int(os.environ.get("CV_YOLO_INPUT_SIZE", "640"))

    # Resolve model path
    env_path = os.environ.get("CV_YOLO_MODEL_PATH", "")
    if env_path and Path(env_path).is_file():
        _model_path = env_path
    else:
        # default: ./models/yolo-pid.onnx  relative to this file
        default = Path(__file__).parent / "models" / "yolo-pid.onnx"
        # also check project-root fallback
        root_fallback = Path(__file__).parents[2] / "model" / "yolo-pid-v8n-203.onnx"
        if default.is_file():
            _model_path = str(default)
        elif root_fallback.is_file():
            _model_path = str(root_fallback)
            logger.warning(
                "Using root fallback model at %s (14 MB lightweight variant)",
                root_fallback,
            )
        else:
            raise FileNotFoundError(
                f"YOLO model not found. Checked:\n  {default}\n  {root_fallback}\n"
                "Set CV_YOLO_MODEL_PATH env var to the correct path."
            )

    logger.info("Loading YOLO model from %s", _model_path)
    providers = ort.get_available_providers()
    # Prefer CUDA if available, then CPU
    ordered = []
    if "CUDAExecutionProvider" in providers:
        ordered.append("CUDAExecutionProvider")
    ordered.append("CPUExecutionProvider")

    opts = ort.SessionOptions()
    opts.log_severity_level = 3  # suppress verbose ORT logs
    _session = ort.InferenceSession(_model_path, sess_options=opts, providers=ordered)
    _class_names = _load_class_names(_model_path)
    logger.info(
        "YOLO session ready — input_size=%d, classes=%d, providers=%s",
        _input_size,
        len(_class_names),
        _session.get_providers(),
    )
    return _session


# ---------------------------------------------------------------------------
# Pre / post processing
# ---------------------------------------------------------------------------

def _preprocess(img_bgr, input_size: int = 640):
    """
    Resize image with letterboxing to *input_size* × *input_size*, convert to
    NCHW float32 in [0, 1].

    Returns
    -------
    blob : np.ndarray  shape (1, 3, input_size, input_size)
    scale : float      resize scale (for bbox recovery)
    pad_x : int        horizontal padding applied (pixels)
    pad_y : int        vertical padding applied (pixels)
    """
    import cv2
    import numpy as np

    h, w = img_bgr.shape[:2]
    scale = min(input_size / w, input_size / h)
    new_w, new_h = int(w * scale), int(h * scale)

    resized = cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    pad_y = (input_size - new_h) // 2
    pad_x = (input_size - new_w) // 2

    canvas = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized

    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    blob = rgb.astype(np.float32) / 255.0
    blob = np.transpose(blob, (2, 0, 1))[np.newaxis]  # NCHW
    return blob, scale, pad_x, pad_y


def _nms(boxes, scores, iou_threshold: float = 0.45):
    """
    Vectorised greedy NMS.  Returns indices of kept boxes.

    Parameters
    ----------
    boxes  : np.ndarray  (N, 4)  x1, y1, x2, y2
    scores : np.ndarray  (N,)
    """
    import numpy as np

    if len(boxes) == 0:
        return []

    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][iou <= iou_threshold]

    return keep


def _postprocess(
    output,
    *,
    orig_w: int,
    orig_h: int,
    scale: float,
    pad_x: int,
    pad_y: int,
    conf_threshold: float,
    iou_threshold: float,
    input_size: int,
    class_names: List[str],
):
    """
    Decode YOLOv8 ONNX output into a list of Detection dicts.

    YOLOv8 export layout (transposed): output shape (1, 4+num_cls, num_anchors)
    — each anchor column is [cx, cy, w, h, cls0_conf, cls1_conf, ...].
    """
    import numpy as np
    from .schemas import BBox, Detection

    raw = output[0]  # (1, 4+num_cls, num_anchors)
    preds = raw[0].T  # (num_anchors, 4+num_cls)

    num_cls = len(class_names)

    cx   = preds[:, 0]
    cy   = preds[:, 1]
    bw   = preds[:, 2]
    bh   = preds[:, 3]
    cls_scores = preds[:, 4 : 4 + num_cls]

    class_ids = cls_scores.argmax(axis=1)
    scores    = cls_scores.max(axis=1)

    mask = scores >= conf_threshold
    if not mask.any():
        return []

    cx, cy, bw, bh = cx[mask], cy[mask], bw[mask], bh[mask]
    class_ids, scores = class_ids[mask], scores[mask]

    # Convert centre-xywh (model space) → x1y1x2y2 (model space)
    x1_m = cx - bw / 2
    y1_m = cy - bh / 2
    x2_m = cx + bw / 2
    y2_m = cy + bh / 2

    # Remove letterbox padding and undo scale → original image space
    x1_o = np.clip((x1_m - pad_x) / scale, 0, orig_w)
    y1_o = np.clip((y1_m - pad_y) / scale, 0, orig_h)
    x2_o = np.clip((x2_m - pad_x) / scale, 0, orig_w)
    y2_o = np.clip((y2_m - pad_y) / scale, 0, orig_h)

    boxes = np.stack([x1_o, y1_o, x2_o, y2_o], axis=1)
    keep  = _nms(boxes, scores, iou_threshold)

    detections: List[Detection] = []
    for idx in keep:
        cid  = int(class_ids[idx])
        lbl  = class_names[cid] if cid < len(class_names) else f"class_{cid}"
        x1, y1, x2, y2 = float(boxes[idx, 0]), float(boxes[idx, 1]), float(boxes[idx, 2]), float(boxes[idx, 3])
        detections.append(
            Detection(
                class_id=cid,
                label=lbl,
                score=float(scores[idx]),
                bbox=BBox(x=x1, y=y1, width=x2 - x1, height=y2 - y1),
            )
        )

    return detections


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_detection(
    img_bgr,
    *,
    confidence_threshold: float = 0.3,
    page_width: Optional[int] = None,
    page_height: Optional[int] = None,
) -> List:
    """
    Run YOLO inference on *img_bgr* (BGR uint8 ndarray).

    Parameters
    ----------
    img_bgr :
        Full-resolution page image in BGR colour space.
    confidence_threshold :
        Minimum object confidence to keep.
    page_width / page_height :
        Declared page size (unused for inference, kept for API consistency).

    Returns
    -------
    List[Detection]
    """
    import numpy as np

    iou_threshold = float(os.environ.get("CV_YOLO_NMS_IOU", "0.45"))
    session = _get_session()
    input_size = _input_size

    orig_h, orig_w = img_bgr.shape[:2]
    blob, scale, pad_x, pad_y = _preprocess(img_bgr, input_size)

    input_name  = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    raw_output  = session.run([output_name], {input_name: blob})

    return _postprocess(
        raw_output,
        orig_w=page_width or orig_w,
        orig_h=page_height or orig_h,
        scale=scale,
        pad_x=pad_x,
        pad_y=pad_y,
        conf_threshold=confidence_threshold,
        iou_threshold=iou_threshold,
        input_size=input_size,
        class_names=_class_names,
    )


def is_model_loaded() -> bool:
    """Return ``True`` if the ONNX session has been initialised."""
    return _session is not None


def try_load() -> bool:
    """Attempt to load the model.  Returns ``True`` on success."""
    try:
        _get_session()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("YOLO model load failed: %s", exc)
        return False
