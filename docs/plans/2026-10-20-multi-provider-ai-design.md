# Technical Design Document: Multi-Provider Vision AI (OpenAI & Anthropic Claude Integration)

**Date:** 20 Oktober 2026  
**Status:** Approved by User  
**Target File / Plan:** `docs/plans/2026-10-20-multi-provider-ai-design.md`  

---

## 1. Problem Statement & Business Objective

Sebelumnya, modul ekstraksi Legenda (`lib/legend-extract.ts`) dan deteksi simbol visual P&ID (`lib/ai-agent.ts`) hanya mendukung **Google Gemini** untuk pemrosesan vision/multimodal, sedangkan DeepSeek hanya didukung sebagai model text-only.

Kebutuhan saat ini:
1. Menambahkan dukungan penyedia AI Vision terkemuka: **OpenAI (ChatGPT / GPT-4o / GPT-4o-mini / o1)** dan **Anthropic (Claude 3.7 / 3.5 Sonnet / Haiku)**.
2. Memberikan kebebasan penuh kepada pengguna untuk memilih model apa pun yang tersedia di akun mereka (tidak di-hardcode ke satu model tertentu).
3. Menyediakan fitur pemindaian model otomatis (*Scan Models*) langsung dari API OpenAI dan Anthropic di halaman Pengaturan (*Settings*).
4. Menyediakan antarmuka terpadu (*Unified Multi-Provider Vision Adapter*) sehingga seluruh pipeline deteksi, pemindaian legenda, dan validasi aturan dapat berjalan secara konsisten tanpa duplikasi kode.

---

## 2. Arsitektur Komponen (Approach 1: Unified Multi-Provider Vision Adapter)

```text
       ┌────────────────────────────────────────────────────────┐
       │                Application Layer                       │
       │  • Scan Legend (lib/legend-extract.ts)                 │
       │  • P&ID Symbol Detection (lib/ai-agent.ts)            │
       │  • AI Rule Validator & Verifier                       │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │     Unified Vision Provider Factory (lib/ai-providers) │
       │     getVisionProvider(): IVisionProvider               │
       └───────┬───────────────────┼────────────────────┬───────┘
               │                   │                    │
               ▼                   ▼                    ▼
     ┌───────────────────┐ ┌───────────────┐ ┌───────────────────┐
     │GeminiVisionAdapter│ │OpenAIVision...│ │ClaudeVisionAdapter│
     │(@google/genai)    │ │(openai SDK)   │ │(@anthropic-ai/sdk)│
     └───────────────────┘ └───────────────┘ └───────────────────┘
```

---

## 3. Rincian Modul & Implementasi

### 3.1 Kontrak Antarmuka (`lib/ai-providers/types.ts`)
```typescript
export interface VisionCompletionOptions {
  prompt: string;
  systemPrompt?: string;
  imageBase64: string;           // Format PNG gambar halaman P&ID / crop simbol
  mimeType?: string;            // Default: 'image/png'
  temperature?: number;
  maxTokens?: number;
  responseSchema?: any;         // Zod / JSON Schema untuk output terstruktur
}

export interface VisionCompletionResult {
  text: string;
  parsedJson?: any;
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface IVisionProvider {
  name: 'gemini' | 'openai' | 'anthropic';
  generateVisionCompletion(options: VisionCompletionOptions): Promise<VisionCompletionResult>;
  scanModels(apiKey: string): Promise<string[]>;
}
```

### 3.2 Adapter Implementasi
1. **`GeminiVisionAdapter` (`lib/ai-providers/gemini-adapter.ts`):**
   - Mempertahankan integrasi `@google/generative-ai`.
   - Menggunakan `inlineData` Base64 PNG.
   - Menggunakan `responseMimeType: "application/json"`.
2. **`OpenAIVisionAdapter` (`lib/ai-providers/openai-adapter.ts`):**
   - Memakai SDK `openai` yang sudah terpasang di dependencies proyek.
   - Format pesan gambar: `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`.
   - Format response: `response_format: { type: "json_object" }`.
   - Fitur Scan Models: memanggil `openai.models.list()` dan memfilter model yang mendukung vision (`gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, dll.).
3. **`ClaudeVisionAdapter` (`lib/ai-providers/claude-adapter.ts`):**
   - Memasang SDK `@anthropic-ai/sdk`.
   - Format pesan gambar: `{ type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } }`.
   - Instruksi JSON terstruktur dengan parsing ketat.
   - Fitur Scan Models: menyediakan daftar model vision Claude resmi (`claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, dll.) atau memanggil `/v1/models` jika tersedia pada key akun.

### 3.3 Database & Konfigurasi Server (`sql/init.sql` & `lib/ai-config.ts`)
- Menambahkan kolom pada tabel `settings`:
  - `openai_api_key TEXT`
  - `openai_model TEXT DEFAULT 'gpt-4o'`
  - `anthropic_api_key TEXT`
  - `anthropic_model TEXT DEFAULT 'claude-3-7-sonnet-20250219'`
- Memperluas antarmuka `AiConfig` di `lib/ai-config.ts` untuk mendukung `'gemini' | 'openai' | 'anthropic' | 'deepseek'`.
- Menambahkan fallback aman pada variabel lingkungan `.env.local`: `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`.

### 3.4 Antarmuka Pengguna Settings (`app/settings/page.tsx` & `app/api/settings/route.ts`)
- Navigasi 4 Provider: **Google Gemini**, **OpenAI**, **Anthropic**, dan **DeepSeek**.
- Form kartu konfigurasi OpenAI & Anthropic dengan:
  - Input API Key yang dapat disembunyikan/ditampilkan.
  - Tombol **`Scan Models`** untuk mengambil live model dari server provider.
  - Dropdown model + input teks kustom.
  - Endpoint API `POST /api/settings/scan-models` yang mendukung `provider: 'gemini' | 'openai' | 'anthropic'`.

### 3.5 Integrasi Pipeline Pemrosesan
- **Scan Legend (`lib/legend-extract.ts`):**
  - Mengarahkan pemanggilan ke `getVisionProvider().generateVisionCompletion(...)` dengan prompt ekstraksi simbol legenda.
- **P&ID Detection Agent (`lib/ai-agent.ts`):**
  - Mengarahkan analisis visual gambar ke adapter yang aktif, sehingga seluruh logika rule-validation, spatial-matching, dan auto-tagging tetap utuh.

---

## 4. Rencana Pengujian (Test Strategy)
1. **Unit Test Provider Adapters:**
   - Mock response OpenAI API & payload Base64 formatting.
   - Mock response Anthropic API & payload image source formatting.
   - Fallback error handling jika API key kosong / tidak valid.
2. **Integration Test Settings & Scan Models:**
   - Verifikasi endpoint `POST /api/settings/scan-models` untuk OpenAI dan Anthropic.
   - Verifikasi update database `settings` saat memilih OpenAI atau Anthropic.
3. **End-to-End Pipeline Verification:**
   - Verifikasi pemanggilan vision completion melalui adapter tanpa regresi pada deteksi P&ID.
