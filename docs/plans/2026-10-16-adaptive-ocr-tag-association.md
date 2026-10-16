# Adaptive Tag OCR & Fallback Template Matching Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Menghilangkan kegagalan deteksi tag akibat crop yang terlalu sempit dengan memperluas ROI OCR secara adaptif serta menghubungkan fallback Template Matching pada pipeline hybrid V3.

**Architecture:** Memisahkan crop ketat (simbol untuk hash/cache) dengan crop kontekstual adaptif di sekitar simbol untuk OCR. Menghubungkan fallback Template Matching jika YOLO tidak mendeteksi simbol sebelum jatuh ke Gemini.

**Tech Stack:** TypeScript, Node.js, Sharp, Tesseract.js, BullMQ, Jest.

---

### Task 1: Adaptive Tag ROI Cropping Helper

**Files:**
- Modify: `lib/ocr-engine.ts`
- Test: `__tests__/adaptive-ocr-crop.test.ts`

**Step 1: Write the failing test**
Create `__tests__/adaptive-ocr-crop.test.ts` testing `cropAdaptiveTagRegionFromBuffer` and spatial bounds calculation.

**Step 2: Run test to verify it fails**
Run: `npm test -- __tests__/adaptive-ocr-crop.test.ts`
Expected: FAIL (function not found or not exported)

**Step 3: Write minimal implementation in `lib/ocr-engine.ts`**
Add `cropAdaptiveTagRegionFromBuffer` that calculates expanded bounding boxes based on symbol type and dimensions, clamps to page bounds, and extracts with Sharp.

**Step 4: Run test to verify it passes**
Run: `npm test -- __tests__/adaptive-ocr-crop.test.ts`
Expected: PASS

---

### Task 2: Multi-zone Tag OCR & Token Association in Hybrid Pipeline

**Files:**
- Modify: `lib/detection/hybrid-pipeline.ts:108-165`
- Test: `__tests__/adaptive-ocr-crop.test.ts`

**Step 1: Write test case for token association**
Add test case to verify that when OCR returns multi-line text (e.g. tag + line description), `normalizeTagText` and tag pattern matching accurately extracts the asset tag.

**Step 2: Run test to verify it fails**
Run: `npm test -- __tests__/adaptive-ocr-crop.test.ts`

**Step 3: Update `runYoloWithOcr` in `lib/detection/hybrid-pipeline.ts`**
Use `cropBBoxFromBuffer` (8px) for `imageHash`, and use `cropAdaptiveTagRegionFromBuffer` for tag OCR. Extract tag candidate tokens and assign to `ocrText` and `isTag`.

**Step 4: Run test to verify it passes**
Run: `npm test -- __tests__/adaptive-ocr-crop.test.ts`
Expected: PASS

---

### Task 3: Template Matching Fallback Integration

**Files:**
- Modify: `lib/cv-client.ts`
- Modify: `lib/detection/hybrid-pipeline.ts`
- Test: `__tests__/hybrid-template-fallback.test.ts`

**Step 1: Write test for Template Matching fallback call**
Create `__tests__/hybrid-template-fallback.test.ts` to assert that when YOLO detects 0 symbols and `TEMPLATE_MATCH_ENABLED=true`, template matching is evaluated for legend symbols.

**Step 2: Run test to verify it fails**
Run: `npm test -- __tests__/hybrid-template-fallback.test.ts`
Expected: FAIL

**Step 3: Implement Template Match fallback in `hybrid-pipeline.ts`**
Wire `cvTemplateMatch` call into the candidate generation stage when YOLO candidates are empty or low confidence.

**Step 4: Run test to verify it passes**
Run: `npm test -- __tests__/hybrid-template-fallback.test.ts`
Expected: PASS

---

### Task 4: Full Test Suite Regression

**Files:**
- Verify: `__tests__/yolo-geo2-minimal-suite.test.ts`
- Verify: `__tests__/detection-accuracy.test.ts`

**Step 1: Run comprehensive tests**
Run: `npm test -- --testPathPattern="yolo|hybrid|ocr|adaptive"`
Expected: All tests PASS
