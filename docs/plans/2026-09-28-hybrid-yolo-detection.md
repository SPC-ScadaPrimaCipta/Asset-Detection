# Hybrid YOLO Detection Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Add YOLO as primary symbol candidate detector fused with deterministic CV + Legend/OCR semantic resolution + Gemini fallback.

**Architecture:** New `POST /yolo/detect` sidecar endpoint feeds tile-local boxes into `deterministic-page.ts` fusion (merge IoU>0.5, refine, dedup), then existing association → Legend match → confidence → persist flow stays authoritative for tag/type decisions.

**Tech Stack:** Ultralytics/ONNX Runtime (Colab training, CPU ONNX infer), FastAPI sidecar, Next.js/TS + Zod, Jest + pytest, pgvector untouched.

---

### Task 1: License note + local eval dirs (no dataset in git)

**Files:**
- Create: `docs/YOLO_PID_SYMBOLS_LICENSE.md`
- Modify: `.gitignore`
- Test: n/a (manual `git status` clean of data)

**Step 1: Add ignore entries**

```
# YOLO external data (Kaggle p-id-symbols, not ours — local only)
eval/yolo-pid-symbols/
*.pt
*.onnx
```

**Step 2: Write license note**

```md
# Source: https://www.kaggle.com/datasets/hristohristov21/pid-symbols + YOLOv5 article.
# Local-only for benchmark. Do not redistribute. `best.pt` via `git lfs pull` in dataset repo.
```

**Step 3: Verify**

Run: `git status --short`
Expected: only `docs/YOLO_PID_SYMBOLS_LICENSE.md` + `.gitignore` modified, no `*.pt/*.onnx/images.zip`.

**Step 4: Commit**

```bash
git add docs/YOLO_PID_SYMBOLS_LICENSE.md .gitignore
git commit -m "docs: yolo dataset license + local-only data ignores"
```

### Task 2: Class map (33 YOLO classes → asset_type)

**Files:**
- Create: `eval/yolo-class-map.json`
- Test: `__tests__/yolo-class-map.test.ts`

**Step 1: Write the failing test**

```ts
import map from '@/eval/yolo-class-map.json';
test('control valve maps', () => {
  expect((map as any)['14']).toBe('Control Valve');
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/yolo-class-map.test.ts`
Expected: FAIL (file missing).

**Step 3: Write minimal map**

```json
{ "0": null, "1": "Valve", "2": "Valve", "14": "Control Valve", "22": "Safety Device", "26": "Instrument", "27": "Instrument", "28": "Instrument", "29": "Instrument" }
```

(Full 0–32 entries; `box/Flow_Arrow/Reducer/Flange` → `null` = pendukung, bukan aset.)

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/yolo-class-map.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add eval/yolo-class-map.json __tests__/yolo-class-map.test.ts
git commit -m "feat: yolo class to asset-type map"
```

### Task 3: Colab training (manual, outside repo)

**Files:** none in repo (Colab notebook only).

**Step 1:** `git lfs pull` best.pt in dataset repo; clean dup labels (`Instrument_Field/Panel/box`).
**Step 2:** Train/fine-tune (YOLOv8 recommended over v5 for ONNX export).
**Step 3:** Export `yolo-pid.onnx` + keep `best.pt`; copy both to local `eval/yolo-pid-symbols/` (gitignored).
**Step 4:** Record mAP + conf sweep in `eval/yolo-pid-symbols/NOTES.md` (local only).

### Task 4: Sidecar `POST /yolo/detect` (TDD, pytest)

**Files:**
- Create: `services/cv/yolo_detector.py`
- Modify: `services/cv/app.py`, `services/cv/requirements.txt`
- Test: `services/cv/tests/test_yolo.py`

**Step 1: Write the failing test**

```python
def test_yolo_contract_shape():
    from yolo_detector import to_wire
    out = to_wire([{"x":1,"y":2,"width":10,"height":10,"classId":14,"confidence":0.9}])
    assert out[0]["bbox"]["x"] == 1 and out[0]["classId"] == 14
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest services/cv/tests/test_yolo.py -v`
Expected: FAIL (`yolo_detector` missing).

**Step 3: Write minimal implementation**

```python
def to_wire(dets):
    return [{"bbox": {k: int(d[k]) for k in ("x","y","width","height")},
             "classId": int(d["classId"]), "confidence": float(d["confidence"])} for d in dets]
