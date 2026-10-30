# Multi-Provider Vision AI (OpenAI & Anthropic Claude) Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Menambahkan penyedia Vision AI OpenAI (GPT-4o, GPT-4o-mini, o1) dan Anthropic (Claude 3.7 / 3.5 Sonnet & Haiku) sebagai opsi otak AI utama setara dengan Google Gemini untuk Scan Legenda, Deteksi P&ID, dan Validasi Aturan.

**Architecture:** Menerapkan *Unified Multi-Provider Vision Adapter Pattern* (`lib/ai-providers/`) dengan interface umum `IVisionProvider`, adapter untuk Gemini, OpenAI, dan Claude, serta integrasi live model scanning dan pemilihan provider di menu Settings.

**Tech Stack:** TypeScript, Next.js 16, PostgreSQL, `@google/generative-ai`, `openai`, `@anthropic-ai/sdk`, Jest.

---

### Task 1: Database Migration & Multi-Provider AI Configuration
**Files:**
- Create: `sql/migrate-multi-provider.sql`
- Modify: `lib/ai-config.ts`
- Modify: `lib/env.ts`
- Test: `__tests__/ai-config-multi-provider.test.ts`

**Step 1:** Buat file migrasi SQL `sql/migrate-multi-provider.sql` untuk menambahkan kolom `openai_api_key`, `openai_model`, `anthropic_api_key`, dan `anthropic_model` pada tabel `settings`.
**Step 2:** Perbarui `lib/ai-config.ts` untuk mendukung `AIProvider = 'gemini' | 'openai' | 'anthropic' | 'deepseek'`.
**Step 3:** Perbarui `lib/env.ts` untuk memuat variabel `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.
**Step 4:** Tulis unit test `__tests__/ai-config-multi-provider.test.ts` dan verifikasi lulus.

---

### Task 2: Install Anthropic SDK & Build Unified Vision Provider Adapters
**Files:**
- Create: `lib/ai-providers/types.ts`
- Create: `lib/ai-providers/gemini-adapter.ts`
- Create: `lib/ai-providers/openai-adapter.ts`
- Create: `lib/ai-providers/claude-adapter.ts`
- Create: `lib/ai-providers/index.ts`
- Test: `__tests__/ai-vision-adapters.test.ts`

**Step 1:** Install `@anthropic-ai/sdk` via `npm install @anthropic-ai/sdk`.
**Step 2:** Definisikan kontrak antarmuka `IVisionProvider`, `VisionCompletionOptions`, dan `VisionCompletionResult` di `lib/ai-providers/types.ts`.
**Step 3:** Implementasikan `GeminiVisionAdapter` di `lib/ai-providers/gemini-adapter.ts`.
**Step 4:** Implementasikan `OpenAIVisionAdapter` di `lib/ai-providers/openai-adapter.ts` dengan format gambar Base64 `data:image/png;base64,...` dan `response_format: { type: "json_object" }`.
**Step 5:** Implementasikan `ClaudeVisionAdapter` di `lib/ai-providers/claude-adapter.ts` dengan format gambar Base64 `{ type: "image", source: { type: "base64", ... } }`.
**Step 6:** Implementasikan factory `getVisionProvider()` di `lib/ai-providers/index.ts`.
**Step 7:** Tulis unit test `__tests__/ai-vision-adapters.test.ts` dan pastikan lulus.

---

### Task 3: Multi-Provider Live Model Scanner API
**Files:**
- Create/Modify: `app/api/settings/scan-models/route.ts`
- Test: `__tests__/scan-models-api.test.ts`

**Step 1:** Implementasikan endpoint `POST /api/settings/scan-models` yang menerima `{ provider, apiKey }`.
**Step 2:** Untuk OpenAI, panggil `openai.models.list()` dan kembalikan model multimodal (`gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, dll.).
**Step 3:** Untuk Anthropic Claude, kembalikan model vision Claude resmi (`claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, dll.).
**Step 4:** Tulis unit test mock dan verifikasi respons scan models.

---

### Task 4: Settings UI Enhancement for OpenAI & Anthropic Claude
**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `app/api/settings/route.ts`

**Step 1:** Perbarui `app/api/settings/route.ts` untuk membaca dan menyimpan `openai_model`, `anthropic_model`, `openai_api_key`, dan `anthropic_api_key`.
**Step 2:** Di `app/settings/page.tsx`, tambahkan tab button: **Google Gemini**, **OpenAI (ChatGPT)**, **Anthropic (Claude)**, dan **DeepSeek**.
**Step 3:** Buat kartu konfigurasi untuk OpenAI (input API Key, tombol Scan Models, dropdown model + custom model text input).
**Step 4:** Buat kartu konfigurasi untuk Anthropic Claude (input API Key, tombol Scan Models / dropdown model + custom text input).
**Step 5:** Verifikasi penyimpanan ke DB dan persistensi nilai form.

---

### Task 5: Pipeline Integration (Scan Legend & P&ID Detection)
**Files:**
- Modify: `lib/legend-extract.ts`
- Modify: `lib/ai-agent.ts`
- Test: `__tests__/multi-provider-pipeline-integration.test.ts`

**Step 1:** Integrasikan `getVisionProvider()` ke dalam `lib/legend-extract.ts` agar pemindaian simbol legenda dapat menggunakan provider aktif.
**Step 2:** Integrasikan `getVisionProvider()` ke dalam `lib/ai-agent.ts` agar deteksi visual peralatan P&ID dapat menggunakan model OpenAI / Claude yang dipilih.
**Step 3:** Pastikan fallback circuit breaker dan penanganan error tetap aman dan informatif jika provider kehabisan quota/rate limit.
**Step 4:** Tulis integration test `__tests__/multi-provider-pipeline-integration.test.ts`.

---

### Task 6: Full Verification, Regression Test & Report
**Files:**
- Run full tests: `npm test`
- Create: `docs/reports/2026-10-20-laporan-implementasi-openai-claude-provider.md`

**Step 1:** Jalankan seluruh test suite terkait adapter AI, pipeline deteksi, dan settings.
**Step 2:** Susun laporan akhir komprehensif dalam format markdown (.md).