```

Then lazy-load ONNX model + FastAPI route returning tile-local boxes + `pipelineVersion`, 503 when model absent.

**Step 4: Run test to verify it passes**

Run: `python -m pytest services/cv/tests/test_yolo.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add services/cv/yolo_detector.py services/cv/app.py services/cv/requirements.txt services/cv/tests/test_yolo.py
git commit -m "feat: yolo detect sidecar endpoint"
```

### Task 5: TS client + Zod schema (TDD, Jest)

**Files:**
- Create: `lib/detection/candidates/yolo-schema.ts`
- Modify: `lib/detection/cv-client.ts`
- Test: `__tests__/yolo-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { YoloDetections } from '@/lib/detection/candidates/yolo-schema';
test('rejects bad bbox', () => {
  expect(() => YoloDetections.parse([{ bbox: { x: 0, y: 0, width: 0, height: 5 }, classId: 1, confidence: 0.5 }])).toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/yolo-schema.test.ts`
Expected: FAIL.

**Step 3: Write minimal schema + `cvYoloDetect()` client**

Zod: bbox ints, `width/height >= 2`, `confidence 0..1`; client honors `YOLO_ENABLED=false` → returns `[]`.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/yolo-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/detection/candidates/yolo-schema.ts lib/detection/cv-client.ts __tests__/yolo-schema.test.ts
git commit -m "feat: yolo client and schema"
```

### Task 6: Fusion in deterministic-page.ts (TDD, Jest)

**Files:**
- Modify: `lib/detection/pipeline/deterministic-page.ts`
- Test: `__tests__/yolo-fusion.test.ts`

**Step 1: Write the failing test**

```ts
test('merges overlapping yolo+contour, keeps yolo bbox', () => {
  const out = fuseVisualCandidates({ yolo: [{ bbox: { x: 10, y: 10, width: 40, height: 40 }, classId: 14, confidence: 0.9 }], contour: [{ bbox: { x: 12, y: 12, width: 38, height: 38 } }] }, 0.5);
  expect(out).toHaveLength(1);
  expect(out[0].evidence.join(' ')).toMatch(/yolo/i);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/yolo-fusion.test.ts`
Expected: FAIL (`fuseVisualCandidates` missing).

**Step 3: Write minimal fusion**

IoU>0.5 → merge (YOLO bbox wins + evidence `yolo:{class} {conf}`); else keep both; count `stageCounts.yolo*`.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/yolo-fusion.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/detection/pipeline/deterministic-page.ts __tests__/yolo-fusion.test.ts
git commit -m "feat: fuse yolo and contour candidates"
```

### Task 7: Confidence weight + provenance (TDD, Jest)

**Files:**
- Modify: `lib/detection/scoring/confidence-model.ts`
- Test: `__tests__/yolo-confidence.test.ts`

**Step 1–4:** Failing test asserts `confidence_breakdown.yolo` present when YOLO evidence exists and `detection_source` stays non-final (`DETERMINISTIC` + provenance); implement `w_yolo=0.25` default; run `npx jest __tests__/yolo-confidence.test.ts` (FAIL→PASS).

**Step 5: Commit**

```bash
git add lib/detection/scoring/confidence-model.ts __tests__/yolo-confidence.test.ts
git commit -m "feat: yolo confidence weight and provenance"
```

### Task 8: OCR tagBBox split (TDD, Jest + pytest)

**Files:**
- Modify: `services/cv/ocr_runner.py`, `lib/ocr-candidate.ts`
- Test: `__tests__/ocr-tagbbox.test.ts`

**Step 1–4:** Test asserts OCR returns separate `tagBBox` and normalizer applies Legend patterns + `O↔0` correction with provenance; no fabricated tags (`null + NEEDS_REVIEW`).

**Step 5: Commit**

```bash
git add services/cv/ocr_runner.py lib/ocr-candidate.ts __tests__/ocr-tagbbox.test.ts
git commit -m "feat: separate tag bbox and legend-pattern normalization"
```

### Task 9: Benchmark + rollout flags

**Files:**
- Modify: `lib/detection/config.ts`, `.env.example`
- Test: manual A/B `YOLO_ENABLED on/off` on 5–10 internal pages.

**Steps:** add `YOLO_ENABLED=false`, `YOLO_CONF=0.35`, `YOLO_IOU=0.5`, `MAX_GEMINI_CALLS_PER_PAGE` raise (akurat-maksimal); record Precision/Recall/IoU@0.5/Tag+Association accuracy; gate rollout on recall gain without tag regression.

**Commit:**

```bash
git add lib/detection/config.ts .env.example
git commit -m "feat: yolo rollout flags"
```

---

Plan complete and saved to `docs/plans/2026-09-28-hybrid-yolo-detection.md`.
Next step: run `.agents/workflows/execute-plan.md` to execute this plan task-by-task in single-flow mode.
